-- 유료 캐릭터 가격을 모두 500P로 통일하면서(2026-10-30), 그보다 비싸게 산 사람에게 차액을 돌려준다.
-- 구매 기록(point_log reason='buy', ref=아이템 id, amount=-가격)을 기준으로 한 번만 지급한다.

INSERT INTO point_log (user_id, amount, reason, ref, created_at)
SELECT user_id, -amount - 500, 'refund', 'animal-price-500:' || ref, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM point_log
 WHERE reason = 'buy'
   AND ref IN ('mouse', 'frog', 'beaver', 'seal', 'parrot', 'wolf', 'giraffe')
   AND -amount > 500
ON CONFLICT DO NOTHING;

UPDATE users
   SET points = points + (SELECT SUM(amount) FROM point_log
                           WHERE point_log.user_id = users.id AND reason = 'refund' AND ref LIKE 'animal-price-500:%'),
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE id IN (SELECT user_id FROM point_log WHERE reason = 'refund' AND ref LIKE 'animal-price-500:%');
