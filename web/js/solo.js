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

const SAVE_KEY = 'yacht.solo.current';
const BEST_KEY = 'yacht.solo.best';

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

/** 혼자 하기. 주사위와 점수 계산을 모두 기기에서 한다. 새로고침해도 이어서 할 수 있게 저장한다. */
export class SoloGame {
  constructor() {
    const saved = read(SAVE_KEY);
    if (saved && Array.isArray(saved.dice) && saved.sheet && !isComplete(saved.sheet)) {
      this.sheet = Object.fromEntries(Object.entries(saved.sheet).filter(([k, v]) => isCategory(k) && typeof v === 'number'));
      this.dice = saved.dice;
      this.held = saved.held;
      this.rollsLeft = saved.rollsLeft;
    } else {
      this.reset();
    }
    this.rollSeq = 0;
    this.lastScored = null;
  }

  reset() {
    this.sheet = {};
    this.dice = Array(DICE_COUNT).fill(0);
    this.held = Array(DICE_COUNT).fill(false);
    this.rollsLeft = ROLLS_PER_TURN;
    this.rollSeq = 0;
    this.lastScored = null;
    write(SAVE_KEY, null);
  }

  save() {
    write(SAVE_KEY, isComplete(this.sheet) ? null : {
      sheet: this.sheet, dice: this.dice, held: this.held, rollsLeft: this.rollsLeft,
    });
  }

  get round() {
    return Math.min(filledCount(this.sheet) + 1, CATEGORIES.length);
  }

  get done() {
    return isComplete(this.sheet);
  }

  get total() {
    return totalFor(this.sheet);
  }

  roll() {
    if (this.done || this.rollsLeft <= 0) return;
    if (this.rollsLeft === ROLLS_PER_TURN) this.held = Array(DICE_COUNT).fill(false);
    this.dice = rollDice(this.dice, this.held, random);
    this.rollsLeft -= 1;
    this.rollSeq += 1;
    this.save();
  }

  toggleHold(i) {
    if (this.rollsLeft === ROLLS_PER_TURN || this.rollsLeft === 0) return;
    this.held[i] = !this.held[i];
    this.save();
  }

  /** 점수를 적는다. 게임이 끝났으면 { total, best, newBest }를 돌려준다. */
  score(category) {
    if (this.rollsLeft === ROLLS_PER_TURN || this.sheet[category] !== undefined) return null;
    const value = scoreFor(category, this.dice);
    this.sheet[category] = value;
    this.lastScored = { category, score: value };
    this.dice = Array(DICE_COUNT).fill(0);
    this.held = Array(DICE_COUNT).fill(false);
    this.rollsLeft = ROLLS_PER_TURN;
    this.save();
    if (!this.done) return null;

    const total = this.total;
    const prev = bestScore();
    const newBest = prev === null || total > prev;
    if (newBest) write(BEST_KEY, total);
    return { total, best: newBest ? total : prev, newBest };
  }
}
