import { YachtRoom } from './room';
import { isMode, isRoomCode, randomRoomCode } from './match';

export { YachtRoom };

export interface Env {
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

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname.replace(/\/+$/, '')}`;
  switch (key) {
    case 'GET /api/health':
      return json({ ok: true });
    case 'POST /api/rooms':
      return createRoom(request, env);
    default: {
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
} satisfies ExportedHandler<Env>;
