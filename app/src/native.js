// 앱에서만 쓰는 네이티브 기능을 웹 코드(web/js)가 쓸 수 있게 window.YachooNative로 내놓는다.
// build-web.mjs가 esbuild로 묶어서 www/js/cap.js로 넣는다. 웹 사이트에는 들어가지 않는다.
import { Capacitor } from '@capacitor/core';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { AdMob } from '@capacitor-community/admob';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { SocialLogin } from '@capgo/capacitor-social-login';

/* global __ADS__, __AUTH__ */
const platform = Capacitor.getPlatform();
window.YachooNative = {
  isNative: Capacitor.isNativePlatform(),
  platform,
  /** 이 플랫폼의 광고 단위 { banner, rewarded, testing } */
  ads: { ...(__ADS__[platform] ?? {}), testing: !!__ADS__.testing[platform] },
  /** 앱용 구글 로그인 설정 { googleIos, googleWeb } (iOS는 googleIos가 없으면 구글 로그인 숨김, 안드로이드는 googleWeb만 씀) */
  auth: __AUTH__,
  SocialLogin,
  SignInWithApple,
  AdMob,
  Share,
  Haptics,
  ImpactStyle,
  Browser,
  App,
};
