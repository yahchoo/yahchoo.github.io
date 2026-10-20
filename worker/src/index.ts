import { YachtRoom } from './room';
import { isMode, isRoomCode, randomRoomCode } from './match';
import {
  GAME_RETENTION_MS,
  RANK_WINDOW_MS,
  SoloError,
  type SoloState,
  isFinished,
  newSolo,
  parseState,
  soloRoll,
  soloScore,
  soloTotal,
  validateInitials,
  weekEnd,
  weekStart,
} from './solo';

export { YachtRoom };

export interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace<YachtRoom>;
  ALLOWED_ORIGINS?: string;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isAllowedOrigin(origin: string, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.some(
    (entry) =>
      origin === entry ||
      ((entry.endsWith('://localhost') || entry.endsWith('://127.0.0.1')) && origin.startsWith(`${entry}:`)),
  );
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin || !isAllowedOrigin(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** 새 방을 만들고 방 코드를 돌려준다. body: { mode: '1v1' | '1v1v1' | '2v2' } */
async function createRoom(request: Request, env: Env): Promise<Response> {
  let mode: unknown;
  try {
    mode = ((await request.json()) as { mode?: unknown }).mode;
  } catch {
    // 아래에서 처리
  }
  if (!isMode(mode)) throw new HttpError(400, '게임 방식을 골라 주세요');

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomRoomCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch(`https://room/init?code=${code}&mode=${mode}`, { method: 'POST' });
    if (res.status === 201) return json({ code, mode }, 201);
  }
  throw new HttpError(503, '방을 만들지 못했어요. 잠시 후 다시 시도해 주세요');
}

/** 방 WebSocket 연결을 해당 방(Durable Object)으로 넘긴다. */
function connectRoom(request: Request, env: Env, code: string, url: URL): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin && !isAllowedOrigin(origin, env)) throw new HttpError(403, '허용되지 않은 주소예요');
  if (!isRoomCode(code)) throw new HttpError(400, '방 코드가 올바르지 않아요');
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return stub.fetch(`https://room/ws${url.search}`, request);
}

/* ---------------------------------------------------------------- 혼자 하기 (랭킹용) */

const MAX_RANKING_LIMIT = 100;

function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // 아래에서 처리
  }
  throw new HttpError(400, '요청 형식이 올바르지 않아요');
}

function requireGameId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) throw new HttpError(400, '게임 정보가 올바르지 않아요');
  return value;
}

interface GameRow {
  id: string;
  state: string;
  version: number;
  started_at: number;
  updated_at: number;
  finished_at: number | null;
  total: number | null;
  ranked: number;
}

function soloView(id: string, state: SoloState, row: Pick<GameRow, 'finished_at' | 'ranked'>, now: number) {
  const finished = isFinished(state);
  return {
    gameId: id,
    sheet: state.sheet,
    dice: state.dice,
    held: state.held,
    rollsLeft: state.rollsLeft,
    rollSeq: state.rollSeq,
    finished,
    total: soloTotal(state),
    // 끝낸 뒤 24시간 안, 아직 등록 안 한 게임만 랭킹에 올릴 수 있다.
    rankable: finished && !row.ranked && row.finished_at !== null && now - row.finished_at <= RANK_WINDOW_MS,
  };
}

async function loadGame(env: Env, id: string): Promise<GameRow> {
  const row = await env.DB.prepare('SELECT * FROM solo_games WHERE id = ?').bind(id).first<GameRow>();
  if (!row) throw new HttpError(404, '게임을 찾을 수 없어요');
  return row;
}

async function startSolo(env: Env): Promise<Response> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const state = newSolo();
  await env.DB.prepare('INSERT INTO solo_games (id, state, started_at, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, JSON.stringify(state), now, now)
    .run();
  return json(soloView(id, state, { finished_at: null, ranked: 0 }, now), 201);
}

async function getSolo(env: Env, id: string): Promise<Response> {
  const row = await loadGame(env, requireGameId(id));
  return json(soloView(row.id, parseState(row.state), row, Date.now()));
}

/** 굴리기·적기 공통: 읽고, 바꾸고, 그 사이 다른 요청이 끼어들지 않았을 때만 저장한다. */
async function updateSolo(
  request: Request,
  env: Env,
  change: (state: SoloState, body: Record<string, unknown>) => SoloState,
): Promise<Response> {
  const body = await readJson(request);
  const row = await loadGame(env, requireGameId(body.gameId));
  let next: SoloState;
  try {
    next = change(parseState(row.state), body);
  } catch (err) {
    if (err instanceof SoloError) throw new HttpError(409, err.message);
    throw err;
  }
  const now = Date.now();
  const finished = isFinished(next);
  const updated = await env.DB.prepare(
    `UPDATE solo_games
        SET state = ?1, version = version + 1, updated_at = ?2,
            finished_at = CASE WHEN ?3 THEN ?2 ELSE NULL END,
            total = CASE WHEN ?3 THEN ?4 ELSE NULL END
      WHERE id = ?5 AND version = ?6
  RETURNING finished_at, ranked`,
  )
    .bind(JSON.stringify(next), now, finished ? 1 : 0, soloTotal(next), row.id, row.version)
    .first<Pick<GameRow, 'finished_at' | 'ranked'>>();
  if (!updated) throw new HttpError(409, '다른 요청과 겹쳤어요. 다시 시도해 주세요');
  return json(soloView(row.id, next, updated, now));
}

interface RankingRow {
  id: number;
  initials: string;
  score: number;
  played_at: number;
}

async function rankOf(env: Env, score: number, since: number | null): Promise<number> {
  const ahead = since === null
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM rankings WHERE score > ?').bind(score).first<{ n: number }>()
    : await env.DB.prepare('SELECT COUNT(*) AS n FROM rankings WHERE score > ? AND played_at >= ?').bind(score, since).first<{ n: number }>();
  return (ahead?.n ?? 0) + 1;
}

async function submitRanking(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const gameId = requireGameId(body.gameId);
  const initialsError = validateInitials(body.initials);
  if (initialsError) throw new HttpError(400, initialsError);
  const initials = body.initials as string;

  const row = await loadGame(env, gameId);
  if (row.finished_at === null || row.total === null) throw new HttpError(409, '아직 끝나지 않은 게임이에요');
  if (row.ranked) throw new HttpError(409, '이미 랭킹에 등록한 게임이에요');
  const now = Date.now();
  if (now - row.finished_at > RANK_WINDOW_MS) throw new HttpError(409, '랭킹 등록 시간이 지났어요');

  const [marked, inserted] = await env.DB.batch([
    env.DB.prepare('UPDATE solo_games SET ranked = 1 WHERE id = ? AND ranked = 0').bind(gameId),
    env.DB.prepare(
      `INSERT INTO rankings (game_id, initials, score, played_at, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(game_id) DO NOTHING
       RETURNING id, initials, score, played_at`,
    ).bind(gameId, initials, row.total, row.finished_at, now),
  ]);
  const entry = (inserted.results as RankingRow[])[0];
  if (!marked.meta.changes || !entry) throw new HttpError(409, '이미 랭킹에 등록한 게임이에요');

  const thisWeek = weekStart(now);
  return json(
    {
      entry: {
        id: entry.id,
        initials: entry.initials,
        score: entry.score,
        playedAt: entry.played_at,
        rankAll: await rankOf(env, entry.score, null),
        rankWeek: entry.played_at >= thisWeek ? await rankOf(env, entry.score, thisWeek) : null,
      },
    },
    201,
  );
}

async function listRankings(url: URL, env: Env): Promise<Response> {
  const period = url.searchParams.get('period') === 'all' ? 'all' : 'week';
  const requested = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_RANKING_LIMIT) : 50;
  const now = Date.now();
  const since = period === 'week' ? weekStart(now) : 0;
  const { results } = await env.DB.prepare(
    `SELECT id, initials, score, played_at FROM rankings
      WHERE played_at >= ?
      ORDER BY score DESC, played_at ASC, id ASC
      LIMIT ?`,
  )
    .bind(since, limit)
    .all<RankingRow>();
  // 점수가 같으면 같은 순위
  let prev: RankingRow | undefined;
  let rank = 0;
  const entries = results.map((row, i) => {
    if (!prev || prev.score !== row.score) rank = i + 1;
    prev = row;
    return { id: row.id, rank, initials: row.initials, score: row.score, playedAt: row.played_at };
  });
  return json({
    period,
    weekStart: weekStart(now),
    weekEnd: weekEnd(now),
    entries,
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname.replace(/\/+$/, '')}`;
  switch (key) {
    case 'GET /api/health':
      return json({ ok: true });
    case 'POST /api/rooms':
      return createRoom(request, env);
    case 'POST /api/solo/start':
      return startSolo(env);
    case 'POST /api/solo/roll':
      return updateSolo(request, env, (s, body) => soloRoll(s, body.held, secureRandom));
    case 'POST /api/solo/score':
      return updateSolo(request, env, (s, body) => soloScore(s, body.category));
    case 'GET /api/rankings':
      return listRankings(url, env);
    case 'POST /api/rankings':
      return submitRanking(request, env);
    default: {
      const solo = /^GET \/api\/solo\/([0-9a-f-]+)$/.exec(key);
      if (solo) return getSolo(env, solo[1]);
      const ws = /^GET \/api\/rooms\/([A-Za-z0-9]+)\/ws$/.exec(key);
      if (ws) return connectRoom(request, env, ws[1].toUpperCase(), url);
      throw new HttpError(404, '없는 주소예요');
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    let response: Response;
    try {
      response = await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) {
        response = json({ error: err.message }, err.status);
      } else {
        console.error(err);
        response = json({ error: '잠시 후 다시 시도해 주세요' }, 500);
      }
    }
    // WebSocket 연결 응답(101)은 그대로 돌려준다.
    if (response.status === 101 || response.webSocket) return response;
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  },

  /** 등록하지 않고 남은 오래된 혼자 하기 게임을 하루에 한 번 정리한다. */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await env.DB.prepare('DELETE FROM solo_games WHERE updated_at < ?')
      .bind(Date.now() - GAME_RETENTION_MS)
      .run();
  },
} satisfies ExportedHandler<Env>;
