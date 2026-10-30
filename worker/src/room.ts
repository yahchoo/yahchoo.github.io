import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { grantPoints, spendPoints, userFromToken } from './account';
import { JEERS } from '../../web/js/points.js';
import { parseAvatar } from '../../web/js/avatar.js';
import {
  RoomError,
  type RoomState,
  rewardRef,
  attachAccount,
  cleanName,
  cheerTarget,
  createRoom,
  decideRewards,
  disconnect,
  MAX_WATCHERS,
  expireTurn,
  hasOpenSeat,
  hold,
  isSeated,
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

/**
 * 관전자는 playerId가 null. name은 들어올 때 입력한 닉네임 (관전자 목록에 보인다).
 * 로그인한 관전자는 userId(야유 포인트)와 avatar가 있다. 누가 야유했는지는 어디에도 남기지 않는다.
 */
interface Attachment {
  playerId: string | null;
  name?: string;
  userId?: string;
  avatar?: unknown;
}

const WATCH_TAG = 'watch';
/** 관전자 한 명이 응원을 보낼 수 있는 간격. */
const CHEER_GAP_MS = 800;
/** 야유는 포인트가 들어서 조금 더 길게. */
const JEER_GAP_MS = 1500;

/** 0 이상 1 미만의 암호학적 난수. 주사위는 서버에서만 굴린다. */
function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

/** 방 하나 = Durable Object 하나. 방 코드로 찾는다. */
export class YachtRoom extends DurableObject<Env> {
  /** 관전자별 마지막 응원 시각 (잠들면 비워져도 괜찮다). */
  private lastCheer = new WeakMap<WebSocket, number>();
  private lastJeer = new WeakMap<WebSocket, number>();
  /**
   * 방 상태 변경을 한 번에 하나씩 처리한다.
   * 상태를 읽은 뒤 바깥 요청(로그인 확인·포인트 지급 같은 D1 조회)을 기다리는 동안 다른 사람의 입장·퇴장이 끼어들면,
   * 예전 상태로 덮어써서 그 변경이 사라진다(입장한 사람이 빈자리로 보이거나, 나간 사람이 남아 보임). 이를 막는다.
   */
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 접속 유지용 ping은 객체를 깨우지 않고 바로 응답한다.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private async load(): Promise<RoomState | undefined> {
    return this.ctx.storage.get<RoomState>('state');
  }

  /** 끝난 게임이면 포인트를 한 번만 지급한다. (같은 판으로 두 번 받지 않게 기록으로도 막는다) */
  private async settleRewards(state: RoomState): Promise<void> {
    const game = state.game;
    if (state.phase !== 'finished' || !game || game.rewardsGranted) return;
    const rewards = decideRewards(state);
    const ref = rewardRef(state);
    for (const r of rewards) {
      try {
        // 점수 포인트와 등수 보너스를 따로 기록한다. (앱의 '광고 보고 2배'는 점수 포인트만)
        await grantPoints(this.env, r.userId, r.score, 'match', ref);
        await grantPoints(this.env, r.userId, r.bonus, 'match-bonus', ref);
      } catch (err) {
        console.error('포인트 지급 실패', err);
      }
    }
    game.rewardsGranted = true;
  }

  private async save(state: RoomState): Promise<void> {
    await this.settleRewards(state);
    await this.ctx.storage.put('state', state);
    // 게임 중에는 차례 마감 시각에, 그 외에는 정리 여부를 보러 깨운다.
    const deadline = state.phase === 'playing' ? state.game?.turnDeadline ?? null : null;
    const next = deadline ?? Math.max(state.updatedAt + IDLE_MS, Date.now() + 60_000);
    await this.ctx.storage.setAlarm(next);
  }

  private watcherCount(except?: WebSocket): number {
    return this.ctx.getWebSockets(WATCH_TAG).filter((s) => s !== except && s.readyState === WebSocket.OPEN).length;
  }

  private broadcast(state: RoomState, except?: WebSocket): void {
    const now = Date.now();
    // 관전자 목록 (들어온 순서). 받는 사람이 관전자면 자기 줄에 me 표시.
    const watchSockets = this.ctx
      .getWebSockets(WATCH_TAG)
      .filter((s) => s !== except && s.readyState === WebSocket.OPEN)
      .map((s) => ({ s, att: s.deserializeAttachment() as Attachment | null }))
      .filter((w) => w.att);
    const watchers = watchSockets.length;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      const watcherList = watchSockets.map((w) => ({
        name: w.att?.name || '관전자',
        avatar: w.att?.avatar ?? null,
        me: w.s === ws,
      }));
      try {
        ws.send(JSON.stringify({ ...viewFor(state, att.playerId, now, watchers), watcherList }));
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
    return this.serial(() => this.handleFetch(request));
  }

  private async handleFetch(request: Request): Promise<Response> {
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

      // 자리가 없거나 게임이 이미 시작했으면(또는 관전을 원하면) 관전자로 들어온다.
      const requestedId = url.searchParams.get('playerId');
      const wantsWatch = url.searchParams.get('watch') === '1';
      if (!isSeated(state, requestedId) && (wantsWatch || !hasOpenSeat(state))) {
        if (this.watcherCount() >= MAX_WATCHERS) return YachtRoom.reject('관전하는 사람이 너무 많아요. 잠시 뒤에 다시 들어와 주세요', 4009);
        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        this.ctx.acceptWebSocket(server, [WATCH_TAG]);
        let name = '관전자';
        try {
          name = cleanName(url.searchParams.get('name') ?? '');
        } catch {
          // 이름이 없거나 이상하면 '관전자'
        }
        server.serializeAttachment({ playerId: null, name } satisfies Attachment);
        server.send(JSON.stringify({ type: 'welcome', playerId: null, spectator: true }));
        this.broadcast(state);
        return new Response(null, { status: 101, webSocket: client });
      }

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
    await this.serial(() => this.handleMessage(ws, message));
  }

  private async handleMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || typeof message !== 'string') return;
    // 관전자는 보기와 응원만 한다.
    if (!att.playerId) {
      await this.watcherMessage(ws, att, message);
      return;
    }
    const playerId = att.playerId;

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
        case 'auth': {
          // 로그인한 사람은 들어온 뒤 로그인 토큰을 보내 계정을 연결한다.
          if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(data.token)) return;
          const user = await userFromToken(this.env, data.token);
          if (!user) {
            YachtRoom.sendError(ws, '로그인이 만료됐어요. 이번 판은 포인트 없이 진행돼요');
            return;
          }
          attachAccount(state, playerId, user.id, parseAvatar(user.avatar), now);
          break;
        }
        case 'team':
          setTeam(state, playerId, data.team, now);
          break;
        case 'start':
          start(state, playerId, now, secureRandom);
          break;
        case 'hold':
          hold(state, playerId, data.index, data.held, now);
          break;
        case 'roll':
          roll(state, playerId, now, secureRandom);
          break;
        case 'score':
          score(state, playerId, data.category, now);
          break;
        case 'rematch':
          rematch(state, playerId, now);
          break;
        case 'leave':
          leave(state, playerId, now);
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

  /**
   * 관전자 메시지. auth: 로그인 연결, cheer: 응원(무료), jeer: 야유(포인트 차감).
   * 응원·야유는 저장하지 않고 방 안 모두에게 바로 알린다.
   */
  private async watcherMessage(ws: WebSocket, att: Attachment, message: string): Promise<void> {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    const now = Date.now();

    if (data.type === 'auth') {
      if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(data.token)) return;
      const user = await userFromToken(this.env, data.token);
      if (!user) return;
      ws.serializeAttachment({ ...att, playerId: null, userId: user.id, avatar: parseAvatar(user.avatar) } satisfies Attachment);
      // 관전자 목록에 아바타가 보이게 다시 알린다.
      const state = await this.load();
      if (state) this.broadcast(state);
      return;
    }

    if (data.type === 'cheer') {
      if (now - (this.lastCheer.get(ws) ?? 0) < CHEER_GAP_MS) return;
      const state = await this.load();
      const target = state ? cheerTarget(state, data.target) : null;
      if (!target) return;
      this.lastCheer.set(ws, now);
      this.sendAll({ type: 'cheer', ...target });
      return;
    }

    if (data.type === 'jeer') {
      const action = typeof data.action === 'string' && Object.hasOwn(JEERS, data.action) ? data.action : null;
      if (!action) return;
      if (!att.userId) {
        YachtRoom.sendError(ws, '로그인하면 포인트로 야유할 수 있어요');
        return;
      }
      if (now - (this.lastJeer.get(ws) ?? 0) < JEER_GAP_MS) return;
      const state = await this.load();
      const target = state ? cheerTarget(state, data.target) : null;
      if (!target) return;
      this.lastJeer.set(ws, now);
      const { cost } = JEERS[action as keyof typeof JEERS];
      const ok = await spendPoints(this.env, att.userId, cost, 'jeer');
      if (!ok) {
        YachtRoom.sendError(ws, `포인트가 부족해요. 야유에는 ${cost}포인트가 들어요`);
        return;
      }
      const row = await this.env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(att.userId).first<{ points: number }>();
      try {
        ws.send(JSON.stringify({ type: 'balance', points: row?.points ?? 0 }));
      } catch {
        // 무시
      }
      // 누가 던졌는지는 보내지 않는다 (익명).
      this.sendAll({ type: 'jeer', action, ...target });
    }
  }

  /** 저장하지 않는 알림을 방 안 모두에게. */
  private sendAll(payload: Record<string, unknown>): void {
    const out = JSON.stringify(payload);
    for (const s of this.ctx.getWebSockets()) {
      if (s.readyState !== WebSocket.OPEN) continue;
      try {
        s.send(out);
      } catch {
        // 무시
      }
    }
  }

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    if (!att.playerId) {
      // 관전자가 나가면 관전 인원만 다시 알린다.
      ws.serializeAttachment(null);
      const state = await this.load();
      if (state) this.broadcast(state, ws);
      return;
    }
    const playerId = att.playerId;
    const stillOpen = this.ctx
      .getWebSockets(playerId)
      .some((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (stillOpen) return;

    const state = await this.load();
    if (!state) return;
    disconnect(state, playerId, Date.now());
    await this.save(state);
    this.broadcast(state);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.serial(() => this.onSocketGone(ws));
    try {
      ws.close(code === 1005 ? 1000 : code, 'closed');
    } catch {
      // 이미 닫힘
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.serial(() => this.onSocketGone(ws));
  }

  async alarm(): Promise<void> {
    await this.serial(() => this.handleAlarm());
  }

  private async handleAlarm(): Promise<void> {
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

    const changed = expireTurn(state, now, secureRandom);
    await this.save(state);
    if (changed) this.broadcast(state);
  }
}
