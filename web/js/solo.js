import {
  CATEGORIES,
  DICE_COUNT,
  ROLLS_PER_TURN,
  filledCount,
  isCategory,
  isComplete,
  rollDice,
  scoreFor,
  totalFor,
} from './rules.js';
import { apiBase } from './net.js';

const LOCAL_KEY = 'yacht.solo.current'; // 오프라인 게임 (기기에서 굴림)
const SERVER_KEY = 'yacht.solo.server'; // 서버 게임 id
const BEST_KEY = 'yacht.solo.best';
const MINE_KEY = 'yacht.rank.mine'; // 내가 등록한 랭킹 id (목록에서 강조)
const INITIALS_KEY = 'yacht.initials';

function random() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

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
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 저장 없이 진행
  }
}

export function bestScore() {
  const best = read(BEST_KEY);
  return typeof best === 'number' ? best : null;
}

/** 최고 기록을 갱신하고 결과를 돌려준다. */
function recordBest(total) {
  const prev = bestScore();
  const newBest = prev === null || total > prev;
  if (newBest) write(BEST_KEY, total);
  return { total, best: newBest ? total : prev, newBest };
}

export function hasSoloInProgress() {
  return !!read(SERVER_KEY) || !!read(LOCAL_KEY);
}

export function clearSoloSaves() {
  write(SERVER_KEY, null);
  write(LOCAL_KEY, null);
}

export function myRankingIds() {
  const ids = read(MINE_KEY);
  return Array.isArray(ids) ? ids : [];
}

export function savedInitials() {
  const v = read(INITIALS_KEY);
  return typeof v === 'string' ? v : '';
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, body) {
  const base = apiBase();
  if (!base) throw new ApiError('서버가 연결되지 않았어요', 0);
  let res;
  try {
    res = await fetch(`${base}${path}`, body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? '잠시 후 다시 시도해 주세요', res.status);
  return data;
}

/** 랭킹 등록. 성공하면 { id, initials, score, rankAll, rankWeek }. */
export async function submitRanking(gameId, initials) {
  const { entry } = await api('/api/rankings', { gameId, initials });
  write(INITIALS_KEY, initials);
  write(MINE_KEY, [...myRankingIds(), entry.id].slice(-50));
  return entry;
}

/** 랭킹 목록. period: 'week' | 'all' */
export function fetchRankings(period) {
  return api(`/api/rankings?period=${period}&limit=50`);
}

/* ---------------------------------------------------------------- 오프라인 게임 */

/** 서버에 연결할 수 없을 때 기기에서 굴리는 게임. 랭킹에는 올릴 수 없다. */
class LocalSoloGame {
  constructor(saved) {
    this.online = false;
    this.rankable = false;
    this.gameId = null;
    if (saved && Array.isArray(saved.dice) && saved.sheet && !isComplete(saved.sheet)) {
      this.sheet = Object.fromEntries(Object.entries(saved.sheet).filter(([k, v]) => isCategory(k) && typeof v === 'number'));
      this.dice = saved.dice;
      this.held = saved.held;
      this.rollsLeft = saved.rollsLeft;
    } else {
      this.sheet = {};
      this.dice = Array(DICE_COUNT).fill(0);
      this.held = Array(DICE_COUNT).fill(false);
      this.rollsLeft = ROLLS_PER_TURN;
    }
    this.rollSeq = 0;
    this.lastScored = null;
  }

  save() {
    write(LOCAL_KEY, isComplete(this.sheet) ? null : {
      sheet: this.sheet, dice: this.dice, held: this.held, rollsLeft: this.rollsLeft,
    });
  }

  async roll() {
    if (isComplete(this.sheet) || this.rollsLeft <= 0) return;
    if (this.rollsLeft === ROLLS_PER_TURN) this.held = Array(DICE_COUNT).fill(false);
    this.dice = rollDice(this.dice, this.held, random);
    this.rollsLeft -= 1;
    this.rollSeq += 1;
    this.save();
  }

  async score(category) {
    if (this.rollsLeft === ROLLS_PER_TURN || this.sheet[category] !== undefined) return null;
    const value = scoreFor(category, this.dice);
    this.sheet = { ...this.sheet, [category]: value };
    this.lastScored = { category, score: value };
    this.dice = Array(DICE_COUNT).fill(0);
    this.held = Array(DICE_COUNT).fill(false);
    this.rollsLeft = ROLLS_PER_TURN;
    this.save();
    return isComplete(this.sheet) ? recordBest(this.total) : null;
  }
}

/* ---------------------------------------------------------------- 서버 게임 */

/** 서버가 주사위를 굴리는 게임. 끝까지 하면 랭킹에 올릴 수 있다. */
class ServerSoloGame {
  constructor(view) {
    this.online = true;
    this.lastScored = null;
    this.apply(view);
    write(SERVER_KEY, view.finished ? null : view.gameId);
  }

  apply(view) {
    this.gameId = view.gameId;
    this.sheet = view.sheet;
    this.dice = view.dice;
    this.held = [...view.held];
    this.rollsLeft = view.rollsLeft;
    this.rollSeq = view.rollSeq;
    this.rankable = view.rankable;
  }

  async roll() {
    if (isComplete(this.sheet) || this.rollsLeft <= 0) return;
    const view = await api('/api/solo/roll', { gameId: this.gameId, held: this.held });
    this.apply(view);
  }

  async score(category) {
    if (this.rollsLeft === ROLLS_PER_TURN || this.sheet[category] !== undefined) return null;
    const before = this.sheet;
    const view = await api('/api/solo/score', { gameId: this.gameId, category });
    this.apply(view);
    this.lastScored = { category, score: view.sheet[category] ?? before[category] };
    if (!view.finished) return null;
    write(SERVER_KEY, null);
    return recordBest(view.total);
  }
}

/* 두 게임 공통 */
for (const Game of [LocalSoloGame, ServerSoloGame]) {
  Object.defineProperties(Game.prototype, {
    round: { get() { return Math.min(filledCount(this.sheet) + 1, CATEGORIES.length); } },
    done: { get() { return isComplete(this.sheet); } },
    total: { get() { return totalFor(this.sheet); } },
  });
  Game.prototype.toggleHold = function toggleHold(i) {
    if (this.rollsLeft === ROLLS_PER_TURN || this.rollsLeft === 0) return;
    this.held[i] = !this.held[i];
    if (!this.online) this.save();
  };
}

/**
 * 혼자 하기 열기. 하던 게임이 있으면 이어서, 없으면 새로 시작한다.
 * 서버에 연결할 수 없으면 기기에서 굴리는 오프라인 게임으로 시작한다.
 * 돌려주는 값: { game, offlineReason }
 */
export async function openSolo({ fresh = false } = {}) {
  if (fresh) clearSoloSaves();

  const serverId = read(SERVER_KEY);
  if (serverId && apiBase()) {
    try {
      const view = await api(`/api/solo/${serverId}`);
      if (!view.finished) return { game: new ServerSoloGame(view), offlineReason: null };
    } catch (err) {
      if (err.status === 0) {
        // 서버에 닿지 않음: 하던 서버 게임은 남겨 두고 오프라인으로
        return { game: new LocalSoloGame(read(LOCAL_KEY)), offlineReason: err.message };
      }
    }
    write(SERVER_KEY, null);
  }

  // 업데이트 전부터 하던 오프라인 게임은 그대로 이어서 한다.
  const local = read(LOCAL_KEY);
  if (local) return { game: new LocalSoloGame(local), offlineReason: '예전에 시작한 게임이라 랭킹에 올릴 수 없어요' };

  if (!apiBase()) return { game: new LocalSoloGame(null), offlineReason: '서버가 연결되지 않아 랭킹에 올릴 수 없어요' };
  try {
    const view = await api('/api/solo/start', {});
    return { game: new ServerSoloGame(view), offlineReason: null };
  } catch (err) {
    return { game: new LocalSoloGame(null), offlineReason: `${err.message}. 이번 판은 랭킹에 올릴 수 없어요` };
  }
}
