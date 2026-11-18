-- 혼자 하기 아이템전: 랭킹에 아이템전 판인지 표시 (같은 랭킹에 함께 나오고 옆에 아이콘)
ALTER TABLE rankings ADD COLUMN items INTEGER NOT NULL DEFAULT 0;
