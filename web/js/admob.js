// 앱 광고(AdMob). ads.js가 앱에서만 불러온다. (웹은 이 파일을 불러오지 않는다)
//
// - 화면 아래에 고정된 적응형 배너 하나를 쓴다.
// - 광고 자리가 있는 화면에서는 스크롤 영역(body)을 배너가 차지하는 높이(--app-ad-h)만큼 줄여서
//   어떤 스크롤 위치에서도 배너가 버튼·점수판을 가리지 않게 한다. (style.css의 .app)
// - 광고 자리(.ad-slot, 게임 화면은 .ad-mobile)가 그 영역 안에 보이면(IntersectionObserver) 배너를 띄우고,
//   자리가 안 보이거나 자리가 없는 화면, 팝업(결과 창 등)이 열려 있으면 숨긴다.
// - 시작할 때 UMP 동의(필요한 지역에서만 폼이 뜬다). iOS는 첫 실행 때 안내 화면을 보여 준 뒤 추적 허용(ATT)을 묻는다.
//   거부해도 게임은 똑같고 광고만 비맞춤형으로 나온다.
import * as config from './config.js';
import { PLATFORM, nativePlugin } from './native.js';

const AdMob = nativePlugin('AdMob');
const AD = config.ADMOB ?? {};
const UNIT = String(AD[PLATFORM] ?? '');
const ESTIMATED_HEIGHT = 60; // 배너 높이를 받기 전 예상값 (휴대폰 적응형 배너 50~60)

let ready = false; // 동의 처리를 마쳐 광고를 요청해도 됨
let npa = false; // 비맞춤 광고
let banner = 'none'; // 'none' | 'shown' | 'hidden'
let bannerHeight = 0;
let reserved = -1; // 지금 body 아래 여백 (px)
let queue = Promise.resolve();
let updateTimer = 0;
const inView = new Set();

/** 화면 아래 시스템 영역(제스처 바 등) 높이 */
function safeBottom() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;height:var(--app-sab, 0px)';
  document.body.append(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h;
}

function slots() {
  // 앱에서는 게임 화면의 PC용 자리는 쓰지 않는다
  return [...document.querySelectorAll('.ad-slot:not(.ad-desktop)')];
}

/** 광고 자리가 보이는지. 스크롤 영역(body) 밖으로 잘린 부분은 안 보이는 것으로 친다. */
function observe() {
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) inView.add(e.target);
      else inView.delete(e.target);
    }
    scheduleUpdate();
  });
  for (const slot of slots()) observer.observe(slot);
}

function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(update, 80);
}

function run(task) {
  queue = queue.then(task).catch((err) => console.warn('[admob]', err?.message ?? err));
  return queue;
}

function update() {
  const screenSlot = slots().some((s) => s.getClientRects().length > 0 && !s.closest('[hidden]'));
  const overlayOpen = !!document.querySelector('.overlay:not([hidden])');
  const want = ready && screenSlot && !overlayOpen && [...inView].some((s) => s.isConnected && !s.closest('[hidden]'));

  // 광고 자리가 있는 화면이면 배너(+ 아래 시스템 영역) 높이만큼 스크롤 영역을 줄인다.
  // 배너가 숨어 있어도 줄여 둬서 화면이 들썩이지 않게 한다.
  const reserve = ready && screenSlot ? (bannerHeight || ESTIMATED_HEIGHT) + safeBottom() : 0;
  if (reserve !== reserved) {
    reserved = reserve;
    const root = document.documentElement.style;
    root.setProperty('--app-ad-h', `${reserve}px`);
    // 시스템 영역은 위 높이에 들어 있으니 body 아래 안쪽 여백은 없앤다
    if (reserve) root.setProperty('--app-ad-pad', '0px');
    else root.removeProperty('--app-ad-pad');
  }

  if (want && banner !== 'shown') {
    const first = banner === 'none';
    banner = 'shown';
    run(() =>
      first
        ? AdMob.showBanner({
            adId: UNIT,
            adSize: 'ADAPTIVE_BANNER',
            position: 'BOTTOM_CENTER',
            margin: 0,
            isTesting: !!AD.testing,
            npa,
          })
        : AdMob.resumeBanner(),
    );
  } else if (!want && banner === 'shown') {
    banner = 'hidden';
    run(() => AdMob.hideBanner());
  }
}

/* ---------------------------------------------------------------- 동의 */

/** iOS 첫 실행: 추적 허용을 묻기 전에 짧은 안내 */
function explainTracking() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="sheet-card confirm-card att-card" role="dialog" aria-modal="true" aria-labelledby="att-title">
        <h2 id="att-title">광고 안내</h2>
        <p>무료로 운영하기 위해 광고를 보여 줘요. 다음 화면에서 허용하면 관심 있을 만한 광고가 나와요.</p>
        <p class="att-note">허용하지 않아도 게임은 똑같이 할 수 있어요.</p>
        <button class="btn btn-primary wide" type="button">계속</button>
      </div>`;
    overlay.querySelector('button').addEventListener('click', () => {
      overlay.remove();
      resolve();
    });
    document.body.append(overlay);
    overlay.querySelector('button').focus();
  });
}

/** 동의를 받는다. 광고를 요청해도 되면 true */
async function gatherConsent() {
  // UMP: 유럽 등 동의가 필요한 지역에서만 폼이 뜬다
  let canRequestAds = true;
  try {
    let info = await AdMob.requestConsentInfo();
    if (info.isConsentFormAvailable && info.status === 'REQUIRED') info = await AdMob.showConsentForm();
    canRequestAds = info.canRequestAds !== false;
  } catch (err) {
    // 동의 정보를 못 받으면(오프라인 등) 이전에 받은 동의에 따라 SDK가 처리한다
    console.warn('[admob] 동의 정보', err?.message ?? err);
  }

  if (PLATFORM === 'ios') {
    try {
      let { status } = await AdMob.trackingAuthorizationStatus();
      if (status === 'notDetermined') {
        await explainTracking();
        await AdMob.requestTrackingAuthorization();
        ({ status } = await AdMob.trackingAuthorizationStatus());
      }
      npa = status !== 'authorized';
    } catch {
      npa = true;
    }
  }
  return canRequestAds;
}

export async function startAdMob() {
  if (!AdMob || !UNIT) return;
  // 앱에서는 광고 자리를 배너 위치 표시(빈 자리)로만 쓴다
  for (const slot of slots()) slot.hidden = false;

  AdMob.addListener('bannerAdSizeChanged', (size) => {
    const h = Math.round(Number(size?.height) || 0);
    if (h > 0) bannerHeight = h;
    scheduleUpdate();
  });
  // 화면·팝업이 바뀌면 다시 계산
  new MutationObserver(scheduleUpdate).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true });
  window.addEventListener('resize', scheduleUpdate);
  observe();

  if (!(await gatherConsent())) return;
  try {
    await AdMob.initialize({ initializeForTesting: !!AD.testing });
  } catch (err) {
    console.warn('[admob] 시작 실패', err?.message ?? err);
    return;
  }
  ready = true;
  scheduleUpdate();
}

/** 화면이 바뀔 때 (ads.js의 fillAds에서) */
export function refreshAds() {
  scheduleUpdate();
}
