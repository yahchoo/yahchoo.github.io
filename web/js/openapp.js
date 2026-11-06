// 카카오톡 등 메신저 안 브라우저에서 초대 링크를 열었을 때 앱이 있으면 앱으로 연다.
// 메신저 안 브라우저는 Universal Links / App Links를 처리하지 않아서 직접 앱을 불러낸다.
//  - 안드로이드: intent:// 주소로 앱을 바로 연다. 앱이 없으면 browser_fallback_url(이 페이지 + web=1)로 돌아와 웹으로 계속.
//  - iPhone: 바로 yahchoo:// 로 앱을 불러 보고, 앱이 없으면(1.5초 안에 넘어가지 않으면) 웹으로 계속하며 "앱으로 열기" 막대를 남긴다.

const PACKAGE = 'com.ohsang.play.yahchoo';
const SCHEME = 'yahchoo';
const IN_APP_BROWSER = /KAKAOTALK|NAVER\(inapp|Line\/|Instagram|FBAN|FBAV|DaumApps|everytimeApp|BAND\//i;

export function offerApp(code) {
  if (!/^[A-Z0-9]{4}$/.test(code)) return;
  const params = new URLSearchParams(location.search);
  if (params.has('web')) return; // 앱이 없어서 돌아온 경우
  const ua = navigator.userAgent;
  if (!IN_APP_BROWSER.test(ua)) return;
  const back = new URL(location.href);
  back.searchParams.set('web', '1');
  if (/Android/i.test(ua)) {
    location.href = `intent://yahchoo.ohsangplay.com/?room=${code}#Intent;scheme=https;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(back.toString())};end`;
    return;
  }
  if (/iPhone|iPad|iPod/i.test(ua)) tryOpenIos(`${SCHEME}://join?room=${code}`);
}

// iPhone: 바로 앱을 불러 본다. 앱으로 넘어가면 이 페이지가 가려지고(visibilitychange/pagehide),
// 1.5초 안에 그런 일이 없으면 앱이 없다고 보고 웹으로 계속하면서 안내 막대만 남긴다.
function tryOpenIos(appUrl) {
  let left = false;
  const mark = () => { left = true; };
  document.addEventListener('visibilitychange', () => { if (document.hidden) mark(); }, { once: true });
  window.addEventListener('pagehide', mark, { once: true });
  window.addEventListener('blur', mark, { once: true });
  setTimeout(() => {
    if (!left) showBar(appUrl);
  }, 1500);
  location.href = appUrl;
}

function showBar(appUrl) {
  if (document.getElementById('open-app-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'open-app-bar';
  bar.className = 'open-app-bar';
  bar.innerHTML = '<span>오늘도 야추 앱이 있으면 앱에서 바로 들어갈 수 있어요</span>';
  const open = document.createElement('a');
  open.href = appUrl;
  open.className = 'open-app-go';
  open.textContent = '앱으로 열기';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'open-app-close';
  close.setAttribute('aria-label', '닫고 웹으로 계속');
  close.textContent = '✕';
  close.addEventListener('click', () => bar.remove());
  bar.append(open, close);
  document.body.append(bar);
}
