// 계정: 로그인 토큰 보관, 서버 요청, 구글 로그인 버튼, 내 정보(포인트·아바타) 상태.

import { GOOGLE_CLIENT_ID } from './config.js';
import { apiBase } from './net.js';

const TOKEN_KEY = 'yacht.token';
const ME_KEY = 'yacht.me'; // 화면을 빨리 그리기 위한 마지막 내 정보 (서버가 기준)

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장소를 못 쓰는 환경에서는 이번 방문 동안만 로그인 유지
  }
}

let token = typeof read(TOKEN_KEY) === 'string' ? read(TOKEN_KEY) : null;
let me = token ? read(ME_KEY) : null;
const listeners = new Set();

export function authToken() {
  return token;
}

/** 내 정보: { nickname, nicknameSet, points, avatar, owned } 또는 null(로그인 안 함) */
export function currentUser() {
  return me;
}

export function onAccountChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setMe(next) {
  me = next;
  write(ME_KEY, next);
  for (const fn of listeners) fn(me);
}

function setSession(nextToken, nextMe) {
  token = nextToken;
  write(TOKEN_KEY, nextToken);
  setMe(nextMe);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** 서버 요청. 로그인했으면 토큰을 붙인다. body가 있으면 POST. */
export async function api(path, body) {
  const base = apiBase();
  if (!base) throw new ApiError('서버가 연결되지 않았어요', 0);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) setSession(null, null); // 로그인이 만료됨
  if (!res.ok) throw new ApiError(data.error ?? '잠시 후 다시 시도해 주세요', res.status);
  return data;
}

/** 로그인 기능을 쓸 수 있는지. (구글 클라이언트 ID가 있거나, 로컬 개발) */
export function loginAvailable() {
  return !!apiBase() && (!!GOOGLE_CLIENT_ID || isLocalDev());
}

export function isLocalDev() {
  return ['localhost', '127.0.0.1'].includes(location.hostname);
}

/** 서버에서 내 정보를 다시 받아 온다. */
export async function refreshMe() {
  if (!token) return null;
  try {
    const { me: fresh } = await api('/api/me');
    setMe(fresh);
  } catch {
    // 오프라인이면 마지막 정보를 그대로 쓴다
  }
  return me;
}

/** 포인트만 바뀌었을 때 (서버가 새 잔액을 알려 줌) */
export function updatePoints(balance) {
  if (me && typeof balance === 'number') setMe({ ...me, points: balance });
}

export async function logout() {
  try {
    if (token) await api('/api/auth/logout', {});
  } catch {
    // 서버에 닿지 않아도 이 기기에서는 로그아웃
  }
  setSession(null, null);
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    // 무시
  }
}

export async function saveProfile(changes) {
  const { me: fresh } = await api('/api/me/profile', changes);
  setMe(fresh);
  return fresh;
}

export async function buyItem(itemId) {
  const { me: fresh } = await api('/api/shop/buy', { itemId });
  setMe(fresh);
  return fresh;
}

/* ---------------------------------------------------------------- 구글 로그인 버튼 */

let gisPromise = null;

function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('구글 로그인을 불러오지 못했어요. 잠시 후 다시 시도해 주세요'));
    };
    document.head.append(s);
  });
  return gisPromise;
}

/**
 * [container] 안에 구글 로그인 버튼을 그린다. 로그인에 성공하면 onDone(me), 실패하면 onError(message).
 */
export async function mountGoogleButton(container, { onDone, onError }) {
  container.replaceChildren();
  if (!GOOGLE_CLIENT_ID) return;
  try {
    const google = await loadGis();
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async ({ credential }) => {
        try {
          const data = await api('/api/auth/google', { credential });
          setSession(data.token, data.me);
          onDone(data.me);
        } catch (err) {
          onError(err.message);
        }
      },
      ux_mode: 'popup',
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      logo_alignment: 'left',
      locale: 'ko',
      width: Math.min(320, container.clientWidth || 300),
    });
  } catch (err) {
    onError(err.message);
  }
}

/** 로컬 개발용 로그인 (서버에 DEV_LOGIN=1이 있을 때만 동작) */
export async function devLogin(name) {
  const data = await api('/api/auth/dev', { sub: name });
  setSession(data.token, data.me);
  return data.me;
}
