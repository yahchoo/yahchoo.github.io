// 혼자 하기(랭킹용): 서버가 주사위를 굴린다. 저장과 상관없는 순수 로직이라 단위 테스트한다.

import {
  DICE_COUNT,
  ROLLS_PER_TURN,
  isCategory,
  isComplete,
  rollDice,
  scoreFor,
  totalFor,
  type Category,
  type Sheet,
} from '../../web/js/rules.js';
import { ITEM_KINDS, type ItemCounts, type ItemKind } from './match';

export interface SoloState {
  sheet: Sheet;
  dice: number[];
  held: boolean[];
  rollsLeft: number;
  rollSeq: number;
  /** 아이템전: 남은 아이템. 기본전이면 없음. (규칙은 같이 하기와 같다) */
  items?: Partial<ItemCounts> | null;
  /** 포인트로 한 번 더 산 아이템 (한 판에 종류별로 한 번) */
  bought?: Partial<ItemCounts>;
  /** 이번 차례에 '한 번 더 굴리기'를 썼다 */
  bonusRoll?: boolean;
}

export class SoloError extends Error {}

/** 랭킹은 게임을 끝낸 뒤 이 시간 안에만 등록할 수 있다. */
export const RANK_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 이보다 오래된 미등록 게임은 매일 지운다. */
export const GAME_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function newSolo(items = false): SoloState {
  return {
    ...(items ? { items: { reroll: 1, erase: 1, flip: 1 }, bought: { reroll: 0, erase: 0, flip: 0 }, bonusRoll: false } : {}),
    sheet: {},
    dice: Array(DICE_COUNT).fill(0),
    held: Array(DICE_COUNT).fill(false),
    rollsLeft: ROLLS_PER_TURN,
    rollSeq: 0,
  };
}

export function isFinished(state: SoloState): boolean {
  return isComplete(state.sheet);
}

function parseHeld(value: unknown): boolean[] {
  if (value === undefined || value === null) return Array(DICE_COUNT).fill(false);
  if (!Array.isArray(value) || value.length !== DICE_COUNT || !value.every((v) => typeof v === 'boolean')) {
    throw new SoloError('고정한 주사위 정보가 올바르지 않아요');
  }
  return value as boolean[];
}

/** 굴리기. 첫 굴림은 모두 굴리고, 그 뒤에는 [held]가 true인 주사위를 그대로 둔다. */
export function soloRoll(state: SoloState, held: unknown, rand: () => number): SoloState {
  if (isFinished(state)) throw new SoloError('이미 끝난 게임이에요');
  if (state.rollsLeft <= 0) throw new SoloError('이번 차례에는 더 굴릴 수 없어요');
  const first = state.rollsLeft === ROLLS_PER_TURN;
  const keep = first ? Array(DICE_COUNT).fill(false) : parseHeld(held);
  return {
    ...state,
    dice: rollDice(state.dice, keep, rand),
    held: keep,
    rollsLeft: state.rollsLeft - 1,
    rollSeq: state.rollSeq + 1,
  };
}

/** 빈 칸에 점수를 적고 다음 차례를 준비한다. */
export function soloScore(state: SoloState, category: unknown): SoloState {
  if (isFinished(state)) throw new SoloError('이미 끝난 게임이에요');
  if (!isCategory(category)) throw new SoloError('칸을 다시 골라 주세요');
  if (state.rollsLeft === ROLLS_PER_TURN) throw new SoloError('먼저 주사위를 굴려 주세요');
  if (state.sheet[category] !== undefined) throw new SoloError('이미 적은 칸이에요');
  return {
    ...state,
    sheet: { ...state.sheet, [category as Category]: scoreFor(category, state.dice) },
    dice: Array(DICE_COUNT).fill(0),
    held: Array(DICE_COUNT).fill(false),
    rollsLeft: ROLLS_PER_TURN,
    rollSeq: state.rollSeq,
    ...(state.items ? { bonusRoll: false } : {}),
  };
}

function itemKind(item: unknown): ItemKind {
  if (typeof item !== 'string' || !ITEM_KINDS.includes(item as ItemKind)) throw new SoloError('아이템을 다시 골라 주세요');
  return item as ItemKind;
}

/** 아이템 쓰기 (같이 하기 useItem과 같은 규칙). arg: erase는 칸 이름, flip은 주사위 번호. */
export function soloItem(state: SoloState, item: unknown, arg: unknown): SoloState {
  if (isFinished(state)) throw new SoloError('이미 끝난 게임이에요');
  if (!state.items) throw new SoloError('아이템전이 아니에요');
  const kind = itemKind(item);
  if (kind === 'attack') throw new SoloError('공격 아이템은 같이 하기에서만 쓸 수 있어요');
  if (!((state.items[kind] ?? 0) > 0)) throw new SoloError('이미 쓴 아이템이에요');
  const rolled = state.rollsLeft < ROLLS_PER_TURN;
  const next: SoloState = { ...state, items: { ...state.items, [kind]: (state.items[kind] ?? 0) - 1 } };
  if (kind === 'reroll') {
    if (!rolled || state.rollsLeft > 0) throw new SoloError('세 번 다 굴린 뒤에 쓸 수 있어요');
    next.rollsLeft = 1;
    next.bonusRoll = true;
  } else if (kind === 'flip') {
    if (!rolled) throw new SoloError('주사위를 굴린 뒤에 쓸 수 있어요');
    if (typeof arg !== 'number' || !Number.isInteger(arg) || arg < 0 || arg >= DICE_COUNT) {
      throw new SoloError('뒤집을 주사위를 골라 주세요');
    }
    next.dice = state.dice.map((d, i) => (i === arg ? 7 - d : d));
  } else {
    if (!isCategory(arg)) throw new SoloError('지울 칸을 골라 주세요');
    if (state.sheet[arg] === undefined) throw new SoloError('아직 적지 않은 칸이에요');
    const sheet = { ...state.sheet };
    delete sheet[arg];
    next.sheet = sheet;
  }
  return next;
}

/** 다 쓴 아이템을 하나 더 산다 (포인트 차감은 밖에서). 한 판에 종류별로 한 번. */
export function soloBuy(state: SoloState, item: unknown): SoloState {
  if (isFinished(state)) throw new SoloError('이미 끝난 게임이에요');
  if (!state.items) throw new SoloError('아이템전이 아니에요');
  const kind = itemKind(item);
  if (kind === 'attack') throw new SoloError('공격 아이템은 같이 하기에서만 쓸 수 있어요');
  if ((state.items[kind] ?? 0) > 0) throw new SoloError('아직 남아 있는 아이템이에요');
  if (state.bought?.[kind]) throw new SoloError('이번 판에는 이미 한 번 샀어요');
  return {
    ...state,
    items: { ...state.items, [kind]: (state.items[kind] ?? 0) + 1 },
    bought: { ...(state.bought ?? { reroll: 0, erase: 0, flip: 0 }), [kind]: 1 },
  };
}

export function soloTotal(state: SoloState): number {
  return totalFor(state.sheet);
}

/** 저장된 JSON을 읽는다. 형식이 이상하면 예외. */
export function parseState(json: string): SoloState {
  const s = JSON.parse(json) as SoloState;
  if (!s || typeof s !== 'object' || !Array.isArray(s.dice) || !Array.isArray(s.held) || typeof s.rollsLeft !== 'number') {
    throw new SoloError('게임 정보가 손상됐어요');
  }
  return s;
}

/** 이니셜: 영문 대문자 3글자. */
export function validateInitials(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) return '이니셜은 영문 대문자 3글자예요';
  return null;
}

/** [now]가 속한 주의 시작(한국 시간 월요일 0시)을 밀리초로. */
export function weekStart(now: number): number {
  const kst = now + KST_OFFSET_MS;
  const day = Math.floor(kst / 86_400_000);
  // 1970-01-01은 목요일. 월요일을 0으로 맞춘다.
  const weekday = (day + 3) % 7;
  return (day - weekday) * 86_400_000 - KST_OFFSET_MS;
}

export function weekEnd(now: number): number {
  return weekStart(now) + WEEK_MS;
}
