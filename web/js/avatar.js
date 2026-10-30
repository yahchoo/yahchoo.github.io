// @ts-nocheck  그림 코드(문자열 SVG)는 타입 검사에서 뺀다. 내보내는 함수의 모양은 아래 JSDoc 참고.
// 아바타: 아이템 목록(가격)과 그림. 웹(그리기)과 서버(가격·검증)가 함께 쓰는 순수 모듈.
//
// 아바타 = { animal, hat, face, outfit, bg }  (hat·face·outfit은 없을 수 있음)
// 그림은 120×120 SVG 문자열로 만든다. 레이어 순서: 배경 → 망토 → 귀 → 몸 → 옷 → 머리 → 얼굴 장식 → 모자

/** @typedef {'animal'|'hat'|'face'|'outfit'|'bg'} Slot */

/** @type {{ id: Slot, name: string, optional: boolean }[]} */
export const SLOTS = [
  { id: 'animal', name: '동물', optional: false },
  { id: 'hat', name: '모자', optional: true },
  { id: 'face', name: '얼굴', optional: true },
  { id: 'outfit', name: '옷', optional: true },
  { id: 'bg', name: '배경', optional: false },
];

/** 유료 캐릭터는 모두 같은 가격 (처음 고르는 고양이·강아지·남자·여자는 무료) */
export const ANIMAL_PRICE = 500;

/** @type {{ id: string, slot: Slot, name: string, price: number }[]} */
export const ITEMS = [
  { id: 'cat', slot: 'animal', name: '고양이', price: 0 },
  { id: 'dog', slot: 'animal', name: '강아지', price: 0 },
  { id: 'man', slot: 'animal', name: '남자', price: 0 },
  { id: 'woman', slot: 'animal', name: '여자', price: 0 },
  { id: 'mouse', slot: 'animal', name: '쥐', price: ANIMAL_PRICE },
  { id: 'frog', slot: 'animal', name: '개구리', price: ANIMAL_PRICE },
  { id: 'beaver', slot: 'animal', name: '비버', price: ANIMAL_PRICE },
  { id: 'seal', slot: 'animal', name: '물범', price: ANIMAL_PRICE },
  { id: 'parrot', slot: 'animal', name: '앵무새', price: ANIMAL_PRICE },
  { id: 'wolf', slot: 'animal', name: '늑대', price: ANIMAL_PRICE },
  { id: 'giraffe', slot: 'animal', name: '기린', price: ANIMAL_PRICE },

  { id: 'beanie', slot: 'hat', name: '털모자', price: 150 },
  { id: 'ribbon', slot: 'hat', name: '리본', price: 150 },
  { id: 'straw', slot: 'hat', name: '밀짚모자', price: 300 },
  { id: 'captain', slot: 'hat', name: '선장 모자', price: 600 },
  { id: 'pirate', slot: 'hat', name: '해적 모자', price: 900 },
  { id: 'crown', slot: 'hat', name: '왕관', price: 2000 },

  { id: 'blush', slot: 'face', name: '볼터치', price: 100 },
  { id: 'glasses', slot: 'face', name: '동그란 안경', price: 200 },
  { id: 'sunglasses', slot: 'face', name: '선글라스', price: 400 },
  { id: 'eyepatch', slot: 'face', name: '안대', price: 500 },

  { id: 'sailor', slot: 'outfit', name: '세일러 셔츠', price: 200 },
  { id: 'raincoat', slot: 'outfit', name: '노란 우비', price: 300 },
  { id: 'lifevest', slot: 'outfit', name: '구명조끼', price: 400 },
  { id: 'suit', slot: 'outfit', name: '정장', price: 700 },
  { id: 'cape', slot: 'outfit', name: '망토', price: 1200 },

  { id: 'navy', slot: 'bg', name: '남색', price: 0 },
  { id: 'sea', slot: 'bg', name: '바다', price: 200 },
  { id: 'sunset', slot: 'bg', name: '노을', price: 300 },
  { id: 'flags', slot: 'bg', name: '신호기', price: 400 },
  { id: 'stars', slot: 'bg', name: '별밤', price: 600 },
  { id: 'gold', slot: 'bg', name: '금빛', price: 1500 },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

export const DEFAULT_AVATAR = Object.freeze({ animal: 'cat', hat: null, face: null, outfit: null, bg: 'navy' });

/** 값이 0인 아이템은 누구나 가지고 있다. */
export function isFree(id) {
  return ITEM_BY_ID[id]?.price === 0;
}

/**
 * 저장할 아바타를 검사한다. 가진 아이템(또는 무료 아이템)만 쓸 수 있다.
 * 올바르면 { avatar }, 아니면 { error }.
 * @param {unknown} value
 * @param {Iterable<string>} owned
 */
export function validateAvatar(value, owned) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '아바타 정보가 올바르지 않아요' };
  const have = new Set(owned);
  const avatar = {};
  for (const slot of SLOTS) {
    const id = /** @type {Record<string, unknown>} */ (value)[slot.id] ?? null;
    if (id === null) {
      if (!slot.optional) return { error: `${slot.name}을(를) 골라 주세요` };
      avatar[slot.id] = null;
      continue;
    }
    const item = typeof id === 'string' ? ITEM_BY_ID[id] : undefined;
    if (!item || item.slot !== slot.id) return { error: '없는 아이템이에요' };
    if (item.price > 0 && !have.has(item.id)) return { error: `${item.name}은(는) 아직 가지고 있지 않아요` };
    avatar[slot.id] = item.id;
  }
  return { avatar };
}

/** 저장된 값을 읽는다. 이상하면 기본 아바타. */
export function parseAvatar(value) {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const out = { ...DEFAULT_AVATAR };
  if (v && typeof v === 'object') {
    for (const slot of SLOTS) {
      const id = v[slot.id];
      if (id === null && slot.optional) out[slot.id] = null;
      else if (typeof id === 'string' && ITEM_BY_ID[id]?.slot === slot.id) out[slot.id] = id;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- 그림 */

const INK = '#16213a';

const ANIMALS = {
  cat: { fur: '#f2a65a', dark: '#d9853a', light: '#fde2c2', inner: '#f7b4b4' },
  dog: { fur: '#d9a066', dark: '#8a5a34', light: '#f5dcc0', inner: '#8a5a34' },
  man: { fur: '#f6cba6', dark: '#3b2a22', light: '#ffe2c9', inner: '#e8a98a', shirt: '#4f7fd1' },
  woman: { fur: '#f6cba6', dark: '#5a3424', light: '#ffe2c9', inner: '#e8a98a', shirt: '#e8768f' },
  mouse: { fur: '#aeb3bf', dark: '#878c99', light: '#e4e6ec', inner: '#f5b5c4' },
  frog: { fur: '#6cc070', dark: '#3f8f46', light: '#d6f0c4', inner: '#3f8f46' },
  beaver: { fur: '#9b6a43', dark: '#6e472b', light: '#d7b38d', inner: '#6e472b' },
  seal: { fur: '#a9bccd', dark: '#7d93a8', light: '#e3ebf2', inner: '#7d93a8' },
  parrot: { fur: '#3fb24f', dark: '#2a8a38', light: '#f7e27a', inner: '#e8463b' },
  wolf: { fur: '#8c93a3', dark: '#5d6474', light: '#eef0f4', inner: '#c9ccd6' },
  giraffe: { fur: '#f2c14e', dark: '#b5712d', light: '#f9e2a3', inner: '#b5712d' },
};

/** 얼굴 장식·모자를 동물 모양에 맞추는 위치 보정 (세로 이동) */
const FIT = {
  frog: { face: -12, hat: -9 },
  parrot: { face: -2, hat: 0 },
  giraffe: { face: -2, hat: 2 },
};

function eyes(y = 58, dx = 11) {
  return `<circle cx="${60 - dx}" cy="${y}" r="3.6" fill="${INK}"/><circle cx="${60 + dx}" cy="${y}" r="3.6" fill="${INK}"/>
<circle cx="${61.2 - dx}" cy="${y - 1.2}" r="1.1" fill="#fff"/><circle cx="${61.2 + dx}" cy="${y - 1.2}" r="1.1" fill="#fff"/>`;
}
const smile = (y = 70) => `<path d="M54 ${y} q6 5 12 0" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;

/** 머리 뒤에 그리는 것 (귀, 뒷머리) */
function ears(animal, c) {
  switch (animal) {
    case 'cat':
      return `<path d="M33 46 L36 18 L56 34 Z" fill="${c.fur}"/><path d="M37 40 L39 25 L50 34 Z" fill="${c.inner}"/>
<path d="M87 46 L84 18 L64 34 Z" fill="${c.fur}"/><path d="M83 40 L81 25 L70 34 Z" fill="${c.inner}"/>`;
    case 'mouse':
      return `<circle cx="34" cy="34" r="15" fill="${c.fur}"/><circle cx="34" cy="34" r="9" fill="${c.inner}"/>
<circle cx="86" cy="34" r="15" fill="${c.fur}"/><circle cx="86" cy="34" r="9" fill="${c.inner}"/>`;
    case 'beaver':
      return `<circle cx="37" cy="36" r="8" fill="${c.dark}"/><circle cx="83" cy="36" r="8" fill="${c.dark}"/>`;
    case 'wolf':
      return `<path d="M32 50 L33 14 L57 33 Z" fill="${c.fur}"/><path d="M33 24 L33 14 L42 21 Z" fill="${c.dark}"/><path d="M37 42 L37 25 L50 34 Z" fill="${c.inner}"/>
<path d="M88 50 L87 14 L63 33 Z" fill="${c.fur}"/><path d="M87 24 L87 14 L78 21 Z" fill="${c.dark}"/><path d="M83 42 L83 25 L70 34 Z" fill="${c.inner}"/>`;
    case 'giraffe':
      return `<path d="M48 34 L46 16" stroke="${c.fur}" stroke-width="5" stroke-linecap="round"/><circle cx="46" cy="15" r="5" fill="${c.dark}"/>
<path d="M72 34 L74 16" stroke="${c.fur}" stroke-width="5" stroke-linecap="round"/><circle cx="74" cy="15" r="5" fill="${c.dark}"/>
<ellipse cx="29" cy="47" rx="10" ry="5" transform="rotate(-20 29 47)" fill="${c.fur}"/><ellipse cx="91" cy="47" rx="10" ry="5" transform="rotate(20 91 47)" fill="${c.fur}"/>`;
    case 'woman':
      // 어깨까지 내려오는 뒷머리
      return `<path d="M28 60 q-2 -34 32 -34 q34 0 32 34 l2 34 q-8 6 -16 2 l-2 -30 h-32 l-2 30 q-8 4 -16 -2 z" fill="${c.dark}"/>`;
    default:
      return '';
  }
}

function head(animal, c) {
  switch (animal) {
    case 'cat':
      return `<circle cx="60" cy="58" r="29" fill="${c.fur}"/>
<path d="M60 29 l-4 9 h8 z M50 31 l-2 7 h5 z M70 31 l2 7 h-5 z" fill="${c.dark}"/>
<ellipse cx="60" cy="69" rx="13" ry="9" fill="${c.light}"/>${eyes()}
<path d="M57 65 h6 l-3 3.5 z" fill="#e2798a"/><path d="M60 68.5 q-3 4 -6 2 M60 68.5 q3 4 6 2" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<path d="M44 66 h-12 M44 70 l-11 3 M76 66 h12 M76 70 l11 3" stroke="${c.dark}" stroke-width="1.5" stroke-linecap="round"/>`;
    case 'dog':
      return `<circle cx="60" cy="58" r="29" fill="${c.fur}"/>
<ellipse cx="68" cy="47" rx="10" ry="8" fill="${c.light}" opacity=".55"/>
<ellipse cx="60" cy="70" rx="14" ry="10" fill="${c.light}"/>${eyes()}
<ellipse cx="60" cy="65" rx="5" ry="3.6" fill="${INK}"/><path d="M60 68.5 v3 q-3 3 -6 1 M60 71.5 q3 3 6 1" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<path d="M33 40 q-8 4 -6 26 q2 8 9 4 q4 -14 6 -26 z" fill="${c.dark}"/><path d="M87 40 q8 4 6 26 q-2 8 -9 4 q-4 -14 -6 -26 z" fill="${c.dark}"/>`;
    case 'man':
      return `<ellipse cx="32" cy="60" rx="4.5" ry="6.5" fill="${c.fur}"/><ellipse cx="88" cy="60" rx="4.5" ry="6.5" fill="${c.fur}"/>
<circle cx="60" cy="58" r="27" fill="${c.fur}"/>
<path d="M33 54 q-3 -26 27 -26 q30 0 27 26 q-4 -12 -14 -14 q-6 6 -22 6 q-12 0 -14 -2 q-3 4 -4 10 z" fill="${c.dark}"/>
${eyes(60, 10)}<path d="M45 52 h8 M67 52 h8" stroke="${c.dark}" stroke-width="2.4" stroke-linecap="round"/>
<path d="M60 63 q-2 3 0 4" stroke="${c.inner}" stroke-width="1.8" fill="none" stroke-linecap="round"/>${smile(72)}`;
    case 'woman':
      return `<circle cx="60" cy="58" r="27" fill="${c.fur}"/>
<path d="M33 58 q-4 -30 27 -30 q31 0 27 30 q-6 -14 -16 -18 q-8 10 -26 12 q-8 0 -12 6 z" fill="${c.dark}"/>
${eyes(60, 10)}<path d="M45 55 q4 -2 8 0 M67 55 q4 -2 8 0" stroke="${c.dark}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
<ellipse cx="44" cy="68" rx="5" ry="3" fill="#ff9aa8" opacity=".55"/><ellipse cx="76" cy="68" rx="5" ry="3" fill="#ff9aa8" opacity=".55"/>
<path d="M60 63 q-2 3 0 4" stroke="${c.inner}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M55 72 q5 4 10 0" stroke="#d65a6c" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    case 'mouse':
      return `<circle cx="60" cy="58" r="28" fill="${c.fur}"/>
<ellipse cx="60" cy="70" rx="12" ry="9" fill="${c.light}"/>${eyes()}
<circle cx="60" cy="66" r="3.4" fill="#e2798a"/><path d="M60 69.4 v2 q-3 3 -6 1 M60 71.4 q3 3 6 1" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
<path d="M46 67 h-14 M46 71 l-13 4 M74 67 h14 M74 71 l13 4" stroke="${c.dark}" stroke-width="1.3" stroke-linecap="round"/>`;
    case 'frog':
      return `<circle cx="47" cy="45" r="11" fill="${c.fur}"/><circle cx="73" cy="45" r="11" fill="${c.fur}"/>
<ellipse cx="60" cy="63" rx="31" ry="24" fill="${c.fur}"/>
<circle cx="47" cy="46" r="7.5" fill="#fff"/><circle cx="73" cy="46" r="7.5" fill="#fff"/>
<circle cx="48" cy="47" r="3.8" fill="${INK}"/><circle cx="74" cy="47" r="3.8" fill="${INK}"/>
<circle cx="49.2" cy="45.6" r="1.2" fill="#fff"/><circle cx="75.2" cy="45.6" r="1.2" fill="#fff"/>
<ellipse cx="60" cy="72" rx="20" ry="10" fill="${c.light}" opacity=".6"/>
<circle cx="56" cy="61" r="1.3" fill="${c.dark}"/><circle cx="64" cy="61" r="1.3" fill="${c.dark}"/>
<path d="M42 68 q18 12 36 0" stroke="${c.dark}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<ellipse cx="40" cy="66" rx="5" ry="3" fill="#ff9aa8" opacity=".5"/><ellipse cx="80" cy="66" rx="5" ry="3" fill="#ff9aa8" opacity=".5"/>`;
    case 'beaver':
      return `<circle cx="60" cy="58" r="28" fill="${c.fur}"/>
<ellipse cx="60" cy="71" rx="15" ry="11" fill="${c.light}"/>${eyes(56)}
<ellipse cx="60" cy="65" rx="6" ry="4" fill="${INK}"/>
<path d="M60 69 v3" stroke="${INK}" stroke-width="1.6"/>
<rect x="55" y="72" width="10" height="9" rx="2" fill="#fff" stroke="${c.dark}" stroke-width="1"/><path d="M60 72 v9" stroke="${c.dark}" stroke-width="1"/>
<path d="M44 68 h-10 M44 72 l-9 3 M76 68 h10 M76 72 l9 3" stroke="${c.dark}" stroke-width="1.2" stroke-linecap="round"/>`;
    case 'seal':
      return `<circle cx="60" cy="58" r="29" fill="${c.fur}"/>
<circle cx="44" cy="44" r="2.4" fill="${c.dark}"/><circle cx="76" cy="40" r="2" fill="${c.dark}"/><circle cx="70" cy="34" r="1.6" fill="${c.dark}"/>
<circle cx="49" cy="58" r="5" fill="${INK}"/><circle cx="71" cy="58" r="5" fill="${INK}"/>
<circle cx="50.8" cy="56.2" r="1.7" fill="#fff"/><circle cx="72.8" cy="56.2" r="1.7" fill="#fff"/>
<circle cx="55" cy="70" r="6.5" fill="${c.light}"/><circle cx="65" cy="70" r="6.5" fill="${c.light}"/>
<ellipse cx="60" cy="65" rx="4.5" ry="3.2" fill="${INK}"/>
<circle cx="53" cy="70" r=".9" fill="${c.dark}"/><circle cx="56" cy="72.5" r=".9" fill="${c.dark}"/><circle cx="64" cy="72.5" r=".9" fill="${c.dark}"/><circle cx="67" cy="70" r=".9" fill="${c.dark}"/>
<path d="M50 70 h-14 M50 73 l-12 4 M70 70 h14 M70 73 l12 4" stroke="${c.dark}" stroke-width="1.2" stroke-linecap="round"/>`;
    case 'parrot':
      return `<path d="M58 30 q-6 -14 4 -18 q-2 8 4 14 z" fill="${c.inner}"/><path d="M62 30 q2 -14 12 -14 q-6 6 -4 16 z" fill="#f2b632"/>
<circle cx="60" cy="58" r="29" fill="${c.fur}"/>
<ellipse cx="60" cy="62" rx="20" ry="17" fill="${c.light}"/>
<circle cx="49" cy="56" r="6.5" fill="#fff"/><circle cx="71" cy="56" r="6.5" fill="#fff"/>${eyes(56)}
<path d="M53 62 q7 -6 14 0 q2 10 -7 16 q-1 -8 -7 -16 z" fill="#f29a33"/><path d="M53 62 q7 -4 14 0" stroke="#c96f12" stroke-width="1.2" fill="none"/>
<path d="M55 70 q5 4 9 -1" stroke="#c96f12" stroke-width="1.2" fill="none"/>`;
    case 'wolf':
      return `<path d="M30 54 q0 -26 30 -26 q30 0 30 26 q0 14 -8 22 q-10 10 -22 12 q-12 -2 -22 -12 q-8 -8 -8 -22 z" fill="${c.fur}"/>
<path d="M31 58 l-5 8 l8 -1 l-3 7 l9 -3 q-6 -4 -9 -11 z M89 58 l5 8 l-8 -1 l3 7 l-9 -3 q6 -4 9 -11 z" fill="${c.fur}"/>
<path d="M44 64 q16 -10 32 0 q-2 18 -16 22 q-14 -4 -16 -22 z" fill="${c.light}"/>
<path d="M50 50 l-8 -4 M70 50 l8 -4" stroke="${c.dark}" stroke-width="2.4" stroke-linecap="round"/>
${eyes()}<ellipse cx="60" cy="69" rx="5.5" ry="3.8" fill="${INK}"/>
<path d="M60 72.5 v3 q-3 3 -6 1 M60 75.5 q3 3 6 1" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    case 'giraffe':
      return `<ellipse cx="60" cy="56" rx="25" ry="27" fill="${c.fur}"/>
<path d="M40 44 q4 -4 8 0 q-2 5 -8 0 z M72 40 q5 -3 9 1 q-4 5 -9 -1 z M58 34 q4 -3 7 0 q-3 4 -7 0 z" fill="${c.dark}" opacity=".85"/>
<ellipse cx="60" cy="72" rx="17" ry="13" fill="${c.light}"/>${eyes(55)}
<ellipse cx="54" cy="70" rx="2" ry="1.5" fill="${c.dark}"/><ellipse cx="66" cy="70" rx="2" ry="1.5" fill="${c.dark}"/>
${smile(77)}`;
    default:
      return '';
  }
}

function body(animal, c) {
  const torso = (fill, extra = '') => `<path d="M30 120 q0 -32 30 -32 q30 0 30 32 z" fill="${fill}" ${extra}/>`;
  switch (animal) {
    case 'man':
    case 'woman':
      return `<rect x="53" y="80" width="14" height="12" fill="${c.fur}"/>${torso(c.shirt)}<path d="M52 89 q8 7 16 0" stroke="${c.fur}" stroke-width="5" fill="none"/>`;
    case 'giraffe':
      return `<path d="M48 76 h24 l4 28 h-32 z" fill="${c.fur}"/>${torso(c.fur)}
<path d="M51 86 q5 -3 8 1 q-3 4 -8 -1 z M63 95 q5 -3 8 1 q-4 4 -8 -1 z M40 108 q6 -4 10 1 q-5 5 -10 -1 z M70 110 q6 -3 9 2 q-5 4 -9 -2 z" fill="${c.dark}" opacity=".85"/>`;
    case 'frog':
      return `${torso(c.fur)}<path d="M44 120 q0 -20 16 -20 q16 0 16 20 z" fill="${c.light}" opacity=".7"/>`;
    case 'parrot':
      return `${torso(c.fur)}<path d="M30 120 q2 -24 18 -30 q-4 14 -2 30 z M90 120 q-2 -24 -18 -30 q4 14 2 30 z" fill="#2e6fd8"/><path d="M48 120 q0 -18 12 -20 q12 2 12 20 z" fill="${c.light}" opacity=".8"/>`;
    case 'seal':
      return `${torso(c.fur)}<path d="M28 116 q-2 -14 10 -18 q-2 10 2 20 z M92 116 q2 -14 -10 -18 q2 10 -2 20 z" fill="${c.dark}"/><path d="M46 120 q0 -20 14 -20 q14 0 14 20 z" fill="${c.light}" opacity=".7"/>`;
    default:
      return `${torso(c.fur)}<path d="M46 120 q0 -20 14 -20 q14 0 14 20 z" fill="${c.light}" opacity=".7"/>`;
  }
}

function outfit(id) {
  const shape = (fill, extra = '') => `<path d="M30 120 q0 -32 30 -32 q30 0 30 32 z" fill="${fill}" ${extra}/>`;
  switch (id) {
    case 'sailor':
      return `${shape('#fbfbf8')}
<path d="M31 112 h58 M33 104 h54" stroke="#2e6fd8" stroke-width="3.5"/>
<path d="M42 92 l18 16 l18 -16 l-4 -2 l-14 11 l-14 -11 z" fill="#1b2f5b"/>
<path d="M55 104 l5 4 l5 -4 l-2 10 h-6 z" fill="#d83a2e"/>`;
    case 'raincoat':
      return `${shape('#f5c518')}
<path d="M60 92 v28" stroke="#c99d07" stroke-width="2"/><circle cx="56" cy="102" r="1.8" fill="#c99d07"/><circle cx="56" cy="112" r="1.8" fill="#c99d07"/>
<path d="M44 92 q16 10 32 0 l2 4 q-18 12 -36 0 z" fill="#e0b000"/>`;
    case 'lifevest':
      return `${shape('#f06a2c')}
<path d="M54 90 v30 M66 90 v30" stroke="#16213a" stroke-width="2.4"/>
<rect x="34" y="106" width="52" height="5" fill="#d8dee8"/><rect x="34" y="106" width="52" height="5" fill="none" stroke="#9aa6ba" stroke-width="1"/>
<rect x="56" y="104" width="8" height="9" rx="1.5" fill="#16213a"/>`;
    case 'suit':
      return `${shape('#22325c')}
<path d="M50 90 l10 30 l10 -30 q-10 -3 -20 0 z" fill="#fbfbf8"/>
<path d="M57 94 h6 l-1 3 l2 16 l-4 4 l-4 -4 l2 -16 z" fill="#d83a2e"/>
<path d="M48 91 l12 22 M72 91 l-12 22" stroke="#16213a" stroke-width="2"/>`;
    case 'cape':
      // 망토 앞부분: 금색 고리와 깃
      return `<path d="M40 94 q20 10 40 0 l3 6 q-23 12 -46 0 z" fill="#b8231a"/><circle cx="60" cy="99" r="4.5" fill="#f5c518" stroke="#c99d07" stroke-width="1.2"/>`;
    default:
      return '';
  }
}

function capeBack(id) {
  return id === 'cape' ? `<path d="M22 120 q4 -34 38 -34 q34 0 38 34 z" fill="#d83a2e"/>` : '';
}

function face(id, animal) {
  const dy = FIT[animal]?.face ?? 0;
  const g = (s) => (s && dy ? `<g transform="translate(0 ${dy})">${s}</g>` : s);
  return g(faceArt(id));
}

function faceArt(id) {
  switch (id) {
    case 'blush':
      return `<ellipse cx="42" cy="66" rx="5.5" ry="3.2" fill="#ff8fa3" opacity=".7"/><ellipse cx="78" cy="66" rx="5.5" ry="3.2" fill="#ff8fa3" opacity=".7"/>`;
    case 'glasses':
      return `<circle cx="49" cy="58" r="8" fill="#fff" fill-opacity=".18" stroke="${INK}" stroke-width="2.4"/><circle cx="71" cy="58" r="8" fill="#fff" fill-opacity=".18" stroke="${INK}" stroke-width="2.4"/>
<path d="M57 57 q3 -3 6 0 M41 57 l-9 -3 M79 57 l9 -3" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    case 'sunglasses':
      return `<path d="M38 52 h20 v6 q0 7 -10 7 q-10 0 -10 -7 z M62 52 h20 v6 q0 7 -10 7 q-10 0 -10 -7 z" fill="${INK}"/>
<path d="M58 54 h4 M38 53 l-7 -2 M82 53 l7 -2" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
<path d="M42 55 l5 0" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`;
    case 'eyepatch':
      return `<path d="M33 44 L88 66" stroke="${INK}" stroke-width="2.2"/><ellipse cx="71" cy="58" rx="8" ry="7" fill="${INK}"/>`;
    default:
      return '';
  }
}

function hat(id, animal) {
  const y = FIT[animal]?.hat ?? 0;
  const g = (s) => `<g transform="translate(0 ${y})">${s}</g>`;
  switch (id) {
    case 'beanie':
      return g(`<path d="M32 44 q0 -24 28 -24 q28 0 28 24 z" fill="#d83a2e"/>
<rect x="30" y="40" width="60" height="9" rx="4" fill="#b8231a"/><path d="M42 40 v-12 M51 40 v-17 M60 40 v-18 M69 40 v-17 M78 40 v-12" stroke="#b8231a" stroke-width="2"/>
<circle cx="60" cy="18" r="6" fill="#fbfbf8"/>`);
    case 'ribbon':
      return g(`<path d="M74 34 l-14 -8 v16 z M74 34 l14 -8 v16 z" fill="#ff7aa2"/><circle cx="74" cy="34" r="4" fill="#e04f7d"/>`);
    case 'straw':
      return g(`<ellipse cx="60" cy="38" rx="40" ry="9" fill="#e6c36a"/><path d="M40 38 q0 -18 20 -18 q20 0 20 18 z" fill="#efd185"/>
<path d="M40 34 h40 v4 h-40 z" fill="#d83a2e"/><path d="M26 38 q34 6 68 0" stroke="#c9a34a" stroke-width="1.4" fill="none"/>`);
    case 'captain':
      return g(`<path d="M34 34 q0 -14 26 -14 q26 0 26 14 l-4 6 h-44 z" fill="#fbfbf8"/>
<rect x="36" y="34" width="48" height="7" fill="#1b2f5b"/><path d="M36 41 q24 9 48 0 v3 q-24 9 -48 0 z" fill="${INK}"/>
<circle cx="60" cy="29" r="4.5" fill="#f5c518"/><path d="M60 26 v6 M57.5 30 q2.5 3 5 0" stroke="#1b2f5b" stroke-width="1.3" fill="none"/>`);
    case 'pirate':
      return g(`<path d="M24 40 q10 -6 18 -18 q18 -10 36 0 q8 12 18 18 q-36 8 -72 0 z" fill="${INK}"/>
<path d="M26 40 q34 7 68 0" stroke="#f5c518" stroke-width="2" fill="none"/>
<circle cx="60" cy="29" r="5.5" fill="#fbfbf8"/><path d="M57.5 30 h1.5 M61 30 h1.5" stroke="${INK}" stroke-width="1.6"/>
<path d="M53 37 l14 -6 M53 31 l14 6" stroke="#fbfbf8" stroke-width="2"/>`);
    case 'crown':
      return g(`<path d="M38 40 l-3 -22 l12 10 l13 -16 l13 16 l12 -10 l-3 22 z" fill="#f5c518" stroke="#c99d07" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="60" cy="31" r="3.2" fill="#d83a2e"/><circle cx="46" cy="34" r="2.4" fill="#2e6fd8"/><circle cx="74" cy="34" r="2.4" fill="#2a9d6a"/>`);
    default:
      return '';
  }
}

let uid = 0;

function background(id) {
  const k = `a${++uid}`;
  switch (id) {
    case 'sea':
      return `<defs><linearGradient id="${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0f5"/><stop offset="1" stop-color="#d9f1ff"/></linearGradient></defs>
<rect width="120" height="120" fill="url(#${k})"/><circle cx="96" cy="24" r="10" fill="#fff6c9"/>
<path d="M0 92 q15 -8 30 0 t30 0 t30 0 t30 0 v28 h-120 z" fill="#2e6fd8"/><path d="M0 102 q15 -8 30 0 t30 0 t30 0 t30 0 v18 h-120 z" fill="#1b4fa8"/>`;
    case 'sunset':
      return `<defs><linearGradient id="${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a62"/><stop offset=".6" stop-color="#ffcf7a"/><stop offset="1" stop-color="#ff7aa2"/></linearGradient></defs>
<rect width="120" height="120" fill="url(#${k})"/><circle cx="60" cy="96" r="28" fill="#ffe7a3" opacity=".8"/>`;
    case 'flags': {
      const colors = ['#d83a2e', '#2e6fd8', '#f5c518', '#2a9d6a', '#fbfbf8', '#d83a2e', '#2e6fd8'];
      const flags = colors.map((col, i) => `<path d="M${4 + i * 17} 9 l12 0 l-6 12 z" fill="${col}"/>`).join('');
      return `<rect width="120" height="120" fill="#1b2f5b"/><path d="M0 9 q60 6 120 0" stroke="#9aa6ba" stroke-width="1" fill="none"/>${flags}`;
    }
    case 'stars': {
      const pts = [[14, 18], [30, 40], [92, 14], [104, 44], [20, 74], [100, 80], [70, 10], [48, 22], [112, 104], [8, 106]];
      const stars = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 1.8 : 1.1}" fill="#fff6c9"/>`).join('');
      return `<rect width="120" height="120" fill="#0d1631"/>${stars}<path d="M96 24 a9 9 0 1 0 6 15 a7 7 0 1 1 -6 -15 z" fill="#fff6c9"/>`;
    }
    case 'gold':
      return `<defs><radialGradient id="${k}" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#fff2b3"/><stop offset=".55" stop-color="#f5c518"/><stop offset="1" stop-color="#c99d07"/></radialGradient></defs>
<rect width="120" height="120" fill="url(#${k})"/>
<g fill="#fff" opacity=".22">${[0, 30, 60, 90, 120, 150].map((r) => `<path d="M60 55 L56 -10 L64 -10 Z" transform="rotate(${r} 60 55)"/><path d="M60 55 L56 -10 L64 -10 Z" transform="rotate(${r + 180} 60 55)"/>`).join('')}</g>`;
    case 'navy':
    default:
      return `<rect width="120" height="120" fill="#1b2f5b"/>`;
  }
}

/**
 * 아바타 SVG 문자열. round면 동그랗게 자른다.
 * @param {Partial<typeof DEFAULT_AVATAR>} value
 * @param {{ size?: number, round?: boolean, title?: string }} [opts]
 */
export function renderAvatar(value, { size = 120, round = false, title = '' } = {}) {
  const av = parseAvatar(value);
  const c = ANIMALS[av.animal] ?? ANIMALS.cat;
  const clip = `c${++uid}`;
  const label = title ? `<title>${title.replace(/[<&>]/g, '')}</title>` : '';
  const inner = [
    background(av.bg),
    capeBack(av.outfit),
    ears(av.animal, c),
    body(av.animal, c),
    outfit(av.outfit),
    head(av.animal, c),
    face(av.face, av.animal),
    hat(av.hat, av.animal),
  ].join('');
  const shape = round ? `<circle cx="60" cy="60" r="60"/>` : `<rect width="120" height="120" rx="24"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img"${title ? '' : ' aria-hidden="true"'}>${label}<defs><clipPath id="${clip}">${shape}</clipPath></defs><g clip-path="url(#${clip})">${inner}</g></svg>`;
}
