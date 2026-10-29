// web/ → app/www/ 로 복사하고 앱용 설정을 넣는다.
// - js/config.js: 운영 서버, 앱 표시(APP=true). 웹 광고(애드센스)·웹 구글 로그인은 앱에서 쓰지 않는다.
// - js/cap.js: Capacitor 플러그인 묶음 (src/native.js)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, '..', 'web');
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(web, www, { recursive: true, filter: (src) => !/[\\/](CNAME)$/.test(src) });

const API_BASE = process.env.API_BASE || 'https://yacht-dice-api.shark-keeper.workers.dev';
fs.writeFileSync(
  path.join(www, 'js', 'config.js'),
  [
    '// 앱 빌드용 (app/scripts/build-web.mjs가 만든다)',
    `export const API_BASE = ${JSON.stringify(API_BASE)};`,
    "export const GOOGLE_CLIENT_ID = ''; // 앱에서는 웹 구글 로그인(GIS)이 동작하지 않는다",
    "export const ADSENSE_CLIENT = '';",
    'export const ADSENSE_SLOTS = {};',
    'export const APP = true;',
    '',
  ].join('\n'),
);

const ads = JSON.parse(fs.readFileSync(path.join(root, 'ads.config.json'), 'utf8'));
if (process.env.ADMOB_IOS_APP_ID) ads.ios.appId = process.env.ADMOB_IOS_APP_ID;
if (process.env.ADMOB_IOS_BANNER_ID) ads.ios.banner = process.env.ADMOB_IOS_BANNER_ID;
const testing = ads.ios.banner.startsWith('ca-app-pub-3940256099942544/');
await build({
  entryPoints: [path.join(root, 'src', 'native.js')],
  outfile: path.join(www, 'js', 'cap.js'),
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'safari15',
  define: { __ADS__: JSON.stringify({ ios: { banner: ads.ios.banner }, testing }) },
  logLevel: 'warning',
});

const indexFile = path.join(www, 'index.html');
// 앱에서는 확대를 끈다 (두 번 탭·두 손가락 모두). 웹 사이트는 접근성 때문에 두 손가락 확대를 남겨 둔다.
const html = fs
  .readFileSync(indexFile, 'utf8')
  .replace('content="width=device-width, initial-scale=1, viewport-fit=cover"', 'content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"');
if (!html.includes('js/cap.js')) {
  fs.writeFileSync(indexFile, html.replace('<script type="module" src="js/app.js"></script>', '<script src="js/cap.js"></script>\n  <script type="module" src="js/app.js"></script>'));
}
fs.writeFileSync(path.join(root, 'www-ads.json'), JSON.stringify({ iosAppId: ads.ios.appId, testing }));
console.log(`www 준비 완료 (서버 ${API_BASE}, 광고 ${testing ? '테스트' : '실제'} ID)`);
