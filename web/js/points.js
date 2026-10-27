// 포인트 규칙. 웹(화면 표시)과 서버(지급)가 함께 쓴다.
//
// - 모든 게임: 얻은 점수의 10% (소수점 버림)
// - 같이 하기는 끝까지 했을 때 등수 보너스를 더 받는다 (공동 등수는 같은 보너스)
//   1:1      이긴 사람 10, 진 사람 1
//   1:1:1    1등 15, 2등 5, 3등 1
//   2:2      이긴 팀 각자 20, 진 팀 각자 5

export const SCORE_RATE_PERCENT = 10;

/** @type {Record<string, number[]>} 등수(1부터) 순서의 보너스. 2:2는 팀 등수. */
export const PLACE_BONUS = {
  '1v1': [10, 1],
  '1v1v1': [15, 5, 1],
  '2v2': [20, 5],
};

/** 점수로 받는 포인트 @param {number} score */
export function scorePoints(score) {
  return Math.floor((Math.max(0, Number(score) || 0) * SCORE_RATE_PERCENT) / 100);
}

/** 같이 하기 등수 보너스. rank는 1부터. @param {string} mode @param {number} rank */
export function placeBonus(mode, rank) {
  const table = PLACE_BONUS[mode];
  if (!table || !(rank >= 1)) return 0;
  return table[Math.min(rank, table.length) - 1];
}

// ---------------------------------------------------------------- 포인트 쓰는 곳

/** 처음 정한 뒤 닉네임을 바꿀 때 드는 포인트 */
export const NICKNAME_CHANGE_COST = 300;

/** @type {Record<string, { name: string, short: string, cost: number, verb: string }>} 관전자 야유 (쓸 때마다 포인트 차감) */
export const JEERS = {
  hammer: { name: '뿅망치', short: '뿅망치', cost: 20, verb: '뿅망치!' },
  banana: { name: '바나나 껍질', short: '바나나', cost: 20, verb: '바나나 껍질 투척!' },
};
