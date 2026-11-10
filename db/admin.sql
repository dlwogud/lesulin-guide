-- 관리자 계정 (중점 심사 04: 일반 사용자 접근 불가, 심사용 Admin 계정 제출)
BEGIN;
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS pw_hash    text,
  ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- 데이터 수정 이력 (중점 심사 01: "갱신 이력")
CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  admin_id   bigint REFERENCES admin_users(id),
  action     text NOT NULL,            -- update / delete / hide / restore
  entity     text NOT NULL,            -- store / video / poll / reply
  entity_id  text NOT NULL,
  before     jsonb,
  after      jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log (entity, entity_id);
COMMIT;
