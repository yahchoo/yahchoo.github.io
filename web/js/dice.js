// 주사위 눈 위치 (3x3 칸 번호 0~8)
const PIPS = {
  0: [],
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** 주사위 하나의 눈을 [el] 안에 그린다. */
export function paintDie(el, face) {
  el.dataset.face = String(face);
  el.replaceChildren();
  const spots = PIPS[face] ?? [];
  for (const spot of spots) {
    const pip = document.createElement('i');
    pip.style.gridArea = `${Math.floor(spot / 3) + 1} / ${(spot % 3) + 1}`;
    el.append(pip);
  }
  el.setAttribute('aria-label', face ? `주사위 ${face}` : '아직 굴리지 않은 주사위');
}

export function makeDie(face, tag = 'div') {
  const el = document.createElement(tag);
  el.className = 'die';
  paintDie(el, face);
  return el;
}
