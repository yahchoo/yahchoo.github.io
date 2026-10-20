import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import {
  RoomError,
  type RoomState,
  createRoom,
  disconnect,
  expireTurn,
  hold,
  isMode,
  join,
  leave,
  rematch,
  roll,
  score,
  setTeam,
  start,
  viewFor,
} from './match';

/** 아무도 접속해 있지 않은 방은 이 시간 뒤 지운다. */
const IDLE_MS = 15 * 60 * 1000;
/** 사람이 접속해 있어도 이 시간 넘게 아무 행동이 없으면 지운다. */
const ABANDON_MS = 2 * 60 * 60 * 1000;

interface Attachment {
  playerId: string;
}

/** 0 이상 1 미만의 암호학적 난수. 주사위는 서버에서만 굴린다. */
function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

/** 방 하나 = Durable Object 하나. 방 코드로 찾는다. */
export class YachtRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 접속 유지용 ping은 객체를 깨우지 않고 바로 응답한다.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private async load(): Promise<RoomState | undefined> {
    return this.ctx.storage.get<RoomState>('state');
  }

  private async save(state: RoomState): Promise<void> {
    await this.ctx.storage.put('state', state);
    // 게임 중에는 차례 마감 시각에, 그 외에는 정리 여부를 보러 깨운다.
    const deadline = state.phase === 'playing' ? state.game?.turnDeadline ?? null : null;
    const next = deadline ?? Math.max(state.updatedAt + IDLE_MS, Date.now() + 60_000);
    await this.ctx.storage.setAlarm(next);
  }

  private broadcast(state: RoomState): void {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      try {
        ws.send(JSON.stringify(viewFor(state, att.playerId, now)));
      } catch {
        // 이미 닫힌 연결
      }
    }
  }

  private static sendError(ws: WebSocket, message: string, fatal = false): void {
    try {
      ws.send(JSON.stringify({ type: 'error', message, fatal }));
    } catch {
      // 무시
    }
  }

  private static reject(message: string, code: number): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    YachtRoom.sendError(server, message, true);
    server.close(code, 'rejected');
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/init') {
      const code = url.searchParams.get('code') ?? '';
      const mode = url.searchParams.get('mode');
      if (!isMode(mode)) return new Response('bad mode', { status: 400 });
      if (await this.load()) return new Response('exists', { status: 409 });
      await this.save(createRoom(code, mode, Date.now()));
      return new Response('created', { status: 201 });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket 연결이 필요해요', { status: 426 });
      }
      const state = await this.load();
      if (!state) return YachtRoom.reject('없는 방이에요. 코드를 확인해 주세요', 4004);

      let playerId: string;
      try {
        playerId = join(
          state,
          {
            playerId: url.searchParams.get('playerId'),
            name: url.searchParams.get('name') ?? '',
            newId: crypto.randomUUID(),
          },
          Date.now(),
        );
      } catch (err) {
        return YachtRoom.reject(err instanceof RoomError ? err.message : '들어갈 수 없는 방이에요', 4009);
      }

      // 같은 참가자의 예전 연결(재접속 전 연결)은 닫는다.
      for (const old of this.ctx.getWebSockets(playerId)) {
        try {
          old.serializeAttachment(null);
          old.close(4000, 'replaced');
        } catch {
          // 무시
        }
      }

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server, [playerId]);
      server.serializeAttachment({ playerId } satisfies Attachment);
      server.send(JSON.stringify({ type: 'welcome', playerId }));

      await this.save(state);
      this.broadcast(state);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || typeof message !== 'string') return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const state = await this.load();
    if (!state) {
      YachtRoom.sendError(ws, '방이 사라졌어요', true);
      ws.close(4004, 'gone');
      return;
    }

    const now = Date.now();
    try {
      // 차례 시간이 지난 상태에서 들어온 요청은 먼저 시간 초과를 반영한다.
      expireTurn(state, now, secureRandom);
      switch (data.type) {
        case 'team':
          setTeam(state, att.playerId, data.team, now);
          break;
        case 'start':
          start(state, att.playerId, now, secureRandom);
          break;
        case 'hold':
          hold(state, att.playerId, data.index, data.held, now);
          break;
        case 'roll':
          roll(state, att.playerId, now, secureRandom);
          break;
        case 'score':
          score(state, att.playerId, data.category, now);
          break;
        case 'rematch':
          rematch(state, att.playerId, now);
          break;
        case 'leave':
          leave(state, att.playerId, now);
          break;
        default:
          return;
      }
    } catch (err) {
      if (err instanceof RoomError) {
        YachtRoom.sendError(ws, err.message);
        // 상태가 바뀌었을 수 있으니(시간 초과) 최신 상태도 보낸다.
        await this.save(state);
        this.broadcast(state);
        return;
      }
      throw err;
    }

    await this.save(state);
    if (data.type === 'leave') {
      // 나간 사람에게는 더 보내지 않는다.
      ws.serializeAttachment(null);
      try {
        ws.close(1000, 'left');
      } catch {
        // 무시
      }
    }
    this.broadcast(state);
  }

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    const stillOpen = this.ctx
      .getWebSockets(att.playerId)
      .some((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (stillOpen) return;

    const state = await this.load();
    if (!state) return;
    disconnect(state, att.playerId, Date.now());
    await this.save(state);
    this.broadcast(state);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.onSocketGone(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, 'closed');
    } catch {
      // 이미 닫힘
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  async alarm(): Promise<void> {
    const state = await this.load();
    if (!state) return;
    const now = Date.now();
    const sockets = this.ctx.getWebSockets().filter((s) => s.readyState === WebSocket.OPEN);

    const idle = sockets.length === 0 && now - state.updatedAt >= IDLE_MS;
    const abandoned = now - state.updatedAt >= ABANDON_MS;
    if (idle || abandoned) {
      for (const ws of sockets) {
        YachtRoom.sendError(ws, '오래 움직임이 없어 방이 닫혔어요', true);
        try {
          ws.close(4010, 'expired');
        } catch {
          // 무시
        }
      }
      await this.ctx.storage.deleteAll();
      return;
    }

    if (expireTurn(state, now, secureRandom)) this.broadcast(state);
    await this.save(state);
  }
}
