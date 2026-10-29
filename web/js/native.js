// 앱(iOS·Android)에서 실행 중일 때만 쓰는 네이티브 기능. 웹에서는 모두 브라우저 기능으로 대신한다.
// 앱 빌드(app/scripts/build-web.mjs)가 js/cap.js를 먼저 불러와 window.YachooNative를 만들어 둔다.

/** 앱이면 플러그인 묶음, 웹이면 null */
export const native = globalThis.YachooNative?.isNative ? globalThis.YachooNative : null;
export const inApp = !!native;

/** 짧은 진동. kind: 'light' | 'medium' | 'heavy' */
export function haptic(kind = 'medium', webPattern = 60) {
  if (native) {
    const style = { light: native.ImpactStyle.Light, medium: native.ImpactStyle.Medium, heavy: native.ImpactStyle.Heavy }[kind];
    native.Haptics.impact({ style }).catch(() => {});
    return;
  }
  try {
    navigator.vibrate?.(webPattern);
  } catch {
    // 무시
  }
}

/** 공유하기. 성공하면 true, 사용자가 닫으면 'cancel', 공유 창이 없으면 false. */
export async function share(data) {
  if (native) {
    try {
      await native.Share.share({ title: data.title, text: data.text, url: data.url, dialogTitle: '친구 초대하기' });
      return true;
    } catch (err) {
      return /cancel/i.test(String(err?.message ?? '')) ? 'cancel' : false;
    }
  }
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancel';
    }
  }
  return false;
}

/** 앱에서는 바깥 링크(개인정보처리방침, ohsangplay.com 등)를 앱 안 브라우저 창으로 연다. */
function hookExternalLinks() {
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a[href]');
    if (!a) return;
    const url = new URL(a.getAttribute('href'), location.href);
    const external = url.origin !== location.origin || a.target === '_blank' || url.pathname.endsWith('/privacy.html');
    if (!external) return;
    ev.preventDefault();
    // 앱 안에 묶인 개인정보처리방침 대신 항상 최신 웹 페이지를 연다.
    const target = url.origin === location.origin ? new URL(url.pathname.replace(/^\/+/, '/') + url.hash, 'https://yahchoo.ohsangplay.com') : url;
    native.Browser.open({ url: target.toString() }).catch(() => {});
  });
}

if (native) {
  document.documentElement.classList.add('in-app', `in-app-${native.platform}`);
  hookExternalLinks();
}
