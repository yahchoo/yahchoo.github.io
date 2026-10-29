// 앱(Capacitor) 연결: 공유, 진동, 뒤로가기, 외부 링크, 상태 표시줄.
// 앱 빌드(app/scripts/build-web.mjs)는 config.js에 APP = true를 넣고 Capacitor 코어(capacitor.js)를 함께 싣는다.
// 웹에서는 IS_APP이 false라서 여기 함수들은 웹 방식 그대로 동작하거나 아무것도 하지 않는다.
import * as config from './config.js';

const cap = window.Capacitor;

export const IS_APP = config.APP === true || !!cap?.isNativePlatform?.();
/** 'android' | 'ios' | 'web' */
export const PLATFORM = IS_APP ? (cap?.getPlatform?.() ?? 'web') : 'web';
/** 앱 안 주소(https://localhost 등) 대신 쓰는 웹 사이트 주소. 초대 링크, 개인정보처리방침 */
export const SITE_URL = 'https://yahchoo.ohsangplay.com/';

const plugins = new Map();

/** 네이티브 플러그인. 앱이 아니거나 Capacitor를 못 불렀으면 null */
export function nativePlugin(name) {
  if (!IS_APP || typeof cap?.registerPlugin !== 'function') return null;
  if (!plugins.has(name)) plugins.set(name, cap.registerPlugin(name));
  return plugins.get(name);
}

/** 진동. 패턴은 navigator.vibrate와 같다 (켜는 시간, 쉬는 시간, …). 앱은 Haptics (iOS에서도 됨) */
export function vibrate(pattern) {
  const haptics = nativePlugin('Haptics');
  if (!haptics) {
    navigator.vibrate?.(pattern);
    return;
  }
  const steps = Array.isArray(pattern) ? pattern : [pattern];
  let at = 0;
  for (let i = 0; i < steps.length; i += 2) {
    const style = steps[i] >= 60 ? 'HEAVY' : 'MEDIUM';
    setTimeout(() => haptics.impact({ style }).catch(() => {}), at);
    at += steps[i] + (steps[i + 1] ?? 0);
  }
}

/** 앱의 기본 공유 창. 앱이 아니면 false (웹 방식으로 공유) */
export async function nativeShare({ title, text, url }) {
  const share = nativePlugin('Share');
  if (!share) return false;
  try {
    await share.share({ title, text, url, dialogTitle: title });
  } catch {
    // 공유 창을 닫음
  }
  return true;
}

/** 안드로이드 뒤로가기 버튼. 등록하면 기본 동작(앱 종료)은 하지 않는다. */
export function onBackButton(handler) {
  nativePlugin('App')?.addListener('backButton', handler);
}

export function exitApp() {
  nativePlugin('App')?.exitApp();
}

/** 앱 밖 브라우저로 열기 */
export function openExternal(url) {
  const launcher = nativePlugin('AppLauncher');
  if (launcher) launcher.openUrl({ url }).catch(() => {});
  else window.open(url, '_blank', 'noopener');
}

if (IS_APP) {
  // 상태 표시줄: 남색 배경 위 밝은 글자
  nativePlugin('SystemBars')?.setStyle({ style: 'DARK' }).catch(() => {});

  // 링크: 앱 안에서 웹 페이지로 넘어가지 않게 외부 브라우저로 연다.
  // 같은 앱 안의 페이지(개인정보처리방침 등)는 웹 사이트 주소로 바꿔서 연다.
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    ev.preventDefault();
    const url = new URL(href, location.href);
    if (url.origin === location.origin) openExternal(new URL(url.pathname.replace(/^\/+/, '') + url.search + url.hash, SITE_URL).toString());
    else openExternal(url.toString());
  });
}
