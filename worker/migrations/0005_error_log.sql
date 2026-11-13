-- 서버(같이 하기 방 등)에서 난 예상 못 한 오류 기록. 원인 파악용으로 최근 7일만 남긴다.
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  place TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT
);
CREATE INDEX IF NOT EXISTS error_log_at ON error_log (at);
