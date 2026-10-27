import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../web/js/rules.js';
import { placeBonus, scorePoints } from '../../web/js/points.js';
import {
  AWAY_TURN_MS,
  RoomError,
  attachAccount,
  decideRewards,
  TURN_MS,
  type Mode,
  type RoomState,
  cleanName,
  createRoom,
  disconnect,
  expireTurn,
  hold,
  isRoomCode,
  join,
  leave,
  randomRoomCode,
  rematch,
  roll,
  score,
  setTeam,
  start,
  viewFor,
} from '../src/match';

const T0 = 1_000_000;

/** 0.5를 넘지 않게 돌아가는 간단한 결정적 난수. */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}
const first = () => 0; // 셔플을 하지 않는 효과 + 주사위는 모두 1

function room(mode: Mode, n: number) {
  const s = createRoom('K7Q2', mode, T0);
  const ids = Array.from({ length: n }, (_, i) => join(s, { name: `P${i}`, newId: `p${i}` }, T0));
  return { s, ids };
}

function current(s: RoomState) {
  return s.game!.order[s.game!.turn];
}

/** 현재 차례 사람이 한 번 굴리고 첫 번째 빈 칸에 적는다. */
function playTurn(s: RoomState, now = T0) {
  const id = current(s);
  roll(s, id, now, first);
  const open = CATEGORIES.find((c) => s.game!.sheets[id][c] === undefined)!;
  score(s, id, open, now);
}

describe('방 코드와 닉네임', () => {
  it('헷갈리는 글자 없이 4글자', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomRoomCode();
      expect(isRoomCode(code)).toBe(true);
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it('닉네임은 1~8글자, 한글 가능', () => {
    expect(cleanName('  상원  ')).toBe('상원');
    expect(() => cleanName('')).toThrow(RoomError);
    expect(() => cleanName('가나다라마바사아자')).toThrow(RoomError);
  });
});

describe('대기실', () => {
  it('첫 사람이 방장, 인원이 다 차면 더 못 들어온다', () => {
    const { s } = room('1v1v1', 3);
    expect(s.hostId).toBe('p0');
    expect(() => join(s, { name: 'X', newId: 'x' }, T0)).toThrow('꽉');
  });

  it('방장만, 인원이 다 차야 시작할 수 있다', () => {
    const { s } = room('1v1', 1);
    expect(() => start(s, 'p0', T0, first)).toThrow('2명');
    join(s, { name: 'B', newId: 'p1' }, T0);
    expect(() => start(s, 'p1', T0, first)).toThrow('방장');
    start(s, 'p0', T0, first);
    expect(s.phase).toBe('playing');
    expect(s.game!.turnDeadline).toBe(T0 + TURN_MS);
  });

  it('2vs2는 번갈아 팀이 정해지고, 팀은 두 명까지', () => {
    const { s } = room('2v2', 4);
    expect(s.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    expect(() => setTeam(s, 'p0', 1, T0)).toThrow('두 명');
  });

  it('2vs2 팀 인원이 안 맞으면 시작할 수 없다', () => {
    const { s } = room('2v2', 3);
    expect(() => setTeam(s, 'p1', 0, T0)).toThrow('두 명'); // 0팀 3명은 막힘
    expect(s.players[1].team).toBe(1);
    setTeam(s, 'p0', 1, T0); // 0팀1 / 1팀2
    join(s, { name: 'D', newId: 'p3' }, T0); // 0팀으로
    expect(s.players.filter((p) => p.team === 0)).toHaveLength(2);
    start(s, 'p0', T0, first);
    expect(s.phase).toBe('playing');
  });

  it('2vs2 순서는 팀을 번갈아', () => {
    const { s } = room('2v2', 4);
    start(s, 'p0', T0, seq(0.9, 0.1, 0.1, 0.1, 0.1));
    const teams = s.game!.order.map((id) => s.players.find((p) => p.id === id)!.team);
    expect(teams[0]).not.toBe(teams[1]);
    expect(teams[0]).toBe(teams[2]);
    expect(teams[1]).toBe(teams[3]);
  });

  it('대기실에서 연결이 끊기면 자리가 비고 방장이 넘어간다', () => {
    const { s } = room('1v1v1', 2);
    disconnect(s, 'p0', T0);
    expect(s.players.map((p) => p.id)).toEqual(['p1']);
    expect(s.hostId).toBe('p1');
  });

  it('같은 playerId로 다시 들어오면 재접속', () => {
    const { s } = room('1v1', 2);
    start(s, 'p0', T0, first);
    disconnect(s, 'p1', T0);
    expect(s.players[1].connected).toBe(false);
    expect(join(s, { playerId: 'p1', name: '', newId: 'zzz' }, T0)).toBe('p1');
    expect(s.players[1].connected).toBe(true);
  });

  it('게임 중에는 새 사람이 못 들어온다', () => {
    const { s } = room('1v1', 2);
    start(s, 'p0', T0, first);
    expect(() => join(s, { name: 'X', newId: 'x' }, T0)).toThrow('시작');
  });
});

describe('한 차례', () => {
  it('최대 3번 굴리고, 고정한 주사위는 그대로', () => {
    const { s } = room('1v1', 2);
    start(s, 'p0', T0, first);
    const id = current(s);
    const other = s.game!.order[1];
    expect(() => roll(s, other, T0, first)).toThrow('차례');
    expect(() => hold(s, id, 0, true, T0)).toThrow('먼저');
    expect(() => score(s, id, 'choice', T0)).toThrow('먼저');

    roll(s, id, T0, seq(0.99, 0.5, 0.5, 0.5, 0.5)); // [6,4,4,4,4]
    expect(s.game!.dice).toEqual([6, 4, 4, 4, 4]);
    hold(s, id, 0, true, T0);
    roll(s, id, T0, () => 0); // [6,1,1,1,1]
    expect(s.game!.dice).toEqual([6, 1, 1, 1, 1]);
    roll(s, id, T0, () => 0);
    expect(s.game!.rollsLeft).toBe(0);
    expect(() => roll(s, id, T0, first)).toThrow('더 굴릴');
    expect(s.game!.rollSeq).toBe(3);

    score(s, id, 'ones', T0);
    expect(s.game!.sheets[id].ones).toBe(4);
    expect(current(s)).toBe(other);
    expect(s.game!.rollsLeft).toBe(3);
    expect(s.game!.held).toEqual([false, false, false, false, false]);
  });

  it('이미 적은 칸에는 다시 못 적는다', () => {
    const { s } = room('1v1', 2);
    start(s, 'p0', T0, first);
    playTurn(s); // 첫 사람 ones
    playTurn(s); // 둘째 ones
    const id = current(s);
    roll(s, id, T0, first);
    expect(() => score(s, id, 'ones', T0)).toThrow('이미');
    expect(() => score(s, id, 'nope', T0)).toThrow(RoomError);
  });
});

describe('끝까지', () => {
  for (const [mode, n] of [['1v1', 2], ['1v1v1', 3], ['2v2', 4]] as const) {
    it(`${mode}: 모두 12칸을 채우면 끝나고 순위가 나온다`, () => {
      const { s } = room(mode, n);
      start(s, 'p0', T0, first);
      for (let i = 0; i < 12 * n; i++) {
        expect(s.phase).toBe('playing');
        playTurn(s);
      }
      expect(s.phase).toBe('finished');
      expect(s.game!.endReason).toBe('complete');
      const view = viewFor(s, 'p0', T0);
      expect(view.game!.standings!.players).toHaveLength(n);
      // 모두 같은 주사위(1,1,1,1,1)를 같은 순서로 적었으니 동점 1등
      expect(view.game!.standings!.players.every((p) => p.rank === 1)).toBe(true);
      if (mode === '2v2') expect(view.game!.standings!.teams).toHaveLength(2);
      else expect(view.game!.standings!.teams).toBeNull();
    });
  }
});

describe('시간 초과', () => {
  it('안 굴렸으면 굴리고 가장 높은 칸에 대신 적는다', () => {
    const { s } = room('1v1', 2);
    start(s, 'p0', T0, first);
    const id = current(s);
    expect(expireTurn(s, T0 + TURN_MS - 1, first)).toBe(false);
    expect(expireTurn(s, T0 + TURN_MS, () => 0.99)).toBe(true); // 6,6,6,6,6
    expect(s.game!.sheets[id].yacht).toBe(50);
    expect(s.game!.lastScored).toMatchObject({ playerId: id, category: 'yacht', auto: true });
    expect(current(s)).not.toBe(id);
  });

  it('차례인 사람의 연결이 끊기면 10초만 기다린다', () => {
    const { s } = room('1v1', 2);
    start(s, 'p0', T0, first);
    const id = current(s);
    disconnect(s, id, T0 + 1000);
    expect(s.game!.turnDeadline).toBe(T0 + 1000 + AWAY_TURN_MS);
  });
});

describe('나가기', () => {
  it('1vs1: 나가면 바로 끝나고 남은 사람이 1등', () => {
    const { s } = room('1v1', 2);
    start(s, 'p0', T0, first);
    leave(s, 'p1', T0);
    expect(s.phase).toBe('finished');
    expect(s.game!.endReason).toBe('forfeit');
    const st = viewFor(s, 'p0', T0).game!.standings!.players;
    expect(st[0]).toMatchObject({ seat: 0, rank: 1 });
    expect(st[1]).toMatchObject({ seat: 1, left: true, rank: 2 });
  });

  it('2vs2: 한 명이 나가면 그 팀이 진다', () => {
    const { s } = room('2v2', 4);
    start(s, 'p0', T0, first);
    leave(s, 'p0', T0);
    expect(s.phase).toBe('finished');
    const teams = viewFor(s, 'p1', T0).game!.standings!.teams!;
    expect(teams[0]).toMatchObject({ team: 1, rank: 1 });
    expect(teams[1]).toMatchObject({ team: 0, rank: 2, left: true });
  });

  it('1vs1vs1: 나간 사람만 빠지고 계속, 두 명이 나가면 끝', () => {
    const { s } = room('1v1v1', 3);
    start(s, 'p0', T0, first);
    const [a, b, c] = s.game!.order;
    leave(s, a, T0); // 차례였던 사람이 나감 → 다음 사람
    expect(s.phase).toBe('playing');
    expect(current(s)).toBe(b);
    // 남은 두 명이 끝까지
    for (let i = 0; i < 24; i++) playTurn(s);
    expect(s.phase).toBe('finished');
    expect(s.game!.endReason).toBe('complete');
    expect(Object.keys(s.game!.sheets[a])).toHaveLength(0);

    const { s: s2 } = room('1v1v1', 3);
    start(s2, 'p0', T0, first);
    leave(s2, 'p1', T0);
    leave(s2, 'p2', T0);
    expect(s2.phase).toBe('finished');
    void c;
  });

  it('방장이 나가면 다음 사람이 방장, 다시 하기는 나간 사람 빼고 대기실로', () => {
    const { s } = room('1v1v1', 3);
    start(s, 'p0', T0, first);
    leave(s, 'p0', T0);
    expect(s.hostId).toBe('p1');
    for (let i = 0; i < 24; i++) playTurn(s);
    expect(() => rematch(s, 'p2', T0)).toThrow('방장');
    rematch(s, 'p1', T0);
    expect(s.phase).toBe('lobby');
    expect(s.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    join(s, { name: 'New', newId: 'p9' }, T0);
    start(s, 'p1', T0, first);
    expect(s.match).toBe(2);
  });
});

describe('화면 상태', () => {
  it('다른 사람의 playerId는 보내지 않는다', () => {
    const { s } = room('1v1', 2);
    start(s, 'p0', T0, first);
    playTurn(s);
    const text = JSON.stringify(viewFor(s, 'p0', T0));
    expect(text).not.toContain('"p1"');
    const view = viewFor(s, 'p1', T0);
    expect(view.you).toBe(1);
    expect(view.game!.lastScored).toMatchObject({ category: 'ones' });
    expect(view.game!.lastScored).not.toHaveProperty('playerId');
  });
});

describe('포인트', () => {
  const totalOf = (s: RoomState, id: string) =>
    viewFor(s, id, T0).game!.sheets.find((x) => x.seat === s.players.findIndex((p) => p.id === id))!.total;

  it('점수의 10%(버림)와 등수 보너스 규칙', () => {
    expect(scorePoints(187)).toBe(18);
    expect(scorePoints(9)).toBe(0);
    expect([placeBonus('1v1', 1), placeBonus('1v1', 2)]).toEqual([10, 1]);
    expect([placeBonus('1v1v1', 1), placeBonus('1v1v1', 2), placeBonus('1v1v1', 3)]).toEqual([15, 5, 1]);
    expect([placeBonus('2v2', 1), placeBonus('2v2', 2)]).toEqual([20, 5]);
  });

  it('1:1:1 공동 1등은 둘 다 1등 보너스, 로그인한 사람만', () => {
    const { s } = room('1v1v1', 3);
    attachAccount(s, 'p0', 'u0', null, T0);
    attachAccount(s, 'p2', 'u2', null, T0);
    start(s, 'p0', T0, first);
    for (let i = 0; i < 36; i++) playTurn(s);
    const r = decideRewards(s);
    const total = totalOf(s, 'p0'); // 모두 같은 점수 → 모두 1등
    expect(r).toHaveLength(2);
    expect(r).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'u0', amount: scorePoints(total) + 15 }),
      expect.objectContaining({ userId: 'u2', amount: scorePoints(total) + 15 }),
    ]));
    expect(decideRewards(s)).toEqual(r);
  });

  it('1:1 이긴 쪽 10, 진 쪽 1', () => {
    const { s } = room('1v1', 2);
    attachAccount(s, 'p0', 'u0', null, T0);
    attachAccount(s, 'p1', 'u1', null, T0);
    start(s, 'p0', T0, first);
    // p0은 6만, p1은 1만 굴린다
    for (let i = 0; i < 24; i++) {
      const id = s.game!.order[s.game!.turn];
      roll(s, id, T0, id === 'p0' ? () => 0.99 : () => 0);
      const open = ['yacht', 'sixes', 'choice', 'fourKind', 'ones', 'twos', 'threes', 'fours', 'fives', 'fullHouse', 'smallStraight', 'largeStraight']
        .find((c) => (s.game!.sheets[id] as Record<string, number | undefined>)[c] === undefined)!;
      score(s, id, open, T0);
    }
    const r = Object.fromEntries(decideRewards(s).map((x) => [x.userId, x.amount]));
    expect(r.u0).toBe(scorePoints(totalOf(s, 'p0')) + 10);
    expect(r.u1).toBe(scorePoints(totalOf(s, 'p1')) + 1);
  });

  it('기권으로 끝나면 보너스 없음, 나간 사람은 포인트 없음', () => {
    const { s } = room('1v1', 2);
    attachAccount(s, 'p0', 'u0', null, T0);
    attachAccount(s, 'p1', 'u1', null, T0);
    start(s, 'p0', T0, first);
    playTurn(s);
    playTurn(s);
    leave(s, 'p1', T0);
    const r = decideRewards(s);
    expect(r).toEqual([]); // 에이스 5점 → 0P, 보너스 없음
  });

  it('2:2 이긴 팀 각자 20, 진 팀 각자 5', () => {
    const { s } = room('2v2', 4);
    for (const id of ['p0', 'p1', 'p2', 'p3']) attachAccount(s, id, `u${id}`, null, T0);
    start(s, 'p0', T0, first);
    for (let i = 0; i < 48; i++) {
      const id = s.game!.order[s.game!.turn];
      const team = s.players.find((p) => p.id === id)!.team;
      roll(s, id, T0, team === 0 ? () => 0.99 : () => 0);
      const open = ['yacht', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'choice', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight']
        .find((c) => (s.game!.sheets[id] as Record<string, number | undefined>)[c] === undefined)!;
      score(s, id, open, T0);
    }
    expect(s.phase).toBe('finished');
    const r = Object.fromEntries(decideRewards(s).map((x) => [x.userId, x.amount]));
    expect(r.up0).toBe(scorePoints(totalOf(s, 'p0')) + 20);
    expect(r.up2).toBe(scorePoints(totalOf(s, 'p2')) + 20);
    expect(r.up1).toBe(scorePoints(totalOf(s, 'p1')) + 5);
    expect(r.up3).toBe(scorePoints(totalOf(s, 'p3')) + 5);
  });

  it('화면 상태에는 계정 id를 보내지 않는다', () => {
    const { s } = room('1v1', 2);
    attachAccount(s, 'p0', 'secret-user', { animal: 'fox' }, T0);
    const text = JSON.stringify(viewFor(s, 'p1', T0));
    expect(text).not.toContain('secret-user');
    expect(text).toContain('fox');
  });
});
