import { API_BASE } from './config.js';

/** 같이 하기 서버 주소. 설정이 없으면 localhost에서만 로컬 서버를 쓴다. */
export function apiBase() {
  if (API_BASE) return API_BASE.replace(/\/+$/, '');
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return `http://${host}:8787`;
  return '';
}

export async function createRoom(mode) {
  const base = apiBase();
  if (!base) throw new Error('같이 하기 서버가 아직 연결되지 않았어요');
  let res;
  try {
    res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  } catch {
    throw new Error('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? '방을 만들지 못했어요');
  return body.code;
}

const pidKey = (code) => `yacht.pid.${code}`;
const ACTIVE_KEY = 'yacht.activeRoom';

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 무시
  }
}

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 새로고침했을 때 다시 들어갈 방. 이 기기에서 들어간 기록이 있을 때만. */
export function activeRoom() {
  const code = load(ACTIVE_KEY);
  return code && load(pidKey(code)) ? code : null;
}

/**
 * 방 하나와의 WebSocket 연결. 끊기면 같은 playerId로 다시 연결한다.
 * onState(view), onError(message, fatal), onStatus('open' | 'reconnecting')
 */
export class RoomConnection {
  constructor({ code, name, onState, onError, onStatus }) {
    this.code = code;
    this.name = name;
    this.onState = onState;
    this.onError = onError;
    this.onStatus = onStatus;
    this.closed = false;
    this.attempt = 0;
    this.serverOffset = 0;
    this.ws = null;
    this.pingTimer = null;
    this.retryTimer = null;
  }

  connect() {
    const base = apiBase();
    if (!base) {
      this.onError('같이 하기 서버가 아직 연결되지 않았어요', true);
      return;
    }
    const url = new URL(`${base}/api/rooms/${this.code}/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('name', this.name ?? '');
    const pid = load(pidKey(this.code));
    if (pid) url.searchParams.set('playerId', pid);

    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.onStatus('open');
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25_000);
    });
    ws.addEventListener('message', (ev) => {
      if (ev.data === 'pong') return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        store(pidKey(this.code), msg.playerId);
        store(ACTIVE_KEY, this.code);
      } else if (msg.type === 'state') {
        this.serverOffset = msg.serverNow - Date.now();
        this.onState(msg);
      } else if (msg.type === 'error') {
        if (msg.fatal) {
          this.forget();
          this.close();
        }
        this.onError(msg.message, !!msg.fatal);
      }
    });
    ws.addEventListener('close', (ev) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws || this.closed) return;
      if (ev.code === 4000) return; // 다른 탭에서 같은 자리로 들어옴
      this.scheduleRetry();
    });
  }

  scheduleRetry() {
    this.onStatus('reconnecting');
    const delay = Math.min(1000 * 2 ** this.attempt, 8000);
    this.attempt += 1;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.closed) this.connect();
    }, delay);
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /** 서버 시각 기준 지금 (밀리초). */
  now() {
    return Date.now() + this.serverOffset;
  }

  forget() {
    store(pidKey(this.code), null);
    if (load(ACTIVE_KEY) === this.code) store(ACTIVE_KEY, null);
  }

  leave() {
    this.send({ type: 'leave' });
    this.forget();
    this.close();
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    try {
      this.ws?.close(1000);
    } catch {
      // 무시
    }
  }
}
