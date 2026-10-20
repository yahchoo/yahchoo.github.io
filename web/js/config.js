// 같이 하기 서버 주소. 배포할 때 GitHub Actions가 Cloudflare Worker 주소로 바꿔 넣는다.
// 비어 있으면 localhost에서는 로컬 서버(wrangler dev, 8787번 포트)를 쓰고, 그 외에는 같이 하기를 쓸 수 없다.
export const API_BASE = '';
