// 서버 주소와 구글 로그인 클라이언트 ID. 배포할 때 GitHub Actions가 채워 넣는다.
// API_BASE가 비어 있으면 localhost에서는 로컬 서버(wrangler dev, 8787번 포트)를 쓰고, 그 외에는 서버 없이 동작한다.
// GOOGLE_CLIENT_ID가 비어 있으면 로그인 버튼을 보여 주지 않는다.
export const API_BASE = '';
export const GOOGLE_CLIENT_ID = '';
// 구글 애드센스: 게시자 ID(ca-pub-…)와 광고 단위 번호. 비어 있으면 광고를 띄우지 않는다.
// ADSENSE_SLOTS 예: { "default": "1234567890", "home": "…", "ranking": "…", "online": "…", "lobby": "…" }
export const ADSENSE_CLIENT = '';
export const ADSENSE_SLOTS = {};
