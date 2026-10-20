// 야추 규칙 (세계의 아소비 대전 51 기준). 웹(혼자 하기)과 서버(같이 하기)가 함께 쓰는 순수 로직.
//
// - 주사위 5개, 한 차례에 최대 3번 굴림. 굴린 뒤 빈 칸 하나에 점수를 적는다.
// - 12칸을 모두 채우면 끝. 상단(에이스~식스) 합이 63점 이상이면 보너스 35점.

export const DICE_COUNT = 5;
export const ROLLS_PER_TURN = 3;
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;

/** @typedef {'ones'|'twos'|'threes'|'fours'|'fives'|'sixes'|'choice'|'fourKind'|'fullHouse'|'smallStraight'|'largeStraight'|'yacht'} Category */

/** @type {Category[]} */
export const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
/** @type {Category[]} */
export const LOWER = ['choice', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yacht'];
/** @type {Category[]} */
export const CATEGORIES = [...UPPER, ...LOWER];
export const ROUNDS = CATEGORIES.length;

/** @type {Record<Category, {name: string, hint: string}>} */
export const CATEGORY_INFO = {
  ones: { name: '에이스', hint: '1이 나온 주사위의 합' },
  twos: { name: '듀스', hint: '2가 나온 주사위의 합' },
  threes: { name: '트레이', hint: '3이 나온 주사위의 합' },
  fours: { name: '포', hint: '4가 나온 주사위의 합' },
  fives: { name: '파이브', hint: '5가 나온 주사위의 합' },
  sixes: { name: '식스', hint: '6이 나온 주사위의 합' },
  choice: { name: '초이스', hint: '주사위 5개의 합' },
  fourKind: { name: '포 카드', hint: '같은 눈 4개 이상이면 5개의 합' },
  fullHouse: { name: '풀하우스', hint: '같은 눈 3개 + 2개면 5개의 합' },
  smallStraight: { name: 'S. 스트레이트', hint: '이어지는 눈 4개면 15점' },
  largeStraight: { name: 'L. 스트레이트', hint: '이어지는 눈 5개면 30점' },
  yacht: { name: '야추', hint: '5개가 모두 같으면 50점' },
};

/** @param {unknown} value @returns {value is Category} */
export function isCategory(value) {
  return typeof value === 'string' && CATEGORIES.includes(/** @type {Category} */ (value));
}

/** @param {number[]} dice */
function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d] += 1;
  return c;
}

/** @param {number[]} dice */
function sum(dice) {
  return dice.reduce((a, b) => a + b, 0);
}

/** @param {number[]} dice @param {number} length */
function hasRun(dice, length) {
  const c = counts(dice);
  let run = 0;
  for (let face = 1; face <= 6; face++) {
    run = c[face] > 0 ? run + 1 : 0;
    if (run >= length) return true;
  }
  return false;
}

/**
 * 주사위 [dice]를 [category]에 적었을 때의 점수.
 * @param {Category} category
 * @param {number[]} dice
 * @returns {number}
 */
export function scoreFor(category, dice) {
  const c = counts(dice);
  switch (category) {
    case 'ones':
    case 'twos':
    case 'threes':
    case 'fours':
    case 'fives':
    case 'sixes': {
      const face = UPPER.indexOf(category) + 1;
      return c[face] * face;
    }
    case 'choice':
      return sum(dice);
    case 'fourKind':
      return c.some((n) => n >= 4) ? sum(dice) : 0;
    case 'fullHouse': {
      // 3개 + 2개. 5개가 모두 같은 경우(야추)는 풀하우스로 치지 않는다.
      const groups = c.filter((n) => n > 0).sort();
      return groups.length === 2 && groups[0] === 2 && groups[1] === 3 ? sum(dice) : 0;
    }
    case 'smallStraight':
      return hasRun(dice, 4) ? 15 : 0;
    case 'largeStraight':
      return hasRun(dice, 5) ? 30 : 0;
    case 'yacht':
      return c.some((n) => n === 5) ? 50 : 0;
    default:
      return 0;
  }
}

/** @typedef {Partial<Record<Category, number>>} Sheet 적은 칸만 들어 있는 점수판 */

/** @param {Sheet} sheet */
export function upperSubtotal(sheet) {
  return UPPER.reduce((a, cat) => a + (sheet[cat] ?? 0), 0);
}

/** @param {Sheet} sheet */
export function bonusFor(sheet) {
  return upperSubtotal(sheet) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

/** @param {Sheet} sheet */
export function totalFor(sheet) {
  const lower = LOWER.reduce((a, cat) => a + (sheet[cat] ?? 0), 0);
  return upperSubtotal(sheet) + bonusFor(sheet) + lower;
}

/** @param {Sheet} sheet */
export function filledCount(sheet) {
  return CATEGORIES.filter((cat) => sheet[cat] !== undefined).length;
}

/** @param {Sheet} sheet */
export function isComplete(sheet) {
  return filledCount(sheet) === ROUNDS;
}

/** @param {Sheet} sheet */
export function openCategories(sheet) {
  return CATEGORIES.filter((cat) => sheet[cat] === undefined);
}

// 시간이 다 됐을 때 대신 적을 칸을 고르는 순서. 점수가 같으면 앞쪽(버려도 아까움이 적은 칸)을 고른다.
/** @type {Category[]} */
const AUTO_PRIORITY = [
  'ones', 'yacht', 'twos', 'largeStraight', 'smallStraight', 'fourKind',
  'fullHouse', 'threes', 'fours', 'fives', 'sixes', 'choice',
];

/**
 * 시간이 다 됐을 때 자동으로 적을 칸. 점수가 가장 높은 빈 칸을 고른다.
 * @param {Sheet} sheet
 * @param {number[]} dice
 * @returns {Category}
 */
export function autoCategory(sheet, dice) {
  /** @type {Category | null} */
  let best = null;
  let bestScore = -1;
  for (const cat of AUTO_PRIORITY) {
    if (sheet[cat] !== undefined) continue;
    const s = scoreFor(cat, dice);
    if (s > bestScore) {
      best = cat;
      bestScore = s;
    }
  }
  if (best === null) throw new Error('적을 칸이 없어요');
  return best;
}

/**
 * 주사위 굴리기. held[i]가 true인 주사위는 그대로 둔다.
 * @param {number[]} dice
 * @param {boolean[]} held
 * @param {() => number} rand 0 이상 1 미만
 */
export function rollDice(dice, held, rand) {
  return Array.from({ length: DICE_COUNT }, (_, i) =>
    held[i] && dice[i] >= 1 && dice[i] <= 6 ? dice[i] : 1 + Math.floor(rand() * 6),
  );
}
