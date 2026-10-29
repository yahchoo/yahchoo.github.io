// 앱에서만 쓰는 네이티브 기능을 웹 코드(web/js)가 쓸 수 있게 window.YachooNative로 내놓는다.
// build-web.mjs가 esbuild로 묶어서 www/js/cap.js로 넣는다. 웹 사이트에는 들어가지 않는다.
import { Capacitor } from '@capacitor/core';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { AdMob } from '@capacitor-community/admob';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

/* global __ADS__ */
window.YachooNative = {
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
  ads: __ADS__,
  SignInWithApple,
  AdMob,
  Share,
  Haptics,
  ImpactStyle,
  Browser,
  App,
};
