import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { grantPoints, spendPoints, userFromToken } from './account';
import { ITEM_BUY_COST, JEERS } from '../../web/js/points.js';
import { parseAvatar } from '../../web/js/avatar.js';
import {
  RoomError,
  type RoomState,
  rewardRef,
  attachAccount,
  cleanName,
  cheerTarget,
  createRoom,
  buyItem,
  canBuyItem,
  setItems,
  useItem,
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
  /**
   * 끝난 판의 포인트를 정한다. 지급(DB)은 저장한 뒤 따로 해서, DB가 느려도 방 진행을 막지 않는다.
   * 같은 판(ref)은 한 번만 지급되므로(grantPoints가 중복을 막음) 다시 시도해도 안전하다.
   */
  private takeRewards(state: RoomState): (() => Promise<void>) | null {
    const game = state.game;
    if (state.phase !== 'finished' || !game || game.rewardsGranted) return null;
    const rewards = decideRewards(state);
    const ref = rewardRef(state);
    game.rewardsGranted = true;
    if (rewards.length === 0) return null;
    return async () => {
      for (const r of rewards) {
        try {
          // 점수 포인트와 등수 보너스를 따로 기록한다. (앱의 '광고 보고 2배'는 점수 포인트만)
          await grantPoints(this.env, r.userId, r.score, 'match', ref);
          await grantPoints(this.env, r.userId, r.bonus, 'match-bonus', ref);
        } catch (err) {
          console.error('포인트 지급 실패', err);
        }
      }
    };
  }

  private async save(state: RoomState): Promise<void> {
    const grant = this.takeRewards(state);
    await this.ctx.storage.put('state', state);
    if (grant) this.ctx.waitUntil(grant());
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

  /**
   * 예상 못 한 오류를 DB(error_log)에 남긴다. 기록은 방 진행을 막지 않게 따로 한다.
   */
  private logError(place: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(place, e);
    const now = Date.now();
    this.ctx.waitUntil(
      this.env.DB.batch([
        this.env.DB.prepare('INSERT INTO error_log (at, place, message, stack) VALUES (?, ?, ?, ?)').bind(
          now,
          place,
          e.message.slice(0, 500),
          (e.stack ?? '').slice(0, 1500),
        ),
        this.env.DB.prepare('DELETE FROM error_log WHERE at < ?').bind(now - 7 * 86_400_000),
      ]).then(() => undefined, () => undefined),
    );
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.serial(() => this.handleFetch(request));
    } catch (err) {
      this.logError(`room.fetch ${new URL(request.url).pathname}`, err);
      throw err;
    }
  }

  private async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/where') {
      // 이 방(Durable Object)이 실제로 도는 데이터센터
      let colo: string | null = null;
      try {
        const text = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text();
        colo = /^colo=(\w+)$/m.exec(text)?.[1] ?? null;
      } catch {
        // 모르면 null
      }
      return Response.json({ colo });
    }

    if (url.pathname === '/init') {
      const code = url.searchParams.get('code') ?? '';
      const mode = url.searchParams.get('mode');
      if (!isMode(mode)) return new Response('bad mode', { status: 400 });
      if (await this.load()) return new Response('exists', { status: 409 });
      await this.save(createRoom(code, mode, Date.now(), url.searchParams.get('items') === '1'));
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
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || typeof message !== 'string') return;
    // 관전자는 방 상태를 바꾸지 않으니(보기·응원·야유) 줄을 서지 않는다.
    // 야유의 포인트 차감 같은 DB 작업이 게임 진행을 막지 않게 한다.
    if (!att.playerId) {
      try {
        await this.watcherMessage(ws, att, message);
      } catch (err) {
        this.logError('room.watcher', err);
      }
      return;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    // 로그인 확인(DB)은 줄 밖에서 먼저 한다. 줄 안에서 DB를 기다리면 그동안 방 전체(굴리기 등)가 멈춘다.
    let user: Awaited<ReturnType<typeof userFromToken>> | undefined;
    if (data.type === 'auth') {
      if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(data.token)) return;
      user = await userFromToken(this.env, data.token);
      if (!user) {
        YachtRoom.sendError(ws, '로그인이 만료됐어요. 이번 판은 포인트 없이 진행돼요');
        return;
      }
    }
    if (data.type === 'buy') {
      // 포인트 차감(DB)은 줄 밖에서 하고, 아이템 주기만 줄 안에서 한다.
      try {
        await this.buyItemFor(ws, att.playerId as string, data.item);
      } catch (err) {
        this.logError('room.buy', err);
        YachtRoom.sendError(ws, '잠깐 문제가 생겼어요. 다시 시도해 주세요');
      }
      return;
    }
    try {
      await this.serial(() => this.handleMessage(ws, att.playerId as string, data, user));
    } catch (err) {
      // 오류가 나도 방은 계속 돌게 하고, 보낸 사람에게는 최신 상태를 다시 보내 화면이 멈추지 않게 한다.
      this.logError(`room.message ${String(data.type)}`, err);
      YachtRoom.sendError(ws, '잠깐 문제가 생겼어요. 다시 시도해 주세요');
      try {
        const state = await this.load();
        if (state) this.broadcast(state);
      } catch {
        // 무시
      }
    }
  }

  /** 이 방에서 지금 사고 있는 것 (같은 아이템을 두 번 눌러 두 번 빠지지 않게) */
  private buying = new Set<string>();

  /** 아이템전: 다 쓴 아이템을 포인트로 한 번 더 산다. 차감 뒤 줄 수 없게 됐으면 돌려준다. */
  private async buyItemFor(ws: WebSocket, playerId: string, item: unknown): Promise<void> {
    const key = `${playerId}:${String(item)}`;
    if (this.buying.has(key)) return;
    this.buying.add(key);
    try {
      const state = await this.load();
      if (!state) return;
      let userId: string;
      try {
        userId = canBuyItem(state, playerId, item);
      } catch (err) {
        if (err instanceof RoomError) {
          YachtRoom.sendError(ws, err.message);
          return;
        }
        throw err;
      }
      const ok = await spendPoints(this.env, userId, ITEM_BUY_COST, 'item');
      if (!ok) {
        YachtRoom.sendError(ws, `포인트가 부족해요. 아이템은 ${ITEM_BUY_COST}포인트예요`);
        return;
      }
      let granted = false;
      await this.serial(async () => {
        const s = await this.load();
        if (!s) return;
        try {
          buyItem(s, playerId, item, Date.now());
          granted = true;
        } catch (err) {
          if (!(err instanceof RoomError)) throw err;
          YachtRoom.sendError(ws, err.message);
          return;
        }
        await this.save(s);
        this.broadcast(s);
      });
      if (!granted) await grantPoints(this.env, userId, ITEM_BUY_COST, 'item_refund', crypto.randomUUID());
      const row = await this.env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(userId).first<{ points: number }>();
      try {
        ws.send(JSON.stringify({ type: 'balance', points: row?.points ?? 0 }));
      } catch {
        // 무시
      }
    } finally {
      this.buying.delete(key);
    }
  }

  private async handleMessage(
    ws: WebSocket,
    playerId: string,
    data: Record<string, unknown>,
    user: Awaited<ReturnType<typeof userFromToken>> | undefined,
  ): Promise<void> {

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
          // 로그인한 사람은 들어온 뒤 로그인 토큰을 보내 계정을 연결한다. (토큰 확인은 줄 밖에서 끝냄)
          if (!user) return;
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
          // 화면에 보이는 고정 상태로 굴린다 (고정 요청이 늦게 닿아도 어긋나지 않게).
          roll(state, playerId, now, secureRandom, data.held);
          break;
        case 'score':
          score(state, playerId, data.category, now);
          break;
        case 'item':
          useItem(state, playerId, data.item, data.item === 'flip' ? data.index : data.category, now);
          break;
        case 'items':
          setItems(state, playerId, data.on, now);
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
    try {
      await this.serial(() => this.onSocketGone(ws));
    } catch (err) {
      this.logError('room.close', err);
    }
    try {
      ws.close(code === 1005 ? 1000 : code, 'closed');
    } catch {
      // 이미 닫힘
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      await this.serial(() => this.onSocketGone(ws));
    } catch (err) {
      this.logError('room.wserror', err);
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.serial(() => this.handleAlarm());
    } catch (err) {
      this.logError('room.alarm', err);
      throw err;
    }
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
