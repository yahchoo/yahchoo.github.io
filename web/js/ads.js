// 웹 광고(구글 애드센스) 자리.
// config.js의 ADSENSE_CLIENT(ca-pub-…)와 광고 단위 번호(ADSENSE_SLOTS)가 있을 때만 광고를 불러온다.
// 값이 없으면 광고 자리는 숨겨 둔 채로 아무것도 불러오지 않는다.
// 광고는 버튼을 잘못 누르기 쉬운 곳(굴리기 버튼·점수판 칸 옆, 팝업)에는 두지 않는다.
// 게임 화면: 휴대폰은 점수판 맨 아래, PC는 주사위 아래 빈 공간. (.ad-mobile / .ad-desktop)
// 앱(Capacitor)에서는 애드센스 대신 AdMob 배너(admob.js)를 쓴다. 웹에서는 admob.js를 불러오지 않는다.
import * as config from './config.js';
import { IS_APP } from './native.js';

const CLIENT = !IS_APP && /^ca-pub-\d{10,20}$/.test(config.ADSENSE_CLIENT ?? '') ? config.ADSENSE_CLIENT : '';
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
  if (IS_APP) {
    fillAppAds();
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

/* 앱: 처음 한 번 AdMob을 시작하고(동의 받기), 화면이 바뀔 때마다 배너를 띄울지 다시 계산한다. */
let admob = null;
function fillAppAds() {
  admob ??= import('./admob.js').then((m) => {
    m.startAdMob();
    return m;
  });
  admob.then((m) => m.refreshAds()).catch(() => {});
}
