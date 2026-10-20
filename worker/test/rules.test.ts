import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  autoCategory,
  bonusFor,
  rollDice,
  scoreFor,
  totalFor,
  upperSubtotal,
} from '../../web/js/rules.js';

describe('족보 점수', () => {
  it('상단: 해당 눈의 합', () => {
    expect(scoreFor('ones', [1, 1, 3, 4, 1])).toBe(3);
    expect(scoreFor('sixes', [6, 6, 6, 2, 6])).toBe(24);
    expect(scoreFor('fives', [1, 2, 3, 4, 6])).toBe(0);
  });

  it('초이스: 5개의 합', () => {
    expect(scoreFor('choice', [6, 6, 5, 4, 3])).toBe(24);
  });

  it('포 카드: 같은 눈 4개 이상이면 5개 전체의 합', () => {
    expect(scoreFor('fourKind', [5, 6, 6, 6, 6])).toBe(29);
    expect(scoreFor('fourKind', [3, 3, 3, 3, 3])).toBe(15);
    expect(scoreFor('fourKind', [6, 6, 6, 5, 5])).toBe(0);
  });

  it('풀하우스: 3개+2개면 5개의 합, 야추는 아님', () => {
    expect(scoreFor('fullHouse', [6, 6, 6, 5, 5])).toBe(28);
    expect(scoreFor('fullHouse', [2, 3, 2, 3, 2])).toBe(12);
    expect(scoreFor('fullHouse', [4, 4, 4, 4, 4])).toBe(0);
    expect(scoreFor('fullHouse', [4, 4, 4, 4, 1])).toBe(0);
    expect(scoreFor('fullHouse', [1, 2, 3, 4, 5])).toBe(0);
  });

  it('스몰 스트레이트: 이어지는 눈 4개면 15점', () => {
    expect(scoreFor('smallStraight', [1, 2, 3, 4, 6])).toBe(15);
    expect(scoreFor('smallStraight', [3, 4, 5, 6, 3])).toBe(15);
    expect(scoreFor('smallStraight', [2, 3, 4, 5, 6])).toBe(15);
    expect(scoreFor('smallStraight', [1, 2, 3, 5, 6])).toBe(0);
  });

  it('라지 스트레이트: 이어지는 눈 5개면 30점', () => {
    expect(scoreFor('largeStraight', [5, 4, 3, 2, 1])).toBe(30);
    expect(scoreFor('largeStraight', [2, 3, 4, 5, 6])).toBe(30);
    expect(scoreFor('largeStraight', [1, 2, 3, 4, 6])).toBe(0);
  });

  it('야추: 5개가 같으면 50점', () => {
    expect(scoreFor('yacht', [2, 2, 2, 2, 2])).toBe(50);
    expect(scoreFor('yacht', [2, 2, 2, 2, 3])).toBe(0);
  });
});

describe('합계와 보너스', () => {
  it('상단 63점 이상이면 보너스 35점', () => {
    const sheet = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
    expect(upperSubtotal(sheet)).toBe(63);
    expect(bonusFor(sheet)).toBe(35);
    expect(totalFor({ ...sheet, yacht: 50 })).toBe(63 + 35 + 50);
  });

  it('62점이면 보너스 없음', () => {
    expect(bonusFor({ ones: 2, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 })).toBe(0);
  });
});

describe('시간 초과 자동 선택', () => {
  it('점수가 가장 높은 빈 칸', () => {
    expect(autoCategory({}, [6, 6, 6, 6, 6])).toBe('yacht');
    expect(autoCategory({ yacht: 0 }, [1, 2, 3, 4, 5])).toBe('largeStraight');
  });

  it('모두 0점이면 에이스부터 버린다', () => {
    expect(autoCategory({ choice: 20 }, [2, 2, 3, 3, 6])).not.toBe('choice');
    const zeroSheet = Object.fromEntries(
      CATEGORIES.filter((c) => !['ones', 'yacht', 'twos'].includes(c)).map((c) => [c, 0]),
    );
    expect(autoCategory(zeroSheet, [3, 3, 4, 5, 6])).toBe('ones');
  });
});

describe('굴리기', () => {
  it('고정한 주사위는 그대로', () => {
    const next = rollDice([6, 5, 4, 3, 2], [true, false, true, false, false], () => 0);
    expect(next).toEqual([6, 1, 4, 1, 1]);
  });

  it('처음(0)은 고정해도 새로 굴린다', () => {
    expect(rollDice([0, 0, 0, 0, 0], [true, true, true, true, true], () => 0.99)).toEqual([6, 6, 6, 6, 6]);
  });
});
