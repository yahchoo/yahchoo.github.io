# 야추 다이스

주사위 5개로 족보를 맞추는 야추(Yacht) 게임. 혼자 하기와 온라인 같이 하기(1:1, 1:1:1, 2:2)를 지원합니다.

- 웹: https://yahchoo.ohsangplay.com (GitHub Pages 커스텀 도메인, `web/`. https://yahchoo.github.io 는 새 주소로 넘어감)
- 같이 하기 서버: Cloudflare Workers + Durable Objects (`worker/`)
- 앱: Android·iOS (Capacitor로 `web/`을 묶음, `app/`). 빌드·광고·로그인 설정은 [app/README.md](app/README.md)

## 규칙 (세계의 아소비 대전 51 기준)

- 한 차례에 최대 3번 굴리고, 굴린 뒤 남길 주사위를 고정할 수 있음
- 차례마다 빈 칸 하나에 점수를 적고, 12칸을 채우면 끝
- 상단(에이스~식스) 합계 63점 이상이면 보너스 35점

| 칸 | 점수 |
| --- | --- |
| 에이스 ~ 식스 | 해당 눈의 합 |
| 초이스 | 5개의 합 |
| 포 카드 | 같은 눈 4개 이상이면 5개의 합 |
| 풀하우스 | 같은 눈 3개 + 2개면 5개의 합 (5개가 모두 같은 경우는 인정 안 함) |
| S. 스트레이트 | 이어지는 눈 4개면 15점 |
| L. 스트레이트 | 이어지는 눈 5개면 30점 |
| 야추 | 5개가 모두 같으면 50점 |

## 혼자 하기와 랭킹

- 주사위는 서버가 굴림 (기기에서 점수를 조작할 수 없게). 새로고침하거나 다시 들어와도 하던 판을 이어서 함
- 서버에 연결할 수 없으면 기기에서 굴리는 오프라인 판으로 진행 (랭킹 등록 불가)
- 12칸을 다 채우면 영문 이니셜 3글자로 랭킹 등록. 판마다 한 번, 끝낸 뒤 24시간 안
- 랭킹은 **이번 주**(한국 시간 월요일 0시 시작)와 **전체** 두 가지, 점수가 같으면 같은 순위

| API | 설명 |
| --- | --- |
| `POST /api/solo/start` | 새 판 → 게임 상태 |
| `GET /api/solo/{gameId}` | 하던 판 불러오기 |
| `POST /api/solo/roll` | `{gameId, held: [bool×5]}` 굴리기 |
| `POST /api/solo/score` | `{gameId, category}` 칸에 적기 |
| `POST /api/rankings` | `{gameId, initials}` 랭킹 등록 → 이번 주·전체 순위 |
| `GET /api/rankings?period=week\|all` | 랭킹 목록 (최대 50개) |

## 로그인·포인트·아바타

- 구글 로그인 (선택). 로그인하지 않아도 모든 게임을 할 수 있음
- 저장하는 정보: 구글 계정 고유번호(sub), 닉네임, 아바타, 포인트·아이템. 이메일·이름은 저장하지 않음 ([개인정보처리방침](web/privacy.html))
- 포인트: 모든 게임에서 점수의 10%(버림). 규칙은 `web/js/points.js` (웹과 서버가 함께 씀)
- 혼자 하기: 로그인한 판은 끝나면 포인트를 받고 닉네임+아바타로 랭킹에 자동 등록 (랭킹에는 사람마다 최고 기록 하나)
- 로그인하지 않고 끝낸 판도 24시간 안에 로그인하면 포인트를 받을 수 있음
- 같이 하기: 끝까지 하면 등수 보너스 — 1:1 이긴 사람 10·진 사람 1, 1:1:1 1등 15·2등 5·3등 1, 2:2 이긴 팀 각자 20·진 팀 각자 5 (공동 등수는 같은 보너스, 기권으로 끝나면 보너스 없음, 나간 사람은 포인트 없음)
- 아바타: 캐릭터 11종(고양이·강아지·남자·여자는 기본, 쥐·개구리·비버·물범·앵무새·늑대·기린은 포인트로 열기) + 모자·얼굴·옷·배경 아이템. 목록·가격·그림은 `web/js/avatar.js` (웹과 서버가 함께 씀)
- 포인트 지급과 구매는 서버에서 트랜잭션으로 처리 (같은 판으로 두 번 받거나, 두 번 눌러 두 번 결제되지 않음)

| API | 설명 |
| --- | --- |
| `POST /api/auth/google` | `{credential}` 구글 ID 토큰 → `{token, me}` |
| `POST /api/auth/logout` | 로그아웃 |
| `GET /api/me` | 내 정보 (닉네임, 포인트, 아바타, 가진 아이템) |
| `POST /api/me/profile` | `{nickname?, avatar?}` |
| `POST /api/shop/buy` | `{itemId}` |
| `POST /api/solo/claim` | `{gameId}` 로그인하지 않고 끝낸 판의 포인트 받기 |

요청에 `Authorization: Bearer <token>`을 붙이면 로그인한 사용자로 처리합니다. 같이 하기는 방에 들어간 뒤 `{type: 'auth', token}`을 보냅니다.

## 같이 하기

- 방 만들기에서 방식(1:1, 1:1:1, 2:2)을 고르면 4글자 방 코드가 나옴. 코드나 초대 링크(`?room=CODE`)로 입장
- 인원이 다 차면 방장이 시작. 순서는 무작위, 2:2는 팀을 번갈아(A1 B1 A2 B2)
- 2:2는 각자 자기 점수판을 채우고 팀 두 사람의 총점으로 겨룸
- 한 차례 60초. 시간이 지나면 (안 굴렸으면 한 번 굴리고) 점수가 가장 높은 빈 칸에 대신 적음
- 연결이 끊기면 자동으로 다시 연결해서 같은 자리로 돌아옴. 끊긴 사람의 차례는 10초만 기다림
- 게임 중 나가기 = 기권. 1:1·2:2는 그 쪽이 바로 지고, 1:1:1은 그 사람만 빠지고 나머지가 계속
- 끝난 뒤 방장이 '다시 하기'를 누르면 같은 방 대기실로 돌아감
- 주사위는 서버에서만 굴림 (조작 방지)

| API | 설명 |
| --- | --- |
| `POST /api/rooms` | `{mode: "1v1" \| "1v1v1" \| "2v2"}` → `{code}` |
| `GET /api/rooms/{code}/ws?name=닉네임[&playerId=…]` | 방 WebSocket. 서버 → `welcome`, `state`, `error` / 웹 → `team`, `start`, `roll`, `hold`, `score`, `rematch`, `leave` |
| `GET /api/health` | 상태 확인 |

## 구조

```
web/                 # 정적 웹 (빌드 과정 없음)
  index.html
  css/style.css
  js/rules.js        # 족보·점수 계산 (웹과 서버가 함께 씀)
  js/solo.js         # 혼자 하기 (서버 굴림, 오프라인이면 기기에서)
  js/account.js      # 로그인·내 정보
  js/avatar.js       # 아바타 아이템·그림 (서버도 씀)
  privacy.html       # 개인정보처리방침
  js/net.js          # 같이 하기 서버 연결·재접속
  js/app.js          # 화면
  js/config.js       # 서버 주소 (배포 때 자동으로 채워짐)
  js/native.js       # 앱 연결: 공유·진동·뒤로가기·외부 링크 (웹에서는 아무것도 안 함)
  js/admob.js        # 앱 광고 배너 (앱에서만 불러옴)
app/                 # Android·iOS 앱 (Capacitor, app/README.md)
worker/              # Cloudflare Worker
  src/match.ts       # 방 규칙 (순수 로직, 단위 테스트)
  src/solo.ts        # 혼자 하기(서버 굴림)·이니셜·주간 기준 (순수 로직)
  src/auth.ts        # 구글 ID 토큰 검증, 로그인 토큰
  src/account.ts     # 계정·포인트·상점
  migrations/        # D1 테이블 (solo_games, rankings)
  src/room.ts        # Durable Object: 연결·저장·타이머
  src/index.ts       # 라우팅, CORS
  test/              # vitest
```

## 처음 한 번 설정

1. **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로
2. Cloudflare 대시보드 → **My Profile → API Tokens → Create Token** → **Edit Cloudflare Workers** 템플릿에 **Account · D1 · Edit** 권한 추가 (랭킹 데이터베이스용)
3. Cloudflare 대시보드 **Workers & Pages** 화면의 **Account ID** 복사
4. GitHub **Settings → Secrets and variables → Actions**에 시크릿 추가
   - `CLOUDFLARE_API_TOKEN`: 2번 토큰
   - `CLOUDFLARE_ACCOUNT_ID`: 3번 ID
5. `main`에 푸시하거나 **Actions → CI & Deploy → Run workflow**
6. (구글 로그인) Google Cloud 프로젝트 `yahchoo`의 OAuth 클라이언트 ID(웹 애플리케이션, 승인된 JavaScript 원본 `https://yahchoo.ohsangplay.com`, `https://yahchoo.github.io`)가 `.github/workflows/ci.yml`에 기본값으로 들어가 있음. 다른 ID를 쓰려면 저장소 **변수** `GOOGLE_CLIENT_ID`를 넣으면 그 값을 우선 사용
   - 앱 로그인: 서버는 토큰의 aud가 웹 ID이거나 저장소 **변수** `GOOGLE_APP_CLIENT_IDS`(쉼표로 구분, 예: iOS 클라이언트 ID)에 있으면 받아 줌 (`GOOGLE_CLIENT_IDS`로 배포). 자세한 건 [app/README.md](app/README.md)

배포할 때 D1 데이터베이스(`yacht-dice`)를 찾거나 만들고 테이블을 준비하는 것까지 자동으로 합니다. Worker 이름은 `yacht-dice-api`라서 다른 프로젝트와 같은 Cloudflare 계정을 써도 겹치지 않습니다. 시크릿이 없으면 서버 배포는 건너뛰고 웹은 혼자 하기만 되는 상태로 배포됩니다. 서버 주소를 직접 정하려면 저장소 변수 `API_BASE_URL`을 넣으세요.

웹 주소가 바뀌면(저장소 이름 변경, 커스텀 도메인) `worker/wrangler.toml`의 `ALLOWED_ORIGINS`에 새 주소를 추가해야 같이 하기가 연결됩니다.

## 도메인

- `yahchoo.ohsangplay.com` → GitHub Pages. Cloudflare DNS에 `CNAME yahchoo → yahchoo.github.io` (프록시 끔), 저장소 Settings → Pages → Custom domain에 같은 주소
- 웹 주소를 바꾸면 `worker/wrangler.toml`의 `ALLOWED_ORIGINS`와 구글 OAuth 클라이언트의 승인된 JavaScript 원본에 새 주소를 추가해야 함

## 로컬 실행

```bash
cd worker && npm install
npm run dev                 # 로컬 D1 테이블 준비 + 서버: http://127.0.0.1:8787
npm test                    # 규칙·방 로직 테스트

# 로그인 테스트: worker/.dev.vars에 DEV_LOGIN=1을 넣으면 localhost에서 '개발용 로그인' 버튼이 생김

# 다른 터미널에서
cd web && python3 -m http.server 5173
# http://localhost:5173 열기 (localhost에서는 자동으로 로컬 서버에 연결)
```
