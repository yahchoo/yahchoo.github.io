// 같이 하기: 방 한 개의 규칙. 저장·네트워크와 상관없는 순수 로직이라 단위 테스트한다.
//
// 흐름: lobby(인원 모으기, 2vs2는 팀 고르기) → 방장이 시작 → playing(정해진 순서대로 한 차례씩)
//       → finished(모두 12칸을 채움 또는 기권) → 방장이 '다시 하기'를 누르면 lobby로.
//
// 2vs2는 각자 자기 점수판을 채우고 같은 팀 두 사람의 총점을 더해 겨룬다. 순서는 팀을 번갈아(A1 B1 A2 B2).

import { placeBonus, scorePoints } from '../../web/js/points.js';
import {
  CATEGORIES,
  DICE_COUNT,
  ROLLS_PER_TURN,
  autoCategory,
  scratchCategory,
  bonusFor,
  isCategory,
  isComplete,
  rollDice,
  scoreFor,
  totalFor,
  upperSubtotal,
  type Category,
  type Sheet,
} from '../../web/js/rules.js';

export const TURN_MS = 60_000;
/** 차례인 사람의 연결이 끊겼으면 이만큼만 기다리고 대신 진행한다. */
export const AWAY_TURN_MS = 10_000;
export const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const NAME_MAX = 8;
/** 한 방에 관전자는 이만큼까지. */
export const MAX_WATCHERS = 30;

export type Mode = '1v1' | '1v1v1' | '2v2';
export const MODES: Record<Mode, { seats: number; teams: boolean }> = {
  '1v1': { seats: 2, teams: false },
  '1v1v1': { seats: 3, teams: false },
  '2v2': { seats: 4, teams: true },
};

export type Phase = 'lobby' | 'playing' | 'finished';

/**
 * 아이템전: 시작할 때 종류별로 한 개씩 받아 자기 차례에 쓴다.
 * - reroll: 세 번 다 굴린 뒤 한 번 더 굴린다.
 * - erase: 이미 적은 내 칸 하나를 지운다. 그 칸은 다시 비어서 나중에 한 차례 더 채운다.
 * - flip: 굴린 주사위 하나를 반대 면으로 뒤집는다 (1↔6, 2↔5, 3↔4).
 * - attack(공격): 상대 한 명의 12칸 중 하나를 무작위로 골라 지운다. 빈 칸이 걸리면 아무 일 없음.
 *   지워진 칸은 비어서 그 사람이 나중에 한 차례 더 채운다. 같이 하기에서만.
 */
export type ItemKind = 'reroll' | 'erase' | 'flip' | 'attack';
export const ITEM_KINDS: ItemKind[] = ['reroll', 'erase', 'flip', 'attack'];
export type ItemCounts = Record<ItemKind, number>;
const NO_ITEMS: ItemCounts = { reroll: 0, erase: 0, flip: 0, attack: 0 };

export interface ItemEvent {
  playerId: string;
  item: ItemKind;
  /** erase: 지운 칸과 원래 점수 */
  category?: Category;
  score?: number;
  /** 포인트로 산 것 (쓴 게 아니라 하나 늘었다) */
  bought?: boolean;
  /** attack: 공격받은 사람 (category·score는 걸린 칸과 원래 점수, 빈 칸이면 score 없음) */
  targetId?: string;
  /** flip: 뒤집은 주사위와 눈 */
  index?: number;
  from?: number;
  to?: number;
  /** 몇 번째 일인지 (같은 칸을 다시 지워도 화면이 새 일로 알아보게) */
  n: number;
}
export type EndReason = 'complete' | 'forfeit';

export interface Player {
  id: string;
  name: string;
  /** 2vs2에서만 0 또는 1. */
  team: number | null;
  connected: boolean;
  /** 게임 중에 '나가기'를 눌러 기권했다. */
  left: boolean;
  /** 로그인한 계정 (포인트를 받는다). 화면에는 보내지 않는다. */
  userId?: string | null;
  /** 로그인한 계정의 아바타 (화면에 보여 준다) */
  avatar?: unknown;
}


export interface Reward {
  playerId: string;
  userId: string;
  /** 합계 = score + bonus */
  amount: number;
  /** 점수로 받는 포인트 (앱에서 광고를 보면 이만큼 한 번 더 받는다) */
  score: number;
  /** 등수 보너스 (2배 대상 아님) */
  bonus: number;
}

/** 이 판 포인트 기록의 ref. 점수 포인트 2배를 받을 때도 같은 ref를 쓴다. */
export function rewardRef(state: RoomState): string {
  return `${state.code}:${state.createdAt}:${state.match}`;
}

export interface ScoredEvent {
  playerId: string;
  category: Category;
  score: number;
  /** 시간이 다 돼서 대신 적었다. */
  auto: boolean;
  /** 한 번도 굴리지 않아 0점을 적었다. */
  scratch?: boolean;
  /** 몇 번째 일인지 (아이템전에서 지운 칸에 다시 적어도 새로 적은 것으로 알아보게) */
  n?: number;
}

export interface Game {
  /** 차례 순서 (playerId). */
  order: string[];
  turn: number;
  sheets: Record<string, Sheet>;
  dice: number[];
  held: boolean[];
  rollsLeft: number;
  /** 굴릴 때마다 1씩 늘어난다. 화면에서 굴리는 애니메이션을 띄우는 데 쓴다. */
  rollSeq: number;
  turnDeadline: number | null;
  lastScored: ScoredEvent | null;
  endReason: EndReason | null;
  /** 끝났을 때 정한 포인트 (playerId → 포인트). 로그인한 사람만. */
  rewards?: Record<string, number>;
  /** 포인트를 실제로 지급했다. */
  rewardsGranted?: boolean;
  /** 아이템전: 남은 아이템 (playerId → 종류별 개수). 기본전이면 없음. */
  items?: Record<string, ItemCounts> | null;
  /** 아이템전: 포인트로 한 번 더 산 아이템 (playerId → 종류별 0·1). 한 판에 종류별로 한 번까지. */
  bought?: Record<string, ItemCounts>;
  /** 이번 차례에 '한 번 더 굴리기'를 썼다. */
  bonusRoll?: boolean;
  lastItem?: ItemEvent | null;
  /** 점수 적기·아이템 사용이 일어날 때마다 1씩 는다. */
  events?: number;
}

export interface RoomState {
  code: string;
  mode: Mode;
  createdAt: number;
  updatedAt: number;
  phase: Phase;
  hostId: string | null;
  players: Player[];
  game: Game | null;
  /** 이 방에서 몇 번째 판인지. */
  match: number;
  /** 아이템전. 예전에 만든 방은 없음(기본전). */
  items?: boolean;
}

export class RoomError extends Error {}

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && Object.hasOwn(MODES, value);
}

export function isRoomCode(value: string): boolean {
  if (value.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of value) if (!ROOM_CODE_CHARS.includes(ch)) return false;
  return true;
}

export function randomRoomCode(): string {
  const buf = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => ROOM_CODE_CHARS[n % ROOM_CODE_CHARS.length]).join('');
}

/** 닉네임: 앞뒤 공백을 빼고 1~8글자. 제어 문자는 안 된다. */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new RoomError('닉네임을 입력해 주세요');
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) throw new RoomError('닉네임을 입력해 주세요');
  if ([...name].length > NAME_MAX) throw new RoomError(`닉네임은 ${NAME_MAX}글자까지예요`);
  if (/\p{Cc}/u.test(name)) throw new RoomError('닉네임에 쓸 수 없는 글자가 있어요');
  return name;
}

export function createRoom(code: string, mode: Mode, now: number, items = false): RoomState {
  return {
    code,
    mode,
    items,
    createdAt: now,
    updatedAt: now,
    phase: 'lobby',
    hostId: null,
    players: [],
    game: null,
    match: 0,
  };
}

function playerOf(state: RoomState, playerId: string): Player {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new RoomError('이 방의 참가자가 아니에요');
  return player;
}

function teamSize(state: RoomState, team: number): number {
  return state.players.filter((p) => p.team === team).length;
}

/** 방장이 없거나 나갔으면 남은 사람 중 먼저 들어온 사람에게 넘긴다. */
function ensureHost(state: RoomState): void {
  const host = state.players.find((p) => p.id === state.hostId);
  if (host && !host.left) return;
  const next = state.players.find((p) => !p.left && p.connected) ?? state.players.find((p) => !p.left);
  state.hostId = next?.id ?? null;
}

/**
 * 입장. [playerId]가 이미 이 방 참가자면 재접속으로 처리한다.
 * 새 참가자면 [newId]로 등록한다. 돌려주는 값은 이 연결의 playerId.
 */
export function join(
  state: RoomState,
  args: { playerId?: string | null; name: unknown; newId: string },
  now: number,
): string {
  const existing = args.playerId ? state.players.find((p) => p.id === args.playerId) : undefined;
  if (existing && !existing.left) {
    existing.connected = true;
    state.updatedAt = now;
    ensureHost(state);
    return existing.id;
  }

  const name = cleanName(args.name);
  if (state.phase !== 'lobby') throw new RoomError('이미 게임이 시작된 방이에요');
  const { seats, teams } = MODES[state.mode];
  if (state.players.length >= seats) throw new RoomError('방이 꽉 찼어요');

  state.players.push({
    id: args.newId,
    name,
    team: teams ? (teamSize(state, 0) <= teamSize(state, 1) ? 0 : 1) : null,
    connected: true,
    left: false,
  });
  state.updatedAt = now;
  ensureHost(state);
  return args.newId;
}

/** 이 사람이 이미 이 방 참가자(기권 안 함)인지. 재접속이면 관전이 아니라 자기 자리로 돌아간다. */
export function isSeated(state: RoomState, playerId: string | null | undefined): boolean {
  return !!playerId && state.players.some((p) => p.id === playerId && !p.left);
}

/** 새로 자리에 앉을 수 있는지. 게임이 시작됐거나 자리가 다 찼으면 관전으로 들어온다. */
export function hasOpenSeat(state: RoomState): boolean {
  return state.phase === 'lobby' && state.players.length < MODES[state.mode].seats;
}

/** 관전자 응원 대상. 2vs2는 팀(0·1), 그 외는 게임에 참가한 자리 번호. 게임 중이 아니거나 잘못된 값이면 null. */
export function cheerTarget(state: RoomState, value: unknown): { team: number } | { seat: number } | null {
  const game = state.game;
  if (state.phase === 'lobby' || !game) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (MODES[state.mode].teams) return value === 0 || value === 1 ? { team: value } : null;
  const player = state.players[value];
  if (!player || player.left || !game.order.includes(player.id)) return null;
  return { seat: value };
}

/** 2vs2 대기실에서 팀 바꾸기. */
export function setTeam(state: RoomState, playerId: string, team: unknown, now: number): void {
  const player = playerOf(state, playerId);
  if (!MODES[state.mode].teams) throw new RoomError('팀전이 아니에요');
  if (state.phase !== 'lobby') throw new RoomError('게임 중에는 팀을 바꿀 수 없어요');
  if (team !== 0 && team !== 1) throw new RoomError('팀을 다시 골라 주세요');
  if (player.team === team) return;
  if (teamSize(state, team) >= 2) throw new RoomError('그 팀은 이미 두 명이에요');
  player.team = team;
  state.updatedAt = now;
}

/** 공격할 수 있는 상대인지 (나·같은 팀·기권한 사람 제외) */
function attackable(state: RoomState, playerId: string, targetId: string): boolean {
  const me = state.players.find((p) => p.id === playerId);
  const t = state.players.find((p) => p.id === targetId);
  if (!me || !t || t.id === me.id || t.left) return false;
  return t.team === null || t.team !== me.team;
}

/** 방장이 대기실에서 기본전·아이템전을 바꾼다. */
export function setItems(state: RoomState, playerId: string, items: unknown, now: number): void {
  playerOf(state, playerId);
  if (state.hostId !== playerId) throw new RoomError('방장만 바꿀 수 있어요');
  if (state.phase !== 'lobby') throw new RoomError('게임 중에는 바꿀 수 없어요');
  if (typeof items !== 'boolean') throw new RoomError('규칙을 다시 골라 주세요');
  state.items = items;
  state.updatedAt = now;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function turnDeadline(state: RoomState, playerId: string, now: number): number {
  const player = state.players.find((p) => p.id === playerId);
  return now + (player && player.connected ? TURN_MS : AWAY_TURN_MS);
}

function beginTurn(state: RoomState, game: Game, now: number): void {
  game.dice = Array(DICE_COUNT).fill(0);
  game.held = Array(DICE_COUNT).fill(false);
  game.rollsLeft = ROLLS_PER_TURN;
  game.bonusRoll = false;
  game.turnDeadline = turnDeadline(state, game.order[game.turn], now);
}

/** 방장이 게임을 시작한다. 인원이 다 차야 한다. */
export function start(state: RoomState, playerId: string, now: number, rand: () => number): void {
  playerOf(state, playerId);
  if (state.hostId !== playerId) throw new RoomError('방장만 시작할 수 있어요');
  if (state.phase !== 'lobby') throw new RoomError('이미 시작했어요');
  const { seats, teams } = MODES[state.mode];
  if (state.players.length < seats) throw new RoomError(`${seats}명이 모여야 시작할 수 있어요`);

  let order: string[];
  if (teams) {
    if (teamSize(state, 0) !== 2 || teamSize(state, 1) !== 2) {
      throw new RoomError('팀마다 두 명씩 있어야 해요');
    }
    const [first, second] = rand() < 0.5 ? [0, 1] : [1, 0];
    const a = shuffle(state.players.filter((p) => p.team === first).map((p) => p.id), rand);
    const b = shuffle(state.players.filter((p) => p.team === second).map((p) => p.id), rand);
    order = [a[0], b[0], a[1], b[1]];
  } else {
    order = shuffle(state.players.map((p) => p.id), rand);
  }

  const game: Game = {
    order,
    turn: 0,
    sheets: Object.fromEntries(order.map((id) => [id, {}])),
    dice: [],
    held: [],
    rollsLeft: ROLLS_PER_TURN,
    rollSeq: 0,
    turnDeadline: null,
    lastScored: null,
    endReason: null,
    items: state.items ? Object.fromEntries(order.map((id) => [id, { reroll: 1, erase: 1, flip: 1, attack: 1 }])) : null,
    lastItem: null,
    events: 0,
  };
  beginTurn(state, game, now);
  state.game = game;
  state.phase = 'playing';
  state.match += 1;
  state.updatedAt = now;
}

function currentGame(state: RoomState, playerId: string): Game {
  playerOf(state, playerId);
  if (state.phase !== 'playing' || !state.game) throw new RoomError('지금은 게임 중이 아니에요');
  if (state.game.order[state.game.turn] !== playerId) throw new RoomError('내 차례가 아니에요');
  return state.game;
}

/** 굴린 뒤에 주사위 하나를 고정하거나 푼다. */
export function hold(state: RoomState, playerId: string, index: unknown, held: unknown, now: number): void {
  const game = currentGame(state, playerId);
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= DICE_COUNT) {
    throw new RoomError('주사위를 다시 골라 주세요');
  }
  if (game.rollsLeft === ROLLS_PER_TURN) throw new RoomError('먼저 주사위를 굴려 주세요');
  if (game.rollsLeft === 0) throw new RoomError('더 굴릴 수 없어요. 칸을 골라 주세요');
  game.held[index] = typeof held === 'boolean' ? held : !game.held[index];
  state.updatedAt = now;
}

/**
 * 굴리기. held(주사위 5개의 고정 여부)를 함께 보내면 그 고정 상태로 굴린다.
 * 화면에서 고정한 뒤 바로 굴리면 고정 요청보다 먼저 판단되는 일이 없도록, 굴릴 때의 화면 상태를 그대로 쓴다.
 */
export function roll(state: RoomState, playerId: string, now: number, rand: () => number, held?: unknown): void {
  const game = currentGame(state, playerId);
  if (game.rollsLeft <= 0) throw new RoomError('이번 차례에는 더 굴릴 수 없어요');
  const first = game.rollsLeft === ROLLS_PER_TURN;
  if (first) game.held = Array(DICE_COUNT).fill(false);
  else if (Array.isArray(held) && held.length === DICE_COUNT && held.every((h) => typeof h === 'boolean')) {
    game.held = [...held];
  }
  game.dice = rollDice(game.dice, game.held, rand);
  game.rollsLeft -= 1;
  game.rollSeq += 1;
  state.updatedAt = now;
}

function activeIds(state: RoomState, game: Game): string[] {
  return game.order.filter((id) => !state.players.find((p) => p.id === id)?.left);
}

function finish(state: RoomState, game: Game, reason: EndReason, now: number): void {
  state.phase = 'finished';
  game.endReason = reason;
  game.turnDeadline = null;
  state.updatedAt = now;
}

/** 다음 차례로. 남은 사람이 모두 12칸을 채웠으면 끝낸다. */
function advance(state: RoomState, game: Game, now: number): void {
  const active = activeIds(state, game);
  if (active.length === 0 || active.every((id) => isComplete(game.sheets[id]))) {
    finish(state, game, 'complete', now);
    return;
  }
  for (let step = 1; step <= game.order.length; step++) {
    const next = (game.turn + step) % game.order.length;
    const id = game.order[next];
    if (active.includes(id) && !isComplete(game.sheets[id])) {
      game.turn = next;
      beginTurn(state, game, now);
      return;
    }
  }
  finish(state, game, 'complete', now);
}

function write(state: RoomState, game: Game, category: Category, auto: boolean, now: number, scratch = false): void {
  const playerId = game.order[game.turn];
  const score = scratch ? 0 : scoreFor(category, game.dice);
  game.sheets[playerId][category] = score;
  game.events = (game.events ?? 0) + 1;
  game.lastScored = { playerId, category, score, auto, ...(scratch ? { scratch: true } : {}), n: game.events };
  state.updatedAt = now;
  advance(state, game, now);
}

/** 빈 칸에 점수를 적고 차례를 넘긴다. */
export function score(state: RoomState, playerId: string, category: unknown, now: number): void {
  const game = currentGame(state, playerId);
  if (!isCategory(category)) throw new RoomError('칸을 다시 골라 주세요');
  if (game.rollsLeft === ROLLS_PER_TURN) throw new RoomError('먼저 주사위를 굴려 주세요');
  if (game.sheets[playerId][category] !== undefined) throw new RoomError('이미 적은 칸이에요');
  write(state, game, category, false, now);
}

/** 아이템 쓰기 (아이템전, 내 차례에만). arg: erase는 칸 이름, flip은 주사위 번호. */
export function useItem(
  state: RoomState,
  playerId: string,
  item: unknown,
  arg: unknown,
  now: number,
  rand: () => number = Math.random,
): void {
  const game = currentGame(state, playerId);
  if (!game.items) throw new RoomError('아이템전이 아니에요');
  if (typeof item !== 'string' || !ITEM_KINDS.includes(item as ItemKind)) throw new RoomError('아이템을 다시 골라 주세요');
  const kind = item as ItemKind;
  const counts = game.items[playerId];
  if (!counts || !(counts[kind] > 0)) throw new RoomError('이미 쓴 아이템이에요');
  const rolled = game.rollsLeft < ROLLS_PER_TURN;
  const sheet = game.sheets[playerId];
  let event: Omit<ItemEvent, 'n'>;

  if (kind === 'reroll') {
    if (!rolled || game.rollsLeft > 0) throw new RoomError('세 번 다 굴린 뒤에 쓸 수 있어요');
    game.rollsLeft = 1;
    game.bonusRoll = true;
    event = { playerId, item: kind };
  } else if (kind === 'flip') {
    if (!rolled) throw new RoomError('주사위를 굴린 뒤에 쓸 수 있어요');
    if (typeof arg !== 'number' || !Number.isInteger(arg) || arg < 0 || arg >= DICE_COUNT) {
      throw new RoomError('뒤집을 주사위를 골라 주세요');
    }
    const from = game.dice[arg];
    const to = 7 - from;
    game.dice[arg] = to;
    event = { playerId, item: kind, index: arg, from, to };
  } else if (kind === 'attack') {
    // arg: 공격할 사람의 자리 번호
    const target = typeof arg === 'number' && Number.isInteger(arg) ? state.players[arg] : undefined;
    const me = playerOf(state, playerId);
    if (!target || !game.order.includes(target.id)) throw new RoomError('공격할 상대를 골라 주세요');
    if (target.id === playerId) throw new RoomError('나는 공격할 수 없어요');
    if (target.team !== null && target.team === me.team) throw new RoomError('같은 팀은 공격할 수 없어요');
    if (target.left) throw new RoomError('나간 사람은 공격할 수 없어요');
    const category = CATEGORIES[Math.min(CATEGORIES.length - 1, Math.floor(rand() * CATEGORIES.length))];
    const targetSheet = game.sheets[target.id];
    const old = targetSheet[category];
    if (old !== undefined) delete targetSheet[category];
    event = { playerId, item: kind, targetId: target.id, category, ...(old !== undefined ? { score: old } : {}) };
  } else {
    if (!isCategory(arg)) throw new RoomError('지울 칸을 골라 주세요');
    const old = sheet[arg];
    if (old === undefined) throw new RoomError('아직 적지 않은 칸이에요');
    delete sheet[arg];
    event = { playerId, item: kind, category: arg, score: old };
  }

  counts[kind] -= 1;
  game.events = (game.events ?? 0) + 1;
  game.lastItem = { ...event, n: game.events };
  state.updatedAt = now;
}

/**
 * 아이템을 포인트로 살 수 있는지 확인하고 계정 id를 돌려준다. (포인트 차감은 방 밖 DB에서)
 * 로그인한 사람만, 다 쓴 아이템만, 한 판에 종류별로 한 번까지.
 */
export function canBuyItem(state: RoomState, playerId: string, item: unknown): string {
  const player = playerOf(state, playerId);
  const game = state.game;
  if (state.phase !== 'playing' || !game) throw new RoomError('게임 중에만 살 수 있어요');
  if (!game.items) throw new RoomError('아이템전이 아니에요');
  if (typeof item !== 'string' || !ITEM_KINDS.includes(item as ItemKind)) throw new RoomError('아이템을 다시 골라 주세요');
  const kind = item as ItemKind;
  if (player.left) throw new RoomError('기권해서 살 수 없어요');
  if (!player.userId) throw new RoomError('로그인하면 포인트로 살 수 있어요');
  if (isComplete(game.sheets[playerId])) throw new RoomError('12칸을 다 채워서 쓸 곳이 없어요');
  if ((game.items[playerId]?.[kind] ?? 0) > 0) throw new RoomError('아직 남아 있는 아이템이에요');
  if (kind === 'attack' && !game.order.some((id) => id !== playerId && attackable(state, playerId, id))) {
    throw new RoomError('공격할 상대가 없어요');
  }
  if (game.bought?.[playerId]?.[kind]) throw new RoomError('이번 판에는 이미 한 번 샀어요');
  return player.userId;
}

/** 포인트 차감이 끝난 뒤 아이템을 하나 준다. 그 사이 상황이 바뀌었으면 RoomError (환불해야 함). */
export function buyItem(state: RoomState, playerId: string, item: unknown, now: number): void {
  canBuyItem(state, playerId, item);
  const game = state.game as Game;
  const kind = item as ItemKind;
  const counts = (game.items as Record<string, ItemCounts>)[playerId];
  counts[kind] = (counts[kind] ?? 0) + 1;
  game.bought ??= {};
  game.bought[playerId] ??= { ...NO_ITEMS };
  game.bought[playerId][kind] = 1;
  game.events = (game.events ?? 0) + 1;
  game.lastItem = { playerId, item: kind, bought: true, n: game.events };
  state.updatedAt = now;
}

/**
 * 제한 시간이 지났으면 대신 진행한다.
 * - 한 번이라도 굴렸으면 지금 주사위로 점수가 가장 높은 빈 칸에 적는다.
 * - 한 번도 안 굴렸으면 손해가 가장 적은 빈 칸에 0점을 적는다 (가만히 있어도 점수를 얻지 않게).
 * 진행했으면 true.
 */
export function expireTurn(state: RoomState, now: number, rand: () => number): boolean {
  const game = state.game;
  if (state.phase !== 'playing' || !game || game.turnDeadline === null || now < game.turnDeadline) {
    return false;
  }
  const playerId = game.order[game.turn];
  if (game.rollsLeft === ROLLS_PER_TURN) {
    write(state, game, scratchCategory(game.sheets[playerId]), true, now, true);
    return true;
  }
  write(state, game, autoCategory(game.sheets[playerId], game.dice), true, now);
  return true;
}

/** 연결이 끊김. 대기실에서는 자리를 비우고, 게임 중 내 차례였으면 기다리는 시간을 줄인다. */
export function disconnect(state: RoomState, playerId: string, now: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  player.connected = false;
  if (state.phase === 'lobby') {
    state.players = state.players.filter((p) => p.id !== playerId);
  } else if (state.phase === 'playing' && state.game && state.game.order[state.game.turn] === playerId) {
    const deadline = state.game.turnDeadline ?? now;
    state.game.turnDeadline = Math.min(deadline, now + AWAY_TURN_MS);
  }
  ensureHost(state);
  state.updatedAt = now;
}

/**
 * 나가기. 대기실에서는 자리만 비운다.
 * 게임 중에 나가면 기권: 1vs1·2vs2는 그 쪽이 바로 지고, 1vs1vs1은 그 사람만 빠지고 나머지가 계속한다.
 */
export function leave(state: RoomState, playerId: string, now: number): void {
  const player = playerOf(state, playerId);
  state.updatedAt = now;

  if (state.phase === 'lobby') {
    state.players = state.players.filter((p) => p.id !== playerId);
    ensureHost(state);
    return;
  }
  player.left = true;
  player.connected = false;
  ensureHost(state);

  const game = state.game;
  if (state.phase !== 'playing' || !game) return;
  if (state.mode !== '1v1v1' || activeIds(state, game).length <= 1) {
    finish(state, game, 'forfeit', now);
    return;
  }
  if (game.order[game.turn] === playerId) advance(state, game, now);
}

/** 방장이 '다시 하기'를 누르면 나간 사람을 빼고 대기실로 돌아간다. */
export function rematch(state: RoomState, playerId: string, now: number): void {
  playerOf(state, playerId);
  if (state.phase !== 'finished') throw new RoomError('게임이 끝난 뒤에 할 수 있어요');
  if (state.hostId !== playerId) throw new RoomError('방장만 다시 시작할 수 있어요');
  state.players = state.players.filter((p) => !p.left);
  if (MODES[state.mode].teams) {
    // 나간 사람이 있으면 팀 인원이 어긋날 수 있으니 맞춰 둔다.
    for (const p of state.players) {
      if (p.team !== null && teamSize(state, p.team) > 2) p.team = p.team === 0 ? 1 : 0;
    }
  }
  state.phase = 'lobby';
  state.game = null;
  state.updatedAt = now;
  ensureHost(state);
}

export interface Standing {
  seat: number;
  total: number;
  rank: number;
  left: boolean;
}

export interface TeamStanding {
  team: number;
  total: number;
  rank: number;
  seats: number[];
  left: boolean;
}

/** 순위. 기권한 쪽은 점수와 상관없이 맨 뒤. 점수가 같으면 같은 순위. */
function rankBy<T extends { total: number; left: boolean; rank: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => Number(a.left) - Number(b.left) || b.total - a.total);
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1];
    item.rank = prev && prev.left === item.left && prev.total === item.total ? prev.rank : i + 1;
  });
  return sorted;
}

/**
 * 끝난 게임의 포인트를 정한다. 로그인했고 기권하지 않은 사람은 자기 총점만큼,
 * 점수의 10% + 끝까지 한 게임이면 등수 보너스(2:2는 팀 등수). 규칙은 web/js/points.js. 한 번 정하면 바뀌지 않는다.
 */
export function decideRewards(state: RoomState): Reward[] {
  const game = state.game;
  if (state.phase !== 'finished' || !game) return [];
  if (!game.rewards) {
    const { players, teams } = standings(state);
    const complete = game.endReason === 'complete';
    game.rewards = {};
    for (const p of players) {
      const player = state.players[p.seat];
      if (!player?.userId || player.left) continue;
      const rank = teams ? teams.find((t) => t.seats.includes(p.seat))?.rank ?? 0 : p.rank;
      const bonus = complete ? placeBonus(state.mode, rank) : 0;
      game.rewards[player.id] = scorePoints(p.total) + bonus;
    }
  }
  return Object.entries(game.rewards).flatMap(([playerId, amount]) => {
    const userId = state.players.find((p) => p.id === playerId)?.userId;
    const score = Math.min(amount, scorePoints(totalFor(game.sheets[playerId] ?? {})));
    return userId && amount > 0 ? [{ playerId, userId, amount, score, bonus: amount - score }] : [];
  });
}

/** 로그인한 계정을 이 자리에 연결한다 (방에 들어온 뒤 한 번). */
export function attachAccount(state: RoomState, playerId: string, userId: string, avatar: unknown, now: number): void {
  const player = playerOf(state, playerId);
  // 이미 끝난 게임의 포인트는 바꾸지 않는다.
  if (player.userId && player.userId !== userId && state.phase !== 'lobby') throw new RoomError('게임 중에는 계정을 바꿀 수 없어요');
  player.userId = userId;
  player.avatar = avatar;
  state.updatedAt = now;
}

export function standings(state: RoomState): { players: Standing[]; teams: TeamStanding[] | null } {
  const game = state.game;
  if (!game) return { players: [], teams: null };
  const seatOf = (id: string) => state.players.findIndex((p) => p.id === id);
  const players = rankBy(
    game.order.map((id) => ({
      seat: seatOf(id),
      total: totalFor(game.sheets[id]),
      rank: 0,
      left: !!state.players.find((p) => p.id === id)?.left,
    })),
  );
  if (!MODES[state.mode].teams) return { players, teams: null };

  const teams = rankBy(
    [0, 1].map((team) => {
      const members = state.players.filter((p) => p.team === team);
      return {
        team,
        total: members.reduce((a, p) => a + totalFor(game.sheets[p.id] ?? {}), 0),
        rank: 0,
        seats: members.map((p) => seatOf(p.id)),
        left: members.some((p) => p.left),
      };
    }),
  );
  return { players, teams };
}

/**
 * 한 참가자에게 보낼 화면 상태. 다른 사람의 playerId(재접속 열쇠)는 보내지 않는다.
 * playerId가 null이면 관전자 화면 (you = -1).
 */
export function viewFor(state: RoomState, playerId: string | null, now: number, watchers = 0) {
  const seatOf = (id: string) => state.players.findIndex((p) => p.id === id);
  const game = state.game;
  return {
    type: 'state' as const,
    code: state.code,
    mode: state.mode,
    phase: state.phase,
    match: state.match,
    serverNow: now,
    you: playerId ? seatOf(playerId) : -1,
    spectator: !playerId,
    watchers,
    open: hasOpenSeat(state),
    host: state.hostId ? seatOf(state.hostId) : -1,
    seats: MODES[state.mode].seats,
    items: !!state.items,
    players: state.players.map((p, seat) => ({
      seat,
      name: p.name,
      team: p.team,
      connected: p.connected,
      left: p.left,
      avatar: p.avatar ?? null,
    })),
    game: game
      ? {
          order: game.order.map(seatOf),
          turn: state.phase === 'playing' ? seatOf(game.order[game.turn]) : -1,
          dice: game.dice,
          held: game.held,
          rollsLeft: game.rollsLeft,
          rollSeq: game.rollSeq,
          turnDeadline: game.turnDeadline,
          sheets: game.order.map((id) => {
            const sheet = game.sheets[id];
            return {
              seat: seatOf(id),
              scores: sheet,
              upper: upperSubtotal(sheet),
              bonus: bonusFor(sheet),
              total: totalFor(sheet),
            };
          }),
          lastScored: game.lastScored
            ? {
                seat: seatOf(game.lastScored.playerId),
                category: game.lastScored.category,
                score: game.lastScored.score,
                auto: game.lastScored.auto,
                scratch: !!game.lastScored.scratch,
                n: game.lastScored.n ?? 0,
              }
            : null,
          /** 아이템전: 자리마다 남은 아이템. 기본전이면 null. */
          items: game.items
            ? game.order.map((id) => ({
                seat: seatOf(id),
                ...NO_ITEMS,
                ...(game.items?.[id] ?? {}),
                bought: { ...NO_ITEMS, ...(game.bought?.[id] ?? {}) },
              }))
            : null,
          bonusRoll: !!game.bonusRoll,
          lastItem: game.lastItem
            ? {
                seat: seatOf(game.lastItem.playerId),
                item: game.lastItem.item,
                bought: !!game.lastItem.bought,
                category: game.lastItem.category ?? null,
                targetSeat: game.lastItem.targetId ? seatOf(game.lastItem.targetId) : null,
                score: game.lastItem.score ?? null,
                index: game.lastItem.index ?? null,
                from: game.lastItem.from ?? null,
                to: game.lastItem.to ?? null,
                n: game.lastItem.n,
              }
            : null,
          endReason: game.endReason,
          standings: state.phase === 'finished' ? standings(state) : null,
          /** 끝난 뒤 받은 포인트 (자리 → 포인트). 지급이 끝난 뒤에만 보낸다. */
          rewards:
            game.rewards && game.rewardsGranted
              ? Object.fromEntries(Object.entries(game.rewards).map(([id, amount]) => [seatOf(id), amount]))
              : null,
          /** 포인트 기록 ref (앱에서 점수 포인트 2배를 받을 때 보낸다) */
          rewardRef: game.rewards && game.rewardsGranted ? rewardRef(state) : null,
        }
      : null,
  };
}

export type RoomView = ReturnType<typeof viewFor>;
