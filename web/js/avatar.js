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

/** @type {{ id: string, slot: Slot, name: string, price: number }[]} */
export const ITEMS = [
  { id: 'cat', slot: 'animal', name: '고양이', price: 0 },
  { id: 'dog', slot: 'animal', name: '강아지', price: 0 },
  { id: 'bear', slot: 'animal', name: '곰', price: 0 },
  { id: 'rabbit', slot: 'animal', name: '토끼', price: 300 },
  { id: 'fox', slot: 'animal', name: '여우', price: 500 },
  { id: 'penguin', slot: 'animal', name: '펭귄', price: 800 },

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
  bear: { fur: '#8d6748', dark: '#6b4c33', light: '#d8b896', inner: '#c49a78' },
  rabbit: { fur: '#f4f1ea', dark: '#d9d3c7', light: '#ffffff', inner: '#f5b5c4' },
  fox: { fur: '#e8743b', dark: '#3b2a26', light: '#fff6ec', inner: '#f9c7a0' },
  penguin: { fur: '#24304f', dark: '#141c33', light: '#ffffff', inner: '#24304f' },
};

function ears(animal, c) {
  switch (animal) {
    case 'cat':
      return `<path d="M33 46 L36 18 L56 34 Z" fill="${c.fur}"/><path d="M37 40 L39 25 L50 34 Z" fill="${c.inner}"/>
<path d="M87 46 L84 18 L64 34 Z" fill="${c.fur}"/><path d="M83 40 L81 25 L70 34 Z" fill="${c.inner}"/>`;
    case 'dog':
      return ''; // 늘어진 귀는 머리 위에 그린다
    case 'bear':
      return `<circle cx="36" cy="34" r="11" fill="${c.fur}"/><circle cx="36" cy="34" r="6" fill="${c.inner}"/>
<circle cx="84" cy="34" r="11" fill="${c.fur}"/><circle cx="84" cy="34" r="6" fill="${c.inner}"/>`;
    case 'rabbit':
      return `<ellipse cx="47" cy="20" rx="8" ry="22" transform="rotate(-10 47 20)" fill="${c.fur}" stroke="${c.dark}" stroke-width="1.5"/>
<ellipse cx="47" cy="22" rx="4" ry="15" transform="rotate(-10 47 22)" fill="${c.inner}"/>
<ellipse cx="73" cy="20" rx="8" ry="22" transform="rotate(10 73 20)" fill="${c.fur}" stroke="${c.dark}" stroke-width="1.5"/>
<ellipse cx="73" cy="22" rx="4" ry="15" transform="rotate(10 73 22)" fill="${c.inner}"/>`;
    case 'fox':
      return `<path d="M31 48 L32 14 L56 32 Z" fill="${c.fur}"/><path d="M32 24 L32 14 L41 21 Z" fill="${c.dark}"/><path d="M36 40 L36 24 L49 33 Z" fill="${c.inner}"/>
<path d="M89 48 L88 14 L64 32 Z" fill="${c.fur}"/><path d="M88 24 L88 14 L79 21 Z" fill="${c.dark}"/><path d="M84 40 L84 24 L71 33 Z" fill="${c.inner}"/>`;
    default:
      return '';
  }
}

function head(animal, c) {
  const eyes = `<circle cx="49" cy="58" r="3.6" fill="${INK}"/><circle cx="71" cy="58" r="3.6" fill="${INK}"/>
<circle cx="50.2" cy="56.8" r="1.1" fill="#fff"/><circle cx="72.2" cy="56.8" r="1.1" fill="#fff"/>`;
  switch (animal) {
    case 'cat':
      return `<circle cx="60" cy="58" r="29" fill="${c.fur}"/>
<path d="M60 29 l-4 9 h8 z M50 31 l-2 7 h5 z M70 31 l2 7 h-5 z" fill="${c.dark}"/>
<ellipse cx="60" cy="69" rx="13" ry="9" fill="${c.light}"/>${eyes}
<path d="M57 65 h6 l-3 3.5 z" fill="#e2798a"/><path d="M60 68.5 q-3 4 -6 2 M60 68.5 q3 4 6 2" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<path d="M44 66 h-12 M44 70 l-11 3 M76 66 h12 M76 70 l11 3" stroke="${c.dark}" stroke-width="1.5" stroke-linecap="round"/>`;
    case 'dog':
      return `<circle cx="60" cy="58" r="29" fill="${c.fur}"/>
<ellipse cx="68" cy="47" rx="10" ry="8" fill="${c.light}" opacity=".55"/>
<ellipse cx="60" cy="70" rx="14" ry="10" fill="${c.light}"/>${eyes}
<ellipse cx="60" cy="65" rx="5" ry="3.6" fill="${INK}"/><path d="M60 68.5 v3 q-3 3 -6 1 M60 71.5 q3 3 6 1" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<path d="M33 40 q-8 4 -6 26 q2 8 9 4 q4 -14 6 -26 z" fill="${c.dark}"/><path d="M87 40 q8 4 6 26 q-2 8 -9 4 q-4 -14 -6 -26 z" fill="${c.dark}"/>`;
    case 'bear':
      return `<circle cx="60" cy="58" r="29" fill="${c.fur}"/>
<ellipse cx="60" cy="69" rx="14" ry="10" fill="${c.light}"/>${eyes}
<ellipse cx="60" cy="64.5" rx="5.5" ry="4" fill="${INK}"/><path d="M60 68.5 v3 q-3 3 -6 1 M60 71.5 q3 3 6 1" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    case 'rabbit':
      return `<circle cx="60" cy="58" r="29" fill="${c.fur}" stroke="${c.dark}" stroke-width="1.5"/>
<ellipse cx="60" cy="69" rx="12" ry="8" fill="${c.light}"/>${eyes}
<path d="M57 65 h6 l-3 3 z" fill="#e2798a"/><path d="M60 68 v2.5 q-2.5 3 -5 1 M60 70.5 q2.5 3 5 1" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
<rect x="57.5" y="72" width="5" height="4" rx="1" fill="#fff" stroke="${c.dark}" stroke-width="1"/>`;
    case 'fox':
      return `<path d="M31 50 q0 -22 29 -22 q29 0 29 22 q0 22 -29 36 q-29 -14 -29 -36 z" fill="${c.fur}"/>
<path d="M33 60 q12 2 22 12 l5 14 q-24 -10 -27 -26 z M87 60 q-12 2 -22 12 l-5 14 q24 -10 27 -26 z" fill="${c.light}"/>${eyes}
<ellipse cx="60" cy="76" rx="4.5" ry="3.2" fill="${INK}"/>`;
    case 'penguin':
      return `<circle cx="60" cy="58" r="29" fill="${c.fur}" stroke="#6f80a8" stroke-width="2"/>
<path d="M60 44 q-6 -6 -14 -2 q-10 6 -10 20 q0 18 24 22 q24 -4 24 -22 q0 -14 -10 -20 q-8 -4 -14 2 z" fill="${c.light}"/>${eyes}
<path d="M54 66 h12 l-6 7 z" fill="#f2a13a"/>`;
    default:
      return '';
  }
}

function body(animal, c) {
  const torso = `<path d="M30 120 q0 -32 30 -32 q30 0 30 32 z" fill="${c.fur}"/>`;
  if (animal === 'penguin') return `<path d="M30 120 q0 -32 30 -32 q30 0 30 32 z" fill="${c.fur}" stroke="#6f80a8" stroke-width="2"/><path d="M42 120 q0 -24 18 -24 q18 0 18 24 z" fill="${c.light}"/>`;
  if (animal === 'rabbit') return `<path d="M30 120 q0 -32 30 -32 q30 0 30 32 z" fill="${c.fur}" stroke="${c.dark}" stroke-width="1.5"/>`;
  return `${torso}<path d="M46 120 q0 -20 14 -20 q14 0 14 20 z" fill="${c.light}" opacity=".7"/>`;
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

function face(id) {
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
  // 토끼는 귀가 길어서 모자를 조금 낮게 쓴다
  const y = animal === 'rabbit' ? 4 : 0;
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
    face(av.face),
    hat(av.hat, av.animal),
  ].join('');
  const shape = round ? `<circle cx="60" cy="60" r="60"/>` : `<rect width="120" height="120" rx="24"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img"${title ? '' : ' aria-hidden="true"'}>${label}<defs><clipPath id="${clip}">${shape}</clipPath></defs><g clip-path="url(#${clip})">${inner}</g></svg>`;
}
