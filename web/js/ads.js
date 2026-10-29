// 웹 광고(구글 애드센스) 자리.
// config.js의 ADSENSE_CLIENT(ca-pub-…)와 광고 단위 번호(ADSENSE_SLOTS)가 있을 때만 광고를 불러온다.
// 값이 없으면 광고 자리는 숨겨 둔 채로 아무것도 불러오지 않는다.
// 광고는 버튼을 잘못 누르기 쉬운 곳(굴리기 버튼·점수판 칸 옆, 팝업)에는 두지 않는다.
// 게임 화면: 휴대폰은 점수판 맨 아래, PC는 주사위 아래 빈 공간. (.ad-mobile / .ad-desktop)
//
// 앱(iOS·Android)에서는 애드센스 대신 AdMob 배너를 쓴다. 같은 광고 자리가 화면에 보이는 동안
// 화면 아래에 배너를 띄우고, 배너 높이만큼 아래 여백을 줘서 버튼·점수판을 가리지 않게 한다.
// 결과 같은 팝업이 열리면 배너를 숨긴다.
import * as config from './config.js';
import { native } from './native.js';

const CLIENT = /^ca-pub-\d{10,20}$/.test(config.ADSENSE_CLIENT ?? '') ? config.ADSENSE_CLIENT : '';
const SLOTS = config.ADSENSE_SLOTS && typeof config.ADSENSE_SLOTS === 'object' ? config.ADSENSE_SLOTS : {};

let scriptAdded = false;
function addScript() {
  if (scriptAdded) return;
  scriptAdded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
  s.crossOrigin = 'anonymous';
  document.head.append(s);
}

/** 화면이 보일 때 그 화면의 광고 자리를 한 번 채운다. (숨겨진 자리는 크기가 0이라 채울 수 없다) */
export function fillAds(screenId) {
  if (native) {
    watchNativeSlots(screenId);
    return;
  }
  if (!CLIENT) return;
  const root = document.getElementById(screenId);
  if (!root) return;
  for (const slot of root.querySelectorAll('.ad-slot:not([data-filled])')) {
    const unit = String(SLOTS[slot.dataset.ad] ?? SLOTS.default ?? '');
    if (!/^\d{6,20}$/.test(unit)) continue;
    slot.hidden = false;
    // 이 기기에서 쓰지 않는 자리(휴대폰 전용·PC 전용)는 크기가 0이라 건너뛴다. 화면 크기가 바뀌면 다음에 채운다.
    if (slot.offsetWidth === 0) {
      slot.hidden = true;
      continue;
    }
    addScript();
    slot.dataset.filled = '1';
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = CLIENT;
    ins.dataset.adSlot = unit;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';
    slot.append(ins);
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // 광고 차단 등: 자리만 남는다
    }
  }
}

/* ---------------------------------------------------------------- 앱: AdMob 배너 */

const ATT_ASKED_KEY = 'yacht.attAsked';
const nativeAds = { ready: false, shown: false, created: false, visible: new Set(), observer: null, overlay: false };

function setBannerSpace(px) {
  document.documentElement.style.setProperty('--app-banner', `${Math.round(px)}px`);
}

function updateBanner() {
  const AdMob = native?.AdMob;
  if (!AdMob || !nativeAds.ready) return;
  const want = nativeAds.visible.size > 0 && !nativeAds.overlay && document.visibilityState === 'visible';
  if (want === nativeAds.shown) return;
  nativeAds.shown = want;
  document.body.classList.toggle('has-banner', want);
  if (want) {
    if (!nativeAds.created) {
      nativeAds.created = true;
      AdMob.showBanner({
        adId: native.ads.ios.banner,
        adSize: 'ADAPTIVE_BANNER',
        position: 'BOTTOM_CENTER',
        margin: 0,
        isTesting: native.ads.testing,
      }).catch(() => {
        nativeAds.created = false;
        nativeAds.shown = false;
        document.body.classList.remove('has-banner');
      });
    } else {
      AdMob.resumeBanner().catch(() => {});
    }
  } else {
    AdMob.hideBanner().catch(() => {});
  }
}

/** 지금 화면의 광고 자리(앱에서는 보이지 않는 표시용 칸)가 화면 안에 들어오는지 지켜본다. */
function watchNativeSlots(screenId) {
  nativeAds.observer?.disconnect();
  nativeAds.visible.clear();
  const root = document.getElementById(screenId);
  const slots = root ? [...root.querySelectorAll('.ad-slot:not(.ad-desktop)')] : [];
  nativeAds.observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) nativeAds.visible.add(e.target);
      else nativeAds.visible.delete(e.target);
    }
    updateBanner();
  });
  for (const slot of slots) {
    slot.hidden = false;
    slot.classList.add('native');
    nativeAds.observer.observe(slot);
  }
  updateBanner();
}

/** 팝업(결과·로그인 등)이 열려 있으면 배너를 숨긴다. */
function watchOverlays() {
  const check = () => {
    nativeAds.overlay = !!document.querySelector('.overlay:not([hidden])');
    updateBanner();
  };
  new MutationObserver(check).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', updateBanner);
}

/** iOS 추적 동의: 바로 묻지 않고 안내를 먼저 보여 준 뒤 시스템 창을 띄운다. 거부해도 게임은 그대로. */
async function askTracking() {
  if (native.platform !== 'ios') return;
  let status = 'notDetermined';
  try {
    ({ status } = await native.AdMob.trackingAuthorizationStatus());
  } catch {
    return;
  }
  if (status !== 'notDetermined') return;
  try {
    if (localStorage.getItem(ATT_ASKED_KEY)) return;
  } catch {
    // 무시
  }
  const box = document.getElementById('att');
  if (box) {
    box.hidden = false;
    await new Promise((resolve) => document.getElementById('att-ok').addEventListener('click', resolve, { once: true }));
    box.hidden = true;
  }
  try {
    localStorage.setItem(ATT_ASKED_KEY, '1');
  } catch {
    // 무시
  }
  await native.AdMob.requestTrackingAuthorization().catch(() => {});
}

/** 앱 시작 때 한 번: 개인정보 동의(필요한 지역만) → 추적 동의 → AdMob 시작. */
export async function startNativeAds() {
  if (!native?.AdMob) return;
  const { AdMob } = native;
  try {
    const info = await AdMob.requestConsentInfo();
    if (info.isConsentFormAvailable && info.status === 'REQUIRED') await AdMob.showConsentForm();
  } catch {
    // 동의 정보를 못 받아도 광고는 비맞춤으로 나갈 수 있다
  }
  await askTracking();
  try {
    await AdMob.initialize({ initializeForTesting: native.ads.testing });
  } catch {
    return;
  }
  AdMob.addListener('bannerAdSizeChanged', (size) => setBannerSpace(size?.height ?? 0));
  watchOverlays();
  nativeAds.ready = true;
  updateBanner();
}

/* ---------------------------------------------------------------- 앱: 보상형 광고 (광고 보고 포인트 2배) */

let rewardedLoad = null;

/** 앱에서 보상형 광고를 쓸 수 있으면 true (웹은 항상 false) */
export function rewardedAvailable() {
  return !!(native?.AdMob && native.ads?.ios?.rewarded && nativeAds.ready);
}

/** 미리 불러 둔다 (결과창이 열릴 때). 이미 불러 둔 게 있으면 그대로. */
export function prepareRewarded() {
  if (!rewardedAvailable()) return Promise.reject(new Error('광고를 쓸 수 없어요'));
  if (!rewardedLoad) {
    rewardedLoad = native.AdMob.prepareRewardVideoAd({ adId: native.ads.ios.rewarded, isTesting: native.ads.testing }).catch((err) => {
      rewardedLoad = null;
      throw err;
    });
  }
  return rewardedLoad;
}

/** 보상형 광고를 보여 준다. 끝까지 봐서 보상을 받으면 true, 중간에 닫거나 실패하면 false. */
export async function watchRewarded() {
  const { AdMob } = native;
  try {
    await prepareRewarded();
  } catch {
    return false;
  }
  rewardedLoad = null; // 한 번 보여 준 광고는 다시 못 쓴다
  return new Promise((resolve) => {
    let done = false;
    const handles = [];
    const finish = (value) => {
      if (done) return;
      done = true;
      for (const h of handles) h.then((x) => x.remove()).catch(() => {});
      resolve(value);
    };
    // 보상 없이 닫으면 show()가 끝나지 않으니 닫힘 이벤트로 알아챈다. (보상 → 닫힘 순서라 조금 기다린다)
    handles.push(AdMob.addListener('onRewardedVideoAdDismissed', () => setTimeout(() => finish(false), 400)));
    handles.push(AdMob.addListener('onRewardedVideoAdFailedToShow', () => finish(false)));
    AdMob.showRewardVideoAd().then(() => finish(true), () => finish(false));
  });
}
