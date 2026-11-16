import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../web/js/rules.js';
import { RoomError, createRoom, join, roll, score, setItems, start, useItem, viewFor, type RoomState } from '../src/match';

const T0 = 1_000_000;
const first = () => 0; // 셔플 없음, 주사위는 모두 1

function itemRoom(items = true) {
  const s = createRoom('K7Q2', '1v1', T0, items);
  const ids = [0, 1].map((i) => join(s, { name: `P${i}`, newId: `p${i}` }, T0));
  start(s, ids[0], T0, first);
  return { s, ids };
}
const cur = (s: RoomState) => s.game!.order[s.game!.turn];

describe('아이템전', () => {
  it('시작할 때 종류별로 하나씩 받는다', () => {
    const { s } = itemRoom();
    for (const id of s.game!.order) expect(s.game!.items![id]).toEqual({ reroll: 1, erase: 1, flip: 1 });
    expect(viewFor(s, 'p0', T0).items).toBe(true);
  });

  it('기본전에서는 쓸 수 없다', () => {
    const { s } = itemRoom(false);
    roll(s, cur(s), T0, first);
    expect(() => useItem(s, cur(s), 'flip', 0, T0)).toThrow(RoomError);
  });

  it('방장만 대기실에서 바꿀 수 있다', () => {
    const s = createRoom('K7Q2', '1v1', T0);
    join(s, { name: 'A', newId: 'a' }, T0);
    join(s, { name: 'B', newId: 'b' }, T0);
    expect(() => setItems(s, 'b', true, T0)).toThrow(RoomError);
    setItems(s, 'a', true, T0);
    expect(s.items).toBe(true);
  });

  it('한 번 더 굴리기: 세 번 다 굴린 뒤에만, 한 판에 한 번', () => {
    const { s } = itemRoom();
    const id = cur(s);
    roll(s, id, T0, first);
    expect(() => useItem(s, id, 'reroll', null, T0)).toThrow('세 번 다 굴린 뒤에');
    roll(s, id, T0, first);
    roll(s, id, T0, first);
    useItem(s, id, 'reroll', null, T0);
    expect(s.game!.rollsLeft).toBe(1);
    expect(s.game!.bonusRoll).toBe(true);
    roll(s, id, T0, first);
    expect(s.game!.rollsLeft).toBe(0);
    expect(() => useItem(s, id, 'reroll', null, T0)).toThrow('이미 쓴');
  });

  it('주사위 뒤집기: 반대 면으로', () => {
    const { s } = itemRoom();
    const id = cur(s);
    expect(() => useItem(s, id, 'flip', 0, T0)).toThrow('굴린 뒤에');
    roll(s, id, T0, first); // 모두 1
    useItem(s, id, 'flip', 2, T0);
    expect(s.game!.dice).toEqual([1, 1, 6, 1, 1]);
    expect(s.game!.lastItem).toMatchObject({ item: 'flip', index: 2, from: 1, to: 6 });
  });

  it('칸 지우기: 지운 칸은 다시 채우고, 그 사람은 한 차례 더 한다', () => {
    const { s, ids } = itemRoom();
    // 둘 다 12칸을 채우기 직전까지
    for (let t = 0; t < 22; t++) {
      const id = cur(s);
      roll(s, id, T0, first);
      score(s, id, CATEGORIES.find((c) => s.game!.sheets[id][c] === undefined)!, T0);
    }
    const id = cur(s);
    expect(() => useItem(s, id, 'erase', 'yacht', T0)).toThrow('아직 적지 않은');
    useItem(s, id, 'erase', 'ones', T0);
    expect(s.game!.sheets[id].ones).toBeUndefined();
    roll(s, id, T0, first);
    score(s, id, 'ones', T0); // 지운 칸에 다시 적기
    // 상대가 마지막 칸을 채워도, 지운 사람이 한 칸 더 남아 끝나지 않는다
    const other = ids.find((x) => x !== id)!;
    expect(cur(s)).toBe(other);
    roll(s, other, T0, first);
    score(s, other, 'yacht', T0);
    expect(s.phase).toBe('playing');
    expect(cur(s)).toBe(id);
    roll(s, id, T0, first);
    score(s, id, 'yacht', T0);
    expect(s.phase).toBe('finished');
  });

  it('내 차례가 아니면 쓸 수 없다', () => {
    const { s, ids } = itemRoom();
    const other = ids.find((x) => x !== cur(s))!;
    expect(() => useItem(s, other, 'flip', 0, T0)).toThrow('내 차례가 아니에요');
  });
});

describe('아이템 사기', () => {
  it('로그인한 사람만, 다 쓴 아이템만, 종류별로 한 번까지', async () => {
    const { buyItem, canBuyItem, attachAccount } = await import('../src/match');
    const { s, ids } = itemRoom();
    const id = cur(s);
    expect(() => canBuyItem(s, id, 'flip')).toThrow('로그인하면');
    attachAccount(s, id, 'u1', null, T0);
    expect(() => canBuyItem(s, id, 'flip')).toThrow('아직 남아 있는');
    roll(s, id, T0, first);
    useItem(s, id, 'flip', 0, T0);
    expect(canBuyItem(s, id, 'flip')).toBe('u1');
    buyItem(s, id, 'flip', T0);
    expect(s.game!.items![id].flip).toBe(1);
    expect(s.game!.lastItem).toMatchObject({ item: 'flip', bought: true });
    useItem(s, id, 'flip', 1, T0);
    expect(() => canBuyItem(s, id, 'flip')).toThrow('이미 한 번 샀어요');
    expect(ids).toContain(id);
  });
});
