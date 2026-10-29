# 오늘도 야추 앱 (Android · iOS)

`web/`을 [Capacitor](https://capacitorjs.com)로 앱 안에 묶은 것. 웹 화면을 그대로 쓰고(원격 주소를 띄우지 않고 로컬 번들), 서버는 운영 서버(`https://yacht-dice-api.shark-keeper.workers.dev`)를 쓴다.

- 앱 이름: 오늘도 야추
- 패키지명 / 번들 ID: `com.ohsang.play.yachoo`
- 광고: AdMob 화면 아래 고정 적응형 배너 (웹은 애드센스 그대로)
- 로그인: 네이티브 구글 로그인 (`@capgo/capacitor-social-login`) → 웹과 같은 `/api/auth/google`

## 구조

```
app/
  capacitor.config.json   # appId, 앱 이름, 스플래시·상태 표시줄·로그인 플러그인 설정
  ads.config.json         # AdMob ID (기본값: 구글 공식 테스트 ID)
  login.config.json       # 앱 구글 로그인 켜기 (기본: 꺼짐 → '준비 중' 안내)
  scripts/build-web.mjs   # web/ → www/ 복사, 앱용 config.js·네이티브 광고 ID 만들기
  scripts/make-assets.mjs # web/favicon.svg → 아이콘·스플래시 원본(assets/)
  android/  ios/          # 네이티브 프로젝트 (Capacitor)
```

웹 코드에서 앱 전용 부분은 `web/js/native.js`(공유·진동·뒤로가기·외부 링크), `web/js/admob.js`(배너, 앱에서만 불러옴), `web/js/account.js`(네이티브 로그인), `web/css/style.css`의 `.app` 규칙(앱 빌드의 `index.html`에만 `class="app"`이 붙음)이다. 웹에서는 모두 동작하지 않는다.

## 준비

- Node.js 22 이상
- Android: Android Studio (SDK 36), **JDK 21** (`JAVA_HOME`). Android Studio 내장 JDK가 21보다 새 버전이면 Gradle 8.14가 돌지 않으니 JDK 21을 따로 설치
- iOS: macOS + Xcode 16 이상 (Swift Package Manager 사용, CocoaPods 필요 없음)

## 빌드

```bash
cd app
npm install
npm run build              # web/ → www/ 복사 + 앱 설정 생성 + npx cap sync

# Android 디버그 APK → android/app/build/outputs/apk/debug/app-debug.apk
cd android && ./gradlew assembleDebug
npx cap run android        # 연결된 기기·에뮬레이터에 설치·실행 (app/에서)

# iOS (Mac)
npx cap open ios           # Xcode에서 시뮬레이터 선택 → Run
```

`web/`을 고치면 `npm run build`를 다시 해야 앱에 반영된다.

### 로컬 서버로 시험하기

운영 서버 대신 `worker/`의 로컬 서버(`npm run dev`, 8787번)에 붙이려면:

```bash
adb reverse tcp:8787 tcp:8787            # 에뮬레이터의 localhost:8787 → PC
API_BASE=http://localhost:8787 npm run build
```

(`http://localhost`는 https 페이지에서도 혼합 콘텐츠로 막히지 않는다.)

### 아이콘·스플래시

`npm run assets` — `web/favicon.svg`로 `assets/`(원본)를 만들고 `@capacitor/assets`로 Android·iOS 크기별 이미지를 만든다. 결과물(`android/.../res/mipmap-*`, `drawable*/splash.png`, `ios/.../Assets.xcassets`)은 커밋되어 있으니 그림을 바꿀 때만 다시 하면 된다.

## 광고 (AdMob)

- 처음 화면·같이 하기·대기실·랭킹·게임(점수판 아래) 화면에 광고 자리(`.ad-slot`, 게임은 `.ad-mobile`)가 있다. 앱에서는 이 자리를 위치 표시로만 쓰고, 자리가 화면에 보이면(IntersectionObserver) 화면 아래 고정 적응형 배너를 띄운다. 자리가 안 보이거나 자리가 없는 화면, 팝업(결과 창, 확인 창 등)이 열리면 숨긴다.
- 광고 자리가 있는 화면에서는 스크롤 영역을 배너 높이만큼 줄여서 배너가 버튼·점수판과 겹치지 않는다(AdMob 정책).
- 시작할 때 UMP 동의(유럽 등 필요한 지역에서만 폼), iOS는 첫 실행 때 안내 화면 뒤 추적 허용(ATT)을 묻는다. 거부하면 비맞춤 광고(`npa`)만 나온다.

### 실제 광고 ID로 바꾸기

`ads.config.json`은 **구글 테스트 ID**라 그대로 커밋해 둔다. 실제 ID는 커밋하지 말고 둘 중 하나로 넣는다.

1. `app/ads.config.local.json` (`.gitignore`에 있음)
   ```json
   {
     "android": { "appId": "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY", "banner": "ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ" },
     "ios":     { "appId": "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY", "banner": "ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ" }
   }
   ```
2. 환경변수: `ADMOB_ANDROID_APP_ID`, `ADMOB_ANDROID_BANNER_ID`, `ADMOB_IOS_APP_ID`, `ADMOB_IOS_BANNER_ID`

그 다음 `npm run build`. 앱 ID는 커밋하지 않는 파일(`android/app/src/main/res/values/app_config.xml`, `ios/AppConfig.xcconfig`)로 들어가 `AndroidManifest.xml`의 `com.google.android.gms.ads.APPLICATION_ID`와 `Info.plist`의 `GADApplicationIdentifier`가 읽는다. 테스트 ID(게시자 `3940256099942544`)면 자동으로 테스트 모드로 요청한다.

- 개발 중에는 실제 광고를 누르지 말 것. 실제 ID로 시험할 때는 AdMob 콘솔 **설정 → 테스트 기기**에 기기를 등록
- AdMob 게시자 ID가 담긴 `app-ads.txt`를 스토어 등록 정보에 적은 개발자 웹사이트(예: `ohsangplay.com`) 루트에 올려야 광고가 제대로 나온다
- SKAdNetwork 목록(`Info.plist`)은 [구글 안내](https://developers.google.com/admob/ios/quick-start#update_your_infoplist)의 최신 목록으로 가끔 갱신

## 구글 로그인

구글은 앱 안 WebView에서 웹 로그인(GIS 버튼)을 막아서, 앱은 네이티브 로그인으로 ID 토큰을 받아 `/api/auth/google`에 `credential`로 보낸다. 서버는 토큰의 `aud`를 허용 목록(`GOOGLE_CLIENT_IDS`, 없으면 `GOOGLE_CLIENT_ID`)과 비교한다.

- Android·iOS 모두 serverClientId(`webClientId`, `iOSServerClientId`)에 **웹 클라이언트 ID**를 넣어서 토큰 aud가 웹 ID가 된다
- 설정 전(`login.config.json`이 꺼져 있음)에는 로그인 창에 "앱에서 로그인은 준비 중이에요" 안내만 나오고 나머지는 그대로 된다

### GCP에서 할 일 (프로젝트 `yahchoo`)

**Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**

1. **Android** 클라이언트 (서명 키마다 하나씩)
   - 패키지 이름: `com.ohsang.play.yachoo`
   - SHA-1 인증서 지문:
     - 디버그: `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android` (Windows는 `%USERPROFILE%\.android\debug.keystore`)
     - 업로드 키: 아래 '서명 키'에서 만든 키스토어로 같은 명령
     - Play 스토어 배포: Play Console → **앱 무결성 → 앱 서명 키 인증서**의 SHA-1도 따로 등록
   - 앱에서는 이 ID를 쓰지 않는다(패키지명+SHA-1 확인용). 토큰은 웹 클라이언트 ID로 받는다
2. **iOS** 클라이언트
   - 번들 ID: `com.ohsang.play.yachoo`
   - 만든 뒤 나오는 **클라이언트 ID**(`숫자-문자.apps.googleusercontent.com`)를 아래에 넣는다
3. **OAuth 동의 화면**이 '프로덕션'(게시됨) 상태인지 확인 (테스트 상태면 등록한 테스트 사용자만 로그인됨)

### 켜기

`app/login.config.json`(또는 커밋하지 않을 거면 `login.config.local.json`, 환경변수 `GOOGLE_LOGIN_ANDROID=1`, `GOOGLE_IOS_CLIENT_ID`):

```json
{ "android": true, "iosClientId": "123456789-abcdef.apps.googleusercontent.com" }
```

→ `npm run build`. iOS는 클라이언트 ID를 거꾸로 쓴 URL 스킴(`com.googleusercontent.apps.…`)이 `ios/AppConfig.xcconfig`를 거쳐 `Info.plist`의 `CFBundleURLTypes`에 들어간다. (클라이언트 ID는 비밀값이 아니라 커밋해도 된다)

혹시 iOS 토큰의 aud가 iOS 클라이언트 ID로 오면(서버가 "이 사이트의 로그인이 아니에요"로 거절) GitHub 저장소 **변수** `GOOGLE_APP_CLIENT_IDS`에 iOS 클라이언트 ID를 넣고 다시 배포하면 서버 허용 목록에 추가된다(쉼표로 여러 개).

Android 로그인이 실패하면 Logcat에서 `GoogleProvider`로 걸러 보면 플러그인이 패키지명·SHA-1을 찍어 준다. GCP에 등록한 값과 같은지 확인.

## 서명 키 (Android 출시용)

```bash
keytool -genkeypair -v -keystore yahchoo-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

- 키스토어(`*.jks`, `*.keystore`)와 비밀번호는 **커밋하지 말고** 안전한 곳에 백업 (`.gitignore`에 있음)
- 출시 빌드: Android Studio **Build → Generate Signed App Bundle**(AAB), 또는 `android/keystore.properties`(커밋 안 됨)를 만들어 `app/build.gradle`의 `signingConfigs`에서 읽게 한다
- Play App Signing을 쓰면 업로드 키와 앱 서명 키가 다르니 두 SHA-1을 모두 GCP Android 클라이언트에 등록

## iOS: Mac에서 할 일

1. `git pull` → `cd app && npm install && npm run build`
2. `npx cap open ios` → Xcode
3. **Signing & Capabilities**: Team 선택(Apple Developer 계정), 번들 ID `com.ohsang.play.yachoo` 확인
4. 시뮬레이터(iPhone) 선택 → Run. 첫 실행 때 광고 안내 → 추적 허용 창 → 테스트 배너 확인
5. 확인할 것: 상태 표시줄·노치·홈 표시줄 여백, 공유(친구 초대), 진동(실기기), 외부 링크가 Safari로 열리는지
6. 출시: Product → Archive → App Store Connect 업로드. App Store Connect **앱 개인정보 보호**에 '광고 데이터·기기 ID(추적에 사용)'를 신고

## 스토어 등록에 필요한 것 (직접)

- Play Console / App Store Connect 앱 만들기 (이름 '오늘도 야추', 패키지 `com.ohsang.play.yachoo`)
- 개인정보처리방침 URL: `https://yahchoo.ohsangplay.com/privacy.html` (앱 광고 내용 포함)
- 계정 삭제 안내 URL(Play 필수): 지금은 `privacy.html`의 '탈퇴와 문의'. 따로 페이지를 만드는 게 좋다
- Play **데이터 보안**: 기기 또는 기타 ID(광고 ID) 수집·공유(광고), 앱 활동, 사용자 ID(구글 계정 고유번호)
- Play **광고 포함** 체크, 콘텐츠 등급 설문, 타깃 연령(아동 대상 아님)
- 스크린샷·아이콘(512×512, `assets/icon-only.png`에서)·그래픽 이미지(1024×500)
- AdMob: 앱 등록(Android·iOS 각각) → 배너 광고 단위 만들기 → 위 '실제 광고 ID로 바꾸기', 스토어 게시 후 AdMob에서 스토어 연결
