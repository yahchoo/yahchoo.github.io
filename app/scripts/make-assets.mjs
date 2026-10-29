// 앱 아이콘·스플래시 원본(assets/)을 web/favicon.svg로 만든다. 그 다음 `capacitor-assets generate`가
// Android(mipmap, 적응형 아이콘, 스플래시)와 iOS(AppIcon, Splash) 크기별 이미지를 만든다. (npm run assets)
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(APP_DIR, 'assets');
const NAVY = '#1b2f5b';
mkdirSync(OUT, { recursive: true });

const svg = readFileSync(join(APP_DIR, '../web/favicon.svg'), 'utf8');
// favicon.svg(64×64): 남색 둥근 사각형 배경 + 흰 주사위(10~54) + 노란 깃발
const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const dieAndFlag = inner.replace(/<rect width="64" height="64"[^>]*\/>/, '');

/** 64×64 그림을 size×size로, 가운데 scale 비율만큼 그린다 */
function canvas(size, body, { background = null, scale = 1 } = {}) {
  const s = scale;
  const offset = (64 - 64 * s) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
${background ? `<rect width="64" height="64" fill="${background}"/>` : ''}
<g transform="translate(${offset} ${offset}) scale(${s})">${body}</g></svg>`);
}

const jobs = [
  // iOS·Android 기본 아이콘: 꽉 찬 남색 배경 (모서리는 OS가 둥글게 자른다)
  ['icon-only.png', 1024, dieAndFlag, { background: NAVY, scale: 1 }],
  // Android 적응형 아이콘: 전경은 가운데 안전 영역(약 66%) 안에, 배경은 남색
  ['icon-foreground.png', 1024, dieAndFlag, { scale: 0.72 }],
  ['icon-background.png', 1024, '', { background: NAVY }],
  // 스플래시: 남색 바탕 가운데 작은 로고
  ['splash.png', 2732, dieAndFlag, { background: NAVY, scale: 0.22 }],
  ['splash-dark.png', 2732, dieAndFlag, { background: NAVY, scale: 0.22 }],
];

for (const [name, size, body, opts] of jobs) {
  await sharp(canvas(size, body, opts)).png().toFile(join(OUT, name));
  console.log(`assets/${name} (${size}×${size})`);
}
