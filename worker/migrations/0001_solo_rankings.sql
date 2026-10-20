-- 혼자 하기: 서버가 주사위를 굴린 게임. 랭킹에는 여기서 끝까지 진행된 게임만 올릴 수 있다.
CREATE TABLE solo_games (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,            -- JSON: sheet, dice, held, rollsLeft, rollSeq
  version INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  total INTEGER,
  ranked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX solo_games_updated ON solo_games (updated_at);

CREATE TABLE rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL UNIQUE,
  initials TEXT NOT NULL,
  score INTEGER NOT NULL,
  played_at INTEGER NOT NULL,     -- 게임을 끝낸 시각 (주간 랭킹 기준)
  created_at INTEGER NOT NULL
);
CREATE INDEX rankings_score ON rankings (score DESC, played_at ASC);
CREATE INDEX rankings_played ON rankings (played_at);
