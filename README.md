# 야추 다이스

주사위 5개로 족보를 맞추는 야추(Yacht) 게임. 혼자 하기와 온라인 같이 하기(1:1, 1:1:1, 2:2)를 지원합니다.

- 웹: GitHub Pages (`web/`)
- 같이 하기 서버: Cloudflare Workers + Durable Objects (`worker/`)

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
  js/solo.js         # 혼자 하기 (기기에서 진행, 이어하기·최고 기록 저장)
  js/net.js          # 같이 하기 서버 연결·재접속
  js/app.js          # 화면
  js/config.js       # 서버 주소 (배포 때 자동으로 채워짐)
worker/              # Cloudflare Worker
  src/match.ts       # 방 규칙 (순수 로직, 단위 테스트)
  src/room.ts        # Durable Object: 연결·저장·타이머
  src/index.ts       # 라우팅, CORS
  test/              # vitest
```

## 처음 한 번 설정

1. **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로
2. Cloudflare 대시보드 → **My Profile → API Tokens → Create Token** → **Edit Cloudflare Workers** 템플릿
3. Cloudflare 대시보드 **Workers & Pages** 화면의 **Account ID** 복사
4. GitHub **Settings → Secrets and variables → Actions**에 시크릿 추가
   - `CLOUDFLARE_API_TOKEN`: 2번 토큰
   - `CLOUDFLARE_ACCOUNT_ID`: 3번 ID
5. `main`에 푸시하거나 **Actions → CI & Deploy → Run workflow**

Worker 이름은 `yacht-dice-api`라서 다른 프로젝트와 같은 Cloudflare 계정을 써도 겹치지 않습니다. 시크릿이 없으면 서버 배포는 건너뛰고 웹은 혼자 하기만 되는 상태로 배포됩니다. 서버 주소를 직접 정하려면 저장소 변수 `API_BASE_URL`을 넣으세요.

웹 주소가 바뀌면(저장소 이름 변경, 커스텀 도메인) `worker/wrangler.toml`의 `ALLOWED_ORIGINS`에 새 주소를 추가해야 같이 하기가 연결됩니다.

## 로컬 실행

```bash
cd worker && npm install
npm run dev                 # 서버: http://127.0.0.1:8787
npm test                    # 규칙·방 로직 테스트

# 다른 터미널에서
cd web && python3 -m http.server 5173
# http://localhost:5173 열기 (localhost에서는 자동으로 로컬 서버에 연결)
```
