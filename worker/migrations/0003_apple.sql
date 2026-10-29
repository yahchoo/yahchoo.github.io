-- Apple로 로그인: 계정 삭제 때 애플에 연결 해제를 요청하기 위한 refresh token (암호화해서 저장)
CREATE TABLE apple_tokens (
  user_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
