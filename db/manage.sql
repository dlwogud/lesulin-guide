-- 데이터·콘텐츠 관리 (중점 심사 01: 등록·수정·삭제, 갱신 이력)
BEGIN;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS hidden     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hide_note  text;

ALTER TABLE store_stats
  -- 배지는 파이프라인이 계산합니다. 운영자가 손으로 바꾼 경우 그 사실을 남겨
  -- 다음 계산이 덮어쓰지 않게 합니다.
  ADD COLUMN IF NOT EXISTS level_override smallint,
  ADD COLUMN IF NOT EXISTS override_note  text;

CREATE INDEX IF NOT EXISTS stores_hidden ON stores (hidden) WHERE hidden;

COMMIT;
