import { describe, expect, it } from 'vitest';
import {
  SoloError,
  newSolo,
  parseState,
  soloRoll,
  soloScore,
  soloTotal,
  validateInitials,
  weekStart,
} from '../src/solo';
import { CATEGORIES } from '../../web/js/rules.js';

describe('서버 혼자 하기', () => {
  it('첫 굴림은 고정을 무시하고, 다음 굴림은 고정한 주사위를 둔다', () => {
    let s = newSolo();
    s = soloRoll(s, [true, true, true, true, true], () => 0.99);
    expect(s.dice).toEqual([6, 6, 6, 6, 6]);
    expect(s.held).toEqual([false, false, false, false, false]);
    s = soloRoll(s, [true, false, false, false, false], () => 0);
    expect(s.dice).toEqual([6, 1, 1, 1, 1]);
    expect(s.rollsLeft).toBe(1);
    s = soloRoll(s, [true, false, false, false, false], () => 0);
    expect(() => soloRoll(s, null, () => 0)).toThrow(SoloError);
  });

  it('고정 정보가 이상하면 거절', () => {
    const s = soloRoll(newSolo(), null, () => 0);
    expect(() => soloRoll(s, [true], () => 0)).toThrow('고정');
    expect(() => soloRoll(s, 'x', () => 0)).toThrow('고정');
  });

  it('점수 적기와 규칙 검사', () => {
    let s = newSolo();
    expect(() => soloScore(s, 'ones')).toThrow('먼저');
    s = soloRoll(s, null, () => 0); // 1,1,1,1,1
    expect(() => soloScore(s, 'nope')).toThrow(SoloError);
    s = soloScore(s, 'yacht');
    expect(s.sheet.yacht).toBe(50);
    expect(s.rollsLeft).toBe(3);
    s = soloRoll(s, null, () => 0);
    expect(() => soloScore(s, 'yacht')).toThrow('이미');
  });

  it('12칸을 채우면 끝', () => {
    let s = newSolo();
    for (const cat of CATEGORIES) {
      s = soloRoll(s, null, () => 0.99);
      s = soloScore(s, cat);
    }
    // 6,6,6,6,6: 식스 30 + 초이스 30 + 포카드 30 + 야추 50 = 140, 보너스 없음
    expect(soloTotal(s)).toBe(140);
    expect(() => soloRoll(s, null, () => 0)).toThrow('끝난');
    expect(parseState(JSON.stringify(s)).sheet.sixes).toBe(30);
  });

  it('이니셜은 영문 대문자 3글자', () => {
    expect(validateInitials('SWN')).toBeNull();
    expect(validateInitials('sw')).not.toBeNull();
    expect(validateInitials('ABCD')).not.toBeNull();
    expect(validateInitials('가나다')).not.toBeNull();
  });

  it('주간 기준은 한국 시간 월요일 0시', () => {
    // 2026-10-20(화) 20:00 KST = 11:00 UTC → 2026-10-19(월) 00:00 KST = 2026-10-18 15:00 UTC
    expect(new Date(weekStart(Date.UTC(2026, 9, 20, 11))).toISOString()).toBe('2026-10-18T15:00:00.000Z');
    // 월요일 0시 정각은 그 주의 시작
    const mon = Date.UTC(2026, 9, 18, 15);
    expect(weekStart(mon)).toBe(mon);
    // 일요일 23:59 KST는 지난 주
    expect(weekStart(mon - 60_000)).toBe(mon - 7 * 86_400_000);
  });
});
