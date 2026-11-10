-- 피드백·신고 관리 (중점 심사 05: 목록과 처리 상태)
BEGIN;

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS status     text NOT NULL DEFAULT 'open',  -- open / doing / done / rejected
  ADD COLUMN IF NOT EXISTS handled_by bigint REFERENCES admin_users(id),
  ADD COLUMN IF NOT EXISTS handled_at timestamptz,
  ADD COLUMN IF NOT EXISTS memo       text,
  ADD COLUMN IF NOT EXISTS visitor    text,
  ADD COLUMN IF NOT EXISTS day        date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date;

-- handled(불리언)는 남겨 두고 status 로 옮깁니다. 둘이 어긋나지 않게 맞춰 둡니다.
UPDATE feedback SET status = CASE WHEN handled THEN 'done' ELSE 'open' END
 WHERE status = 'open' AND handled;

ALTER TABLE feedback
  ADD CONSTRAINT feedback_status CHECK (status IN ('open','doing','done','rejected'))
  NOT VALID;

CREATE INDEX IF NOT EXISTS feedback_status ON feedback (status, id DESC);
CREATE INDEX IF NOT EXISTS feedback_store  ON feedback (store_id) WHERE store_id IS NOT NULL;

COMMIT;
