// 아이템전 아이템 (규칙은 worker/src/match.ts의 useItem)

const SVG = {
  reroll: '<path d="M19.5 12.5a7.5 7.5 0 1 1-2.2-5.6"/><path d="M19.6 4.2v4.6H15"/><path d="M10.2 11.2l1.8-1.2v5"/>',
  erase: '<path d="M9 20h11"/><path d="M4.6 14.6l8.8-8.8a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8L11 18.6H8.6z"/><path d="M8.6 10.6l5.4 5.4"/>',
  flip: '<path d="M7.5 4v15"/><path d="M4.5 16l3 3 3-3"/><path d="M16.5 20V5"/><path d="M13.5 8l3-3 3 3"/>',
  attack: '<circle cx="10.5" cy="14" r="6.5"/><path d="M15.2 9.3l2.6-2.6"/><path d="M19 2.8v2.2M22 6h-2.2M21.1 3.7l-1.4 1.4"/><path d="M7.6 12.4a3 3 0 0 1 2.4-1.8"/>',
};

export const GAME_ITEMS = [
  { id: 'reroll', name: '한 번 더', full: '한 번 더 굴리기', desc: '세 번 다 굴린 뒤 한 번 더 굴려요' },
  { id: 'erase', name: '칸 지우기', full: '칸 지우기', desc: '이미 적은 내 칸 하나를 지워요. 그 칸은 나중에 한 차례 더 채워요' },
  { id: 'flip', name: '뒤집기', full: '주사위 뒤집기', desc: '주사위 하나를 반대 면으로 뒤집어요 (1↔6, 2↔5, 3↔4)' },
  {
    id: 'attack',
    name: '공격',
    full: '상대 칸 지우기',
    desc: '상대 한 명의 12칸 중 하나가 무작위로 지워져요. 빈 칸이 걸리면 꽝! 같이 하기에서만 써요',
    attack: true,
  },
];
export const GAME_ITEM = Object.fromEntries(GAME_ITEMS.map((it) => [it.id, it]));

/** 아이템 아이콘 (선 그림). 색은 글자색을 따른다. */
export function itemIcon(id, cls = 'item-ic') {
  const span = document.createElement('span');
  span.className = `${cls} ic-${id}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24">${SVG[id]}</svg>`;
  return span;
}
