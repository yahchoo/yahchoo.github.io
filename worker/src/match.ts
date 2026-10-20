// 같이 하기: 방 한 개의 규칙. 저장·네트워크와 상관없는 순수 로직이라 단위 테스트한다.
//
// 흐름: lobby(인원 모으기, 2vs2는 팀 고르기) → 방장이 시작 → playing(정해진 순서대로 한 차례씩)
//       → finished(모두 12칸을 채움 또는 기권) → 방장이 '다시 하기'를 누르면 lobby로.
//
// 2vs2는 각자 자기 점수판을 채우고 같은 팀 두 사람의 총점을 더해 겨룬다. 순서는 팀을 번갈아(A1 B1 A2 B2).

import {
  DICE_COUNT,
  ROLLS_PER_TURN,
  autoCategory,
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

export type Mode = '1v1' | '1v1v1' | '2v2';
export const MODES: Record<Mode, { seats: number; teams: boolean }> = {
  '1v1': { seats: 2, teams: false },
  '1v1v1': { seats: 3, teams: false },
  '2v2': { seats: 4, teams: true },
};

export type Phase = 'lobby' | 'playing' | 'finished';
export type EndReason = 'complete' | 'forfeit';

export interface Player {
  id: string;
  name: string;
  /** 2vs2에서만 0 또는 1. */
  team: number | null;
  connected: boolean;
  /** 게임 중에 '나가기'를 눌러 기권했다. */
  left: boolean;
}

export interface ScoredEvent {
  playerId: string;
  category: Category;
  score: number;
  /** 시간이 다 돼서 대신 적었다. */
  auto: boolean;
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

export function createRoom(code: string, mode: Mode, now: number): RoomState {
  return {
    code,
    mode,
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

export function roll(state: RoomState, playerId: string, now: number, rand: () => number): void {
  const game = currentGame(state, playerId);
  if (game.rollsLeft <= 0) throw new RoomError('이번 차례에는 더 굴릴 수 없어요');
  const first = game.rollsLeft === ROLLS_PER_TURN;
  if (first) game.held = Array(DICE_COUNT).fill(false);
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

function write(state: RoomState, game: Game, category: Category, auto: boolean, now: number): void {
  const playerId = game.order[game.turn];
  const score = scoreFor(category, game.dice);
  game.sheets[playerId][category] = score;
  game.lastScored = { playerId, category, score, auto };
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

/**
 * 제한 시간이 지났으면 대신 진행한다. 아직 안 굴렸으면 한 번 굴리고, 점수가 가장 높은 빈 칸에 적는다.
 * 진행했으면 true.
 */
export function expireTurn(state: RoomState, now: number, rand: () => number): boolean {
  const game = state.game;
  if (state.phase !== 'playing' || !game || game.turnDeadline === null || now < game.turnDeadline) {
    return false;
  }
  if (game.rollsLeft === ROLLS_PER_TURN) {
    game.dice = rollDice(game.dice, Array(DICE_COUNT).fill(false), rand);
    game.rollsLeft -= 1;
    game.rollSeq += 1;
  }
  const playerId = game.order[game.turn];
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

/** 한 참가자에게 보낼 화면 상태. 다른 사람의 playerId(재접속 열쇠)는 보내지 않는다. */
export function viewFor(state: RoomState, playerId: string, now: number) {
  const seatOf = (id: string) => state.players.findIndex((p) => p.id === id);
  const game = state.game;
  return {
    type: 'state' as const,
    code: state.code,
    mode: state.mode,
    phase: state.phase,
    match: state.match,
    serverNow: now,
    you: seatOf(playerId),
    host: state.hostId ? seatOf(state.hostId) : -1,
    seats: MODES[state.mode].seats,
    players: state.players.map((p, seat) => ({
      seat,
      name: p.name,
      team: p.team,
      connected: p.connected,
      left: p.left,
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
              }
            : null,
          endReason: game.endReason,
          standings: state.phase === 'finished' ? standings(state) : null,
        }
      : null,
  };
}

export type RoomView = ReturnType<typeof viewFor>;
