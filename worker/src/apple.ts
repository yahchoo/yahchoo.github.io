// Apple로 로그인 (iOS 앱).
//
// - 앱이 받은 identity token(JWT)을 애플 공개키로 검증한다. aud는 앱 번들 ID.
// - 처음 로그인할 때 받은 authorization code로 refresh token을 받아 암호화해 둔다.
//   계정을 지우면 이 토큰으로 애플에 "연결 해제(revoke)"를 요청한다. (App Store 심사 지침 5.1.1(v))
// - 사용자가 애플 쪽에서 연결을 끊거나 애플 계정을 지우면 애플이 서버 알림을 보낸다 → 우리 계정도 지운다.
// - 이메일·이름은 저장하지 않는다. 애플 고유번호(sub)만 'apple:' 접두사로 users.google_sub 칸에 둔다.

import { AuthError, b64urlToBytes, bytesToB64url, verifyRs256Jwt, type Jwk, type JwksFetcher } from './auth';

export const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

export interface AppleSecrets {
  teamId: string;
  keyId: string;
  /** Sign in with Apple 키(.p8) 내용 그대로 (-----BEGIN PRIVATE KEY----- …) */
  p8: string;
}

export interface AppleClaims {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  nonce?: string;
}

let jwksCache: { keys: Jwk[]; until: number } | null = null;

export const fetchAppleJwks: JwksFetcher = async () => {
  const now = Date.now();
  if (jwksCache && jwksCache.until > now) return jwksCache.keys;
  const res = await fetch(APPLE_JWKS_URL);
  if (!res.ok) throw new AuthError('Apple 로그인 확인에 실패했어요. 잠시 후 다시 시도해 주세요');
  const { keys } = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys, until: now + 6 * 3600 * 1000 };
  return keys;
};

/** 허용하는 앱 번들 ID 목록 (쉼표로 구분) */
export function appleClientIds(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Apple identity token 검증.
 * nonce: 앱이 로그인 요청에 넣은 값. 토큰의 nonce가 그 값이거나 그 값의 SHA-256이어야 한다.
 */
export async function verifyAppleIdToken(
  token: unknown,
  clientIds: string[],
  nonce: unknown,
  now: number,
  getKeys: JwksFetcher = fetchAppleJwks,
): Promise<AppleClaims> {
  if (!clientIds.length) throw new AuthError('Apple 로그인이 아직 준비되지 않았어요');
  const claims = (await verifyRs256Jwt(token, getKeys)) as unknown as AppleClaims;
  if (claims.iss !== APPLE_ISSUER) throw new AuthError('Apple 로그인이 아니에요');
  if (!clientIds.includes(claims.aud)) throw new AuthError('이 앱의 로그인이 아니에요');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) throw new AuthError('로그인이 만료됐어요. 다시 로그인해 주세요');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 200) throw new AuthError('로그인 정보가 올바르지 않아요');
  if (claims.nonce !== undefined) {
    if (typeof nonce !== 'string' || !nonce || nonce.length > 200) throw new AuthError('로그인 정보가 올바르지 않아요');
    if (claims.nonce !== nonce && claims.nonce !== (await sha256Hex(nonce))) throw new AuthError('로그인 정보가 올바르지 않아요');
  }
  return claims;
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 애플 API용 클라이언트 시크릿 (ES256 JWT, 5분 유효). */
export async function appleClientSecret(secrets: AppleSecrets, clientId: string, now: number): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(secrets.p8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000);
  const h = bytesToB64url(JSON.stringify({ alg: 'ES256', kid: secrets.keyId, typ: 'JWT' }));
  const p = bytesToB64url(JSON.stringify({ iss: secrets.teamId, iat, exp: iat + 300, aud: APPLE_ISSUER, sub: clientId }));
  // WebCrypto의 ECDSA 서명은 JWT가 쓰는 r||s(64바이트) 형식 그대로다.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${bytesToB64url(sig)}`;
}

/** 처음 로그인할 때 받은 authorization code → refresh token. 실패하면 null. */
export async function exchangeAppleCode(secrets: AppleSecrets, clientId: string, code: string, now: number): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: await appleClientSecret(secrets, clientId, now),
    code,
    grant_type: 'authorization_code',
  });
  const res = await fetch(APPLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) {
    console.error('Apple token 교환 실패', res.status, await res.text().catch(() => ''));
    return null;
  }
  const data = (await res.json()) as { refresh_token?: string };
  return typeof data.refresh_token === 'string' ? data.refresh_token : null;
}

/** 애플에 연결 해제 요청. 성공하면 true. */
export async function revokeAppleToken(secrets: AppleSecrets, clientId: string, refreshToken: string, now: number): Promise<boolean> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: await appleClientSecret(secrets, clientId, now),
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });
  const res = await fetch(APPLE_REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) console.error('Apple revoke 실패', res.status, await res.text().catch(() => ''));
  return res.ok;
}

/* refresh token은 비밀값(p8)에서 만든 키로 암호화해서 저장한다. DB만 새어도 쓸 수 없게. */
async function tokenKey(secrets: AppleSecrets): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`yachoo-apple-refresh:${secrets.p8}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealToken(secrets: AppleSecrets, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(secrets), new TextEncoder().encode(token));
  return `${bytesToB64url(iv)}.${bytesToB64url(data)}`;
}

export async function openToken(secrets: AppleSecrets, sealed: string): Promise<string | null> {
  try {
    const [iv, data] = sealed.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlToBytes(iv) }, await tokenKey(secrets), b64urlToBytes(data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export type AppleEvent = { type: string; sub: string };

/**
 * 애플 서버 알림(Sign in with Apple server-to-server notification) 검증.
 * 본문 { payload: JWT }, JWT 안의 events는 JSON 문자열.
 */
export async function verifyAppleNotification(
  payload: unknown,
  clientIds: string[],
  getKeys: JwksFetcher = fetchAppleJwks,
): Promise<AppleEvent> {
  const claims = await verifyRs256Jwt(payload, getKeys);
  if (claims.iss !== APPLE_ISSUER) throw new AuthError('애플 알림이 아니에요');
  if (typeof claims.aud !== 'string' || !clientIds.includes(claims.aud)) throw new AuthError('이 앱의 알림이 아니에요');
  let events: unknown = claims.events;
  if (typeof events === 'string') {
    try {
      events = JSON.parse(events);
    } catch {
      throw new AuthError('알림 내용을 읽을 수 없어요');
    }
  }
  const e = events as { type?: unknown; sub?: unknown };
  if (typeof e?.type !== 'string' || typeof e?.sub !== 'string') throw new AuthError('알림 내용을 읽을 수 없어요');
  return { type: e.type, sub: e.sub };
}
