// web/을 앱용으로 www/에 복사하고, 앱 설정(config.js, 네이티브 광고 ID)을 만든다.
//
// 설정 값 (뒤에 있을수록 우선)
//   광고: ads.config.json(테스트 ID) → ads.config.local.json(커밋 안 됨) → 환경변수
//         ADMOB_ANDROID_APP_ID, ADMOB_ANDROID_BANNER_ID, ADMOB_IOS_APP_ID, ADMOB_IOS_BANNER_ID
//   로그인: login.config.json → login.config.local.json → 환경변수 GOOGLE_LOGIN_ANDROID(1/0), GOOGLE_IOS_CLIENT_ID
//   서버: 운영 값 → 환경변수 API_BASE, GOOGLE_CLIENT_ID
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = resolve(APP_DIR, '../web');
const OUT = join(APP_DIR, 'www');

const API_BASE = process.env.API_BASE || 'https://yacht-dice-api.shark-keeper.workers.dev';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '994205737094-50gr21rv5gd4jmrk3drgq3462k6k2rj7.apps.googleusercontent.com';
const SKIP = new Set(['CNAME', 'og.png']);

function readJson(name) {
  const file = join(APP_DIR, name);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${name}을 읽지 못했어요: ${err.message}`);
  }
}

function fail(message) {
  console.error(`\n[build-web] ${message}\n`);
  process.exit(1);
}

/* ---------------------------------------------------------------- 설정 모으기 */

const adsBase = readJson('ads.config.json');
const adsLocal = readJson('ads.config.local.json');
const env = process.env;
const ads = {
  android: {
    appId: env.ADMOB_ANDROID_APP_ID || adsLocal.android?.appId || adsBase.android?.appId || '',
    banner: env.ADMOB_ANDROID_BANNER_ID || adsLocal.android?.banner || adsBase.android?.banner || '',
  },
  ios: {
    appId: env.ADMOB_IOS_APP_ID || adsLocal.ios?.appId || adsBase.ios?.appId || '',
    banner: env.ADMOB_IOS_BANNER_ID || adsLocal.ios?.banner || adsBase.ios?.banner || '',
  },
};
for (const [platform, ids] of Object.entries(ads)) {
  if (!/^ca-app-pub-\d{10,20}~\d{6,12}$/.test(ids.appId)) fail(`${platform} AdMob 앱 ID 형식이 이상해요 (ca-app-pub-숫자~숫자): ${ids.appId}`);
  if (!/^ca-app-pub-\d{10,20}\/\d{6,12}$/.test(ids.banner)) fail(`${platform} AdMob 배너 광고 단위 ID 형식이 이상해요 (ca-app-pub-숫자/숫자): ${ids.banner}`);
}
// 구글 공식 테스트 ID(게시자 3940256099942544)면 테스트 광고로 요청한다
const isTestId = (id) => id.startsWith('ca-app-pub-3940256099942544');
const adsTesting = isTestId(ads.android.banner) || isTestId(ads.ios.banner);

const loginBase = readJson('login.config.json');
const loginLocal = readJson('login.config.local.json');
const login = {
  android: env.GOOGLE_LOGIN_ANDROID !== undefined ? env.GOOGLE_LOGIN_ANDROID === '1' : (loginLocal.android ?? loginBase.android) === true,
  iosClientId: env.GOOGLE_IOS_CLIENT_ID ?? loginLocal.iosClientId ?? loginBase.iosClientId ?? '',
};
if (login.iosClientId && !/^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$/.test(login.iosClientId)) {
  fail(`iOS 구글 클라이언트 ID 형식이 이상해요: ${login.iosClientId}`);
}
// iOS 구글 로그인 콜백 주소: 클라이언트 ID를 거꾸로 쓴 것 (com.googleusercontent.apps.숫자-문자)
const iosUrlScheme = login.iosClientId ? login.iosClientId.split('.').reverse().join('.') : '';

/* ---------------------------------------------------------------- www/ */

rmSync(OUT, { recursive: true, force: true });
cpSync(WEB_DIR, OUT, { recursive: true, filter: (src) => !SKIP.has(src.slice(WEB_DIR.length + 1)) });

// 번들러 없이 Capacitor 코어(window.Capacitor.registerPlugin)를 쓰기 위해 코어 스크립트를 함께 넣는다
cpSync(join(APP_DIR, 'node_modules/@capacitor/core/dist/capacitor.js'), join(OUT, 'capacitor.js'));

const indexFile = join(OUT, 'index.html');
let html = readFileSync(indexFile, 'utf8');
const before = html;
html = html.replace('<html lang="ko">', '<html lang="ko" class="app">');
html = html.replace('<script type="module" src="js/app.js"></script>', '<script src="capacitor.js"></script>\n  <script type="module" src="js/app.js"></script>');
if (html === before || !html.includes('class="app"') || !html.includes('capacitor.js')) fail('www/index.html을 앱용으로 고치지 못했어요 (web/index.html 구조가 바뀌었나요?)');
writeFileSync(indexFile, html);

const appConfig = {
  // 화면마다 아래에 붙는 배너 (플랫폼별 광고 단위)
  ADMOB: { android: ads.android.banner, ios: ads.ios.banner, testing: adsTesting },
  // 네이티브 구글 로그인. 설정 전이면 로그인 대신 '준비 중'
  NATIVE_LOGIN: { android: login.android, ios: !!login.iosClientId, iosClientId: login.iosClientId },
};
writeFileSync(
  join(OUT, 'js/config.js'),
  `// 앱용 설정. app/scripts/build-web.mjs가 만든다. (직접 고치지 말 것)
export const API_BASE = ${JSON.stringify(API_BASE)};
export const GOOGLE_CLIENT_ID = ${JSON.stringify(GOOGLE_CLIENT_ID)};
// 앱에서는 애드센스를 쓰지 않는다 (AdMob)
export const ADSENSE_CLIENT = '';
export const ADSENSE_SLOTS = {};
export const APP = true;
export const ADMOB = ${JSON.stringify(appConfig.ADMOB)};
export const NATIVE_LOGIN = ${JSON.stringify(appConfig.NATIVE_LOGIN)};
`,
);

/* ---------------------------------------------------------------- 네이티브 설정 (커밋하지 않는 파일) */

// Android: AndroidManifest.xml의 AdMob 앱 ID(@string/admob_app_id)
const androidValues = join(APP_DIR, 'android/app/src/main/res/values');
if (existsSync(join(APP_DIR, 'android'))) {
  mkdirSync(androidValues, { recursive: true });
  writeFileSync(
    join(androidValues, 'app_config.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<!-- app/scripts/build-web.mjs가 만든다. 커밋하지 않음 -->
<resources>
    <string name="admob_app_id" translatable="false">${ads.android.appId}</string>
</resources>
`,
  );
}

// iOS: Info.plist의 $(ADMOB_APP_ID), $(GOOGLE_URL_SCHEME)
const iosDir = join(APP_DIR, 'ios');
if (existsSync(iosDir)) {
  writeFileSync(
    join(iosDir, 'AppConfig.xcconfig'),
    `// app/scripts/build-web.mjs가 만든다. 커밋하지 않음
ADMOB_APP_ID = ${ads.ios.appId}
GOOGLE_URL_SCHEME = ${iosUrlScheme || 'com.ohsang.play.yachoo.nologin'}
`,
  );
}

console.log(`[build-web] www/ 준비 완료
  서버: ${API_BASE}
  광고: ${adsTesting ? '테스트 ID' : '실제 ID'} (Android ${ads.android.banner}, iOS ${ads.ios.banner})
  구글 로그인: Android ${login.android ? '켜짐' : '준비 중'}, iOS ${login.iosClientId ? '켜짐' : '준비 중'}`);
