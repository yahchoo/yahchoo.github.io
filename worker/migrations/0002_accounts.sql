-- 구글 로그인 계정, 포인트, 아바타 아이템
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,   -- 구글 계정 고유번호 (이메일·이름은 저장하지 않음)
  nickname TEXT NOT NULL,
  nickname_set INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  avatar TEXT NOT NULL,              -- JSON: animal, hat, face, outfit, bg
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,       -- 로그인 토큰의 SHA-256 (토큰 자체는 저장하지 않음)
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE user_items (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- 포인트가 바뀐 기록. 같은 판으로 두 번 받지 않게 (user_id, reason, ref)는 한 번만.
CREATE TABLE point_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,              -- solo | match | buy
  ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reason, ref)
);

ALTER TABLE solo_games ADD COLUMN user_id TEXT;
ALTER TABLE rankings ADD COLUMN user_id TEXT;
CREATE INDEX rankings_user ON rankings (user_id);
