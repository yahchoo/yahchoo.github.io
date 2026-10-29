// 로그인: 구글·애플이 준 ID 토큰(JWT)을 서버에서 검증하고, 우리 서비스의 로그인 토큰(세션)을 발급한다.
// 애플 전용 기능(클라이언트 시크릿, 연결 해제, 서버 알림)은 apple.ts.

export const SESSION_MS = 60 * 24 * 60 * 60 * 1000; // 60일
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export class AuthError extends Error {}

export interface GoogleClaims {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat?: number;
}

export type Jwk = JsonWebKey & { kid?: string };
export type JwksFetcher = () => Promise<Jwk[]>;

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
  } catch {
    throw new AuthError('로그인 정보를 읽을 수 없어요');
  }
}

/* 구글 공개키는 몇 시간 동안 바뀌지 않으니 한 번 받아 두고 재사용한다. */
let jwksCache: { keys: Jwk[]; until: number } | null = null;

export const fetchGoogleJwks: JwksFetcher = async () => {
  const now = Date.now();
  if (jwksCache && jwksCache.until > now) return jwksCache.keys;
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new AuthError('구글 로그인 확인에 실패했어요. 잠시 후 다시 시도해 주세요');
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1] ?? 3600);
  jwksCache = { keys, until: now + Math.min(maxAge, 6 * 3600) * 1000 };
  return keys;
};

/** RS256 서명을 확인하고 내용을 돌려준다. (구글·애플 공통) */
export async function verifyRs256Jwt(token: unknown, getKeys: JwksFetcher): Promise<Record<string, unknown>> {
  if (typeof token !== 'string' || token.length > 8000 || token.split('.').length !== 3) throw new AuthError('로그인 정보가 올바르지 않아요');
  const [h, p, s] = token.split('.');
  const header = decodeJson(h);
  const claims = decodeJson(p);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('로그인 정보가 올바르지 않아요');

  const jwk = (await getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError('로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new AuthError('로그인 정보가 올바르지 않아요');
  return claims;
}

/** 구글 ID 토큰을 검증하고 내용(sub 등)을 돌려준다. */
export async function verifyGoogleIdToken(
  token: unknown,
  clientId: string,
  now: number,
  getKeys: JwksFetcher = fetchGoogleJwks,
): Promise<GoogleClaims> {
  const claims = (await verifyRs256Jwt(token, getKeys)) as unknown as GoogleClaims;
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new AuthError('구글 로그인이 아니에요');
  if (claims.aud !== clientId) throw new AuthError('이 사이트의 로그인이 아니에요');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) throw new AuthError('로그인이 만료됐어요. 다시 로그인해 주세요');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AuthError('로그인 정보가 올바르지 않아요');
  return claims;
}

/** 로그인 토큰: 무작위 32바이트. DB에는 해시만 저장한다. */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('Authorization') ?? '');
  return m ? m[1] : null;
}

export function bytesToB64url(data: Uint8Array | ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
