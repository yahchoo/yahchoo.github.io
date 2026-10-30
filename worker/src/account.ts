// 계정: 구글·Apple 로그인, 닉네임·아바타, 포인트, 아이템 상점, 계정 삭제.

import type { Env } from './index';
import { HttpError, json, readJson } from './http';
import { AuthError, SESSION_MS, bearerToken, hashToken, newSessionToken, verifyGoogleIdToken } from './auth';
import {
  type AppleSecrets,
  appleClientIds,
  exchangeAppleCode,
  openToken,
  revokeAppleToken,
  sealToken,
  verifyAppleIdToken,
  verifyAppleNotification,
} from './apple';
import { DEFAULT_AVATAR, ITEM_BY_ID, parseAvatar, validateAvatar } from '../../web/js/avatar.js';
import { RoomError, cleanName } from './match';
import { NICKNAME_CHANGE_COST } from '../../web/js/points.js';

export interface UserRow {
  id: string;
  google_sub: string;
  nickname: string;
  nickname_set: number;
  points: number;
  avatar: string;
  created_at: number;
  updated_at: number;
}

export async function userFromToken(env: Env, token: string): Promise<UserRow | null> {
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hashToken(token), Date.now())
    .first<UserRow>();
}

/** 로그인 토큰이 있으면 그 사용자, 없거나 만료됐으면 null. */
export async function optionalUser(request: Request, env: Env): Promise<UserRow | null> {
  const token = bearerToken(request);
  return token ? userFromToken(env, token) : null;
}

export async function requireUser(request: Request, env: Env): Promise<UserRow> {
  const user = await optionalUser(request, env);
  if (!user) throw new HttpError(401, '로그인이 필요해요. 다시 로그인해 주세요');
  return user;
}

async function ownedItems(env: Env, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT item_id FROM user_items WHERE user_id = ?').bind(userId).all<{ item_id: string }>();
  return results.map((r) => r.item_id).filter((id) => ITEM_BY_ID[id]);
}

export async function meView(env: Env, user: UserRow) {
  return {
    nickname: user.nickname,
    nicknameSet: !!user.nickname_set,
    points: user.points,
    avatar: parseAvatar(user.avatar),
    owned: await ownedItems(env, user.id),
  };
}

/**
 * 포인트 지급. 같은 (reason, ref)로는 한 번만 준다. 지급했으면 true.
 * 두 문장은 한 트랜잭션(batch)으로 실행된다.
 */
export async function grantPoints(env: Env, userId: string, amount: number, reason: string, ref: string): Promise<boolean> {
  if (!(amount > 0)) return false;
  const now = Date.now();
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET points = points + ?1, updated_at = ?5
        WHERE id = ?2 AND NOT EXISTS (SELECT 1 FROM point_log WHERE user_id = ?2 AND reason = ?3 AND ref = ?4)`,
    ).bind(amount, userId, reason, ref, now),
    env.DB.prepare(
      `INSERT INTO point_log (user_id, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    ).bind(userId, amount, reason, ref, now),
  ]);
  return updated.meta.changes > 0;
}

/**
 * 포인트 쓰기. 잔액이 모자라면 아무것도 바꾸지 않고 false.
 * 기록과 차감을 한 트랜잭션으로 한다. ref는 매번 새 값이라 같은 요청이 두 번 빠지지 않는다.
 * extra: 차감이 됐을 때만 함께 실행할 문장 (같은 ref 기록이 있을 때만 바뀌게 쓴다).
 */
export async function spendPoints(
  env: Env,
  userId: string,
  amount: number,
  reason: string,
  extra: (ref: string) => D1PreparedStatement[] = () => [],
): Promise<boolean> {
  if (!(amount > 0)) return false;
  const ref = crypto.randomUUID();
  const now = Date.now();
  const [logged] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO point_log (user_id, amount, reason, ref, created_at)
       SELECT ?1, -?2, ?3, ?4, ?5 WHERE (SELECT points FROM users WHERE id = ?1) >= ?2`,
    ).bind(userId, amount, reason, ref, now),
    env.DB.prepare(
      `UPDATE users SET points = points - ?2, updated_at = ?5
        WHERE id = ?1 AND EXISTS (SELECT 1 FROM point_log WHERE user_id = ?1 AND reason = ?3 AND ref = ?4)`,
    ).bind(userId, amount, reason, ref, now),
    ...extra(ref),
  ]);
  return logged.meta.changes > 0;
}

function defaultNickname(): string {
  return `선원${1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000)}`;
}

/**
 * 로그인 계정(sub)으로 세션 발급. 처음이면 계정을 만든다. 이메일·이름은 저장하지 않는다.
 * sub: 구글은 숫자 그대로, Apple은 'apple:…', 로컬 개발용은 'dev:…' (users.google_sub 칸)
 */
async function issueSession(env: Env, sub: string, afterLogin?: (user: UserRow) => Promise<void>): Promise<Response> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, nickname, avatar, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(google_sub) DO NOTHING`,
  )
    .bind(crypto.randomUUID(), sub, defaultNickname(), JSON.stringify(DEFAULT_AVATAR), now, now)
    .run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(sub).first<UserRow>();
  if (!user) throw new HttpError(500, '계정을 만들지 못했어요');

  if (afterLogin) await afterLogin(user);
  const token = newSessionToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(
      await hashToken(token),
      user.id,
      now,
      now + SESSION_MS,
    ),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(user.id, now),
  ]);
  return json({ token, me: await meView(env, user) });
}

/** 웹 구글 로그인 ID + 앱(iOS 등)용 구글 클라이언트 ID */
function googleClientIds(env: Env): string[] {
  return [env.GOOGLE_CLIENT_ID ?? '', ...(env.GOOGLE_APP_CLIENT_IDS ?? '').split(',')].map((s) => s.trim()).filter(Boolean);
}

async function loginGoogle(request: Request, env: Env): Promise<Response> {
  const clientIds = googleClientIds(env);
  if (!clientIds.length) throw new HttpError(503, '로그인이 아직 준비되지 않았어요');
  const body = await readJson(request);
  try {
    const claims = await verifyGoogleIdToken(body.credential, clientIds, Date.now());
    return await issueSession(env, claims.sub);
  } catch (err) {
    if (err instanceof AuthError) throw new HttpError(401, err.message);
    throw err;
  }
}

function appleSecrets(env: Env): AppleSecrets | null {
  if (!env.APPLE_TEAM_ID || !env.APPLE_SIGNIN_KEY_ID || !env.APPLE_SIGNIN_P8) return null;
  return { teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_SIGNIN_KEY_ID, p8: env.APPLE_SIGNIN_P8 };
}

/**
 * Apple로 로그인 (iOS 앱). body: { identityToken, authorizationCode?, nonce? }
 * authorizationCode가 있으면 refresh token으로 바꿔 암호화해 둔다 (계정 삭제 때 연결 해제용).
 */
async function loginApple(request: Request, env: Env): Promise<Response> {
  const clientIds = appleClientIds(env.APPLE_CLIENT_IDS);
  if (!clientIds.length) throw new HttpError(503, 'Apple 로그인이 아직 준비되지 않았어요');
  const body = await readJson(request);
  let claims;
  try {
    claims = await verifyAppleIdToken(body.identityToken, clientIds, body.nonce, Date.now());
  } catch (err) {
    if (err instanceof AuthError) throw new HttpError(401, err.message);
    throw err;
  }
  const code = typeof body.authorizationCode === 'string' && body.authorizationCode.length < 2000 ? body.authorizationCode : null;
  const secrets = appleSecrets(env);
  const aud = claims.aud;
  return issueSession(env, `apple:${claims.sub}`, async (user) => {
    if (!code || !secrets) return;
    try {
      const refresh = await exchangeAppleCode(secrets, aud, code, Date.now());
      if (!refresh) return;
      await env.DB.prepare(
        `INSERT INTO apple_tokens (user_id, token, client_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, client_id = excluded.client_id, created_at = excluded.created_at`,
      )
        .bind(user.id, await sealToken(secrets, refresh), aud, Date.now())
        .run();
    } catch (err) {
      // 로그인 자체는 성공으로 둔다. 연결 해제용 토큰만 못 받은 것.
      console.error('Apple refresh token 저장 실패', err);
    }
  });
}

/** 계정과 관련 기록을 모두 지운다 (포인트, 아이템, 랭킹, 혼자 하기 기록, 로그인). */
export async function deleteUserData(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_items WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM point_log WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM rankings WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM solo_games WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM apple_tokens WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

/** Apple로 로그인한 계정이면 애플에 연결 해제를 요청한다. (실패해도 계정 삭제는 진행) */
async function revokeApple(env: Env, userId: string): Promise<void> {
  const secrets = appleSecrets(env);
  const row = await env.DB.prepare('SELECT token, client_id FROM apple_tokens WHERE user_id = ?')
    .bind(userId)
    .first<{ token: string; client_id: string }>();
  if (!row || !secrets) return;
  const refresh = await openToken(secrets, row.token);
  if (!refresh) return;
  try {
    await revokeAppleToken(secrets, row.client_id, refresh, Date.now());
  } catch (err) {
    console.error('Apple 연결 해제 실패', err);
  }
}

/** 앱·웹에서 직접 계정 삭제. (App Store 심사 지침 5.1.1(v)) */
async function deleteAccount(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (user.google_sub.startsWith('apple:')) await revokeApple(env, user.id);
  await deleteUserData(env, user.id);
  return json({ deleted: true });
}

/**
 * 애플 서버 알림. 사용자가 애플 설정에서 우리 앱 연결을 끊거나(consent-revoked) 애플 계정을 지우면(account-delete)
 * 우리 계정도 지운다. 이메일 전달 설정 변경 알림은 이메일을 저장하지 않으니 무시한다.
 */
async function appleNotify(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false }, 400);
  }
  try {
    const event = await verifyAppleNotification(body.payload, appleClientIds(env.APPLE_CLIENT_IDS));
    if (event.type === 'consent-revoked' || event.type === 'account-delete') {
      const user = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(`apple:${event.sub}`).first<{ id: string }>();
      if (user) await deleteUserData(env, user.id);
    }
  } catch (err) {
    console.error('Apple 알림 처리 실패', err);
    if (err instanceof AuthError) return json({ ok: false }, 400);
    throw err;
  }
  return json({ ok: true });
}

/** 광고 보고 2배: 끝난 판의 점수 포인트를 받은 뒤 이 시간 안에만. */
const DOUBLE_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * 앱에서 보상형 광고를 끝까지 보면 그 판의 '점수로 받은 포인트'를 한 번 더 준다. (등수 보너스는 제외)
 * body: { kind: 'solo' | 'match', ref } — solo는 게임 id, match는 방 결과의 rewardRef.
 * 판마다 한 번만 (point_log의 (user, reason, ref)가 유일).
 */
async function doublePoints(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const kind = body.kind === 'solo' || body.kind === 'match' ? body.kind : null;
  const ref = typeof body.ref === 'string' && body.ref.length > 0 && body.ref.length < 120 ? body.ref : null;
  if (!kind || !ref) throw new HttpError(400, '잘못된 요청이에요');
  const base = await env.DB.prepare('SELECT amount, created_at FROM point_log WHERE user_id = ? AND reason = ? AND ref = ?')
    .bind(user.id, kind, ref)
    .first<{ amount: number; created_at: number }>();
  if (!base || base.amount <= 0) throw new HttpError(404, '2배로 받을 포인트가 없어요');
  if (Date.now() - base.created_at > DOUBLE_WINDOW_MS) throw new HttpError(409, '2배 받기 시간이 지났어요');
  const granted = await grantPoints(env, user.id, base.amount, `double-${kind}`, ref);
  if (!granted) throw new HttpError(409, '이미 2배를 받았어요');
  const me = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first<{ points: number }>();
  return json({ points: base.amount, balance: me?.points ?? 0 });
}

/** 로컬 개발 전용 로그인. .dev.vars에 DEV_LOGIN=1이 있고, localhost로 접속할 때만 동작한다. */
async function loginDev(request: Request, env: Env): Promise<Response> {
  const host = new URL(request.url).hostname;
  if (env.DEV_LOGIN !== '1' || !['localhost', '127.0.0.1'].includes(host)) throw new HttpError(404, '없는 주소예요');
  const body = await readJson(request);
  if (typeof body.sub !== 'string' || !/^[a-z0-9]{1,20}$/.test(body.sub)) throw new HttpError(400, 'sub');
  return issueSession(env, `dev:${body.sub}`);
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = bearerToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
  return json({ ok: true });
}

async function getMe(request: Request, env: Env): Promise<Response> {
  return json({ me: await meView(env, await requireUser(request, env)) });
}

/** 닉네임·아바타 바꾸기. 둘 중 하나만 보내도 된다. */
async function updateProfile(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  let nickname = user.nickname;
  let nicknameSet = user.nickname_set;
  let avatar = user.avatar;
  let paidRename = false;
  if (body.nickname !== undefined) {
    try {
      nickname = cleanName(body.nickname);
    } catch (err) {
      if (err instanceof RoomError) throw new HttpError(400, err.message);
      throw err;
    }
    // 처음 정할 때는 무료, 그 뒤로 바꾸면 포인트가 든다. (같은 이름 그대로면 무료)
    paidRename = !!user.nickname_set && nickname !== user.nickname;
    nicknameSet = 1;
  }
  if (body.avatar !== undefined) {
    const checked = validateAvatar(body.avatar, await ownedItems(env, user.id));
    if ('error' in checked) throw new HttpError(400, checked.error as string);
    avatar = JSON.stringify(checked.avatar);
  }
  if (paidRename) {
    const ok = await spendPoints(env, user.id, NICKNAME_CHANGE_COST, 'nickname', (ref) => [
      env.DB.prepare(
        `UPDATE users SET nickname = ?1 WHERE id = ?2
          AND EXISTS (SELECT 1 FROM point_log WHERE user_id = ?2 AND reason = 'nickname' AND ref = ?3)`,
      ).bind(nickname, user.id, ref),
    ]);
    if (!ok) {
      throw new HttpError(409, `닉네임을 바꾸려면 ${NICKNAME_CHANGE_COST}포인트가 필요해요. ${NICKNAME_CHANGE_COST - user.points}포인트 더 모아야 해요`);
    }
  }
  const updated = await env.DB.prepare(
    `UPDATE users SET nickname = ?, nickname_set = ?, avatar = ?, updated_at = ? WHERE id = ? RETURNING *`,
  )
    .bind(nickname, nicknameSet, avatar, Date.now(), user.id)
    .first<UserRow>();
  return json({ me: await meView(env, updated ?? user) });
}

/**
 * 아이템 구매. 포인트 확인·아이템 지급·포인트 차감·기록을 한 트랜잭션으로 한다.
 * (동시에 두 번 눌러도 한 번만 산다)
 */
async function buy(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const item = typeof body.itemId === 'string' ? ITEM_BY_ID[body.itemId] : undefined;
  if (!item) throw new HttpError(400, '없는 아이템이에요');
  if (item.price === 0) throw new HttpError(409, '이미 가지고 있는 아이템이에요');

  const now = Date.now();
  const [, charged] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_items (user_id, item_id, acquired_at)
       SELECT ?1, ?2, ?3 WHERE (SELECT points FROM users WHERE id = ?1) >= ?4
       ON CONFLICT DO NOTHING`,
    ).bind(user.id, item.id, now, item.price),
    env.DB.prepare(
      `UPDATE users SET points = points - ?4, updated_at = ?3
        WHERE id = ?1
          AND EXISTS (SELECT 1 FROM user_items WHERE user_id = ?1 AND item_id = ?2 AND acquired_at = ?3)
          AND NOT EXISTS (SELECT 1 FROM point_log WHERE user_id = ?1 AND reason = 'buy' AND ref = ?2)`,
    ).bind(user.id, item.id, now, item.price),
    env.DB.prepare(
      `INSERT INTO point_log (user_id, amount, reason, ref, created_at)
       SELECT ?1, -?4, 'buy', ?2, ?3
        WHERE EXISTS (SELECT 1 FROM user_items WHERE user_id = ?1 AND item_id = ?2 AND acquired_at = ?3)
       ON CONFLICT DO NOTHING`,
    ).bind(user.id, item.id, now, item.price),
  ]);

  if (!charged.meta.changes) {
    const owned = await ownedItems(env, user.id);
    if (owned.includes(item.id)) throw new HttpError(409, '이미 가지고 있는 아이템이에요');
    throw new HttpError(409, `포인트가 부족해요. ${item.price - user.points}포인트 더 모아야 해요`);
  }
  const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>();
  return json({ me: await meView(env, fresh ?? user) });
}

/** 계정 관련 주소. 해당하면 응답, 아니면 null. */
export function accountRoute(key: string, request: Request, env: Env): Promise<Response> | null {
  switch (key) {
    case 'POST /api/auth/google':
      return loginGoogle(request, env);
    case 'POST /api/auth/dev':
      return loginDev(request, env);
    case 'POST /api/auth/apple':
      return loginApple(request, env);
    case 'POST /api/auth/apple/notify':
      return appleNotify(request, env);
    case 'POST /api/me/delete':
      return deleteAccount(request, env);
    case 'POST /api/points/double':
      return doublePoints(request, env);
    case 'POST /api/auth/logout':
      return logout(request, env);
    case 'GET /api/me':
      return getMe(request, env);
    case 'POST /api/me/profile':
      return updateProfile(request, env);
    case 'POST /api/shop/buy':
      return buy(request, env);
    default:
      return null;
  }
}
