-- 르슐랭 가이드 — PostgreSQL 스키마
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- 설계에서 지킨 것 두 가지
--   1) 분류기 결과(comment_analysis)와 사람 검수(admin_reviews)를 분리합니다.
--      분류기를 다시 돌려도 사람이 고친 판정은 남아야 하고, 그 차이가 그대로
--      정확도 측정 데이터가 됩니다. 지금 CSV로 하던 라벨링을 Admin이 대체합니다.
--   2) 화면이 읽는 집계는 store_stats 에 따로 둡니다. 지도를 움직일 때마다
--      28만 댓글을 집계하면 안 됩니다. 파이프라인이 끝날 때 갱신합니다.

BEGIN;

CREATE TABLE IF NOT EXISTS creators (
  id           text PRIMARY KEY,              -- c1, c2, ...
  name         text NOT NULL,
  handle       text,
  short_name   text NOT NULL,                 -- 화면용 짧은 이름
  color        text NOT NULL,
  channel_id   text UNIQUE NOT NULL,          -- 유튜브 UC...
  subscribers  bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stores (
  id           text PRIMARY KEY,              -- s1, s2, ...
  name         text NOT NULL,
  address      text,
  region       text NOT NULL,                 -- "서울특별시 중구"
  category     text,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  coord_source text,                          -- naver / kakao / google
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stores_latlng_kr CHECK (lat BETWEEN 33 AND 39 AND lng BETWEEN 124 AND 132)
);
-- 지도는 "이 화면 안의 식당"을 묻습니다. 위·경도 복합 인덱스로 충분합니다
-- (PostGIS 없이도 bounding box 조회가 인덱스를 씁니다).
CREATE INDEX IF NOT EXISTS stores_bbox    ON stores (lat, lng);
CREATE INDEX IF NOT EXISTS stores_region  ON stores (region);

CREATE TABLE IF NOT EXISTS videos (
  id           text PRIMARY KEY,              -- 유튜브 영상 id
  creator_id   text NOT NULL REFERENCES creators(id),
  title        text NOT NULL,
  published_at date,
  views        bigint,
  duration     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS videos_creator ON videos (creator_id);

-- 한 영상이 여러 가게를, 한 가게가 여러 영상을 가질 수 있습니다
-- (겹치는 가게 56곳이 여기서 나옵니다).
CREATE TABLE IF NOT EXISTS store_videos (
  store_id     text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  video_id     text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  PRIMARY KEY (store_id, video_id)
);
CREATE INDEX IF NOT EXISTS store_videos_video ON store_videos (video_id);

CREATE TABLE IF NOT EXISTS comments (
  id           bigserial PRIMARY KEY,
  video_id     text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  body         text NOT NULL,
  published_at date,
  likes        integer NOT NULL DEFAULT 0,
  author_id    text,                          -- 운영자·홍보 걸러내기에 씁니다
  is_owner     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS comments_video ON comments (video_id);
-- 같은 영상을 다시 받아도 쌓이지 않게 막습니다.
-- 본문을 그대로 색인하면 긴 댓글이 btree 한계(2704바이트)를 넘겨 적재가 멈춥니다.
-- 2,700자가 넘는 댓글이 실제로 있어서 md5 해시로 색인합니다.
CREATE UNIQUE INDEX IF NOT EXISTS comments_dedup
  ON comments (video_id, md5(body), published_at);

-- ── 분류기 결과 ─────────────────────────────────────────────────
-- 방문 판정은 댓글 단위, 항목·감성은 댓글×항목 단위입니다.
CREATE TABLE IF NOT EXISTS comment_analysis (
  comment_id   bigint PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
  is_visit     boolean NOT NULL,
  model        text NOT NULL,                 -- 'rule:visit_lexicon@v2' 처럼 버전을 남깁니다
  run_id       bigint,
  analyzed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comment_analysis_visit ON comment_analysis (is_visit);

CREATE TABLE IF NOT EXISTS comment_aspects (
  comment_id   bigint NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  aspect       text NOT NULL,                 -- 맛 / 양 / 가격 / 서비스 / 대기 / 분위기
  polarity     smallint NOT NULL,             -- +1 / -1
  PRIMARY KEY (comment_id, aspect),
  CONSTRAINT polarity_pm1 CHECK (polarity IN (-1, 1))
);
CREATE INDEX IF NOT EXISTS comment_aspects_aspect ON comment_aspects (aspect);

-- ── 사람 검수 (Admin) ───────────────────────────────────────────
-- 분류기를 다시 돌려도 지워지지 않습니다. comment_analysis 와 비교하면
-- 그 자리에서 정밀도·재현율이 나옵니다.
CREATE TABLE IF NOT EXISTS admin_users (
  id           bigserial PRIMARY KEY,
  email        text UNIQUE NOT NULL,
  name         text,
  role         text NOT NULL DEFAULT 'reviewer',   -- reviewer / admin
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_reviews (
  id           bigserial PRIMARY KEY,
  comment_id   bigint NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reviewer_id  bigint REFERENCES admin_users(id),
  is_visit     boolean,                       -- NULL = 방문 판정은 손대지 않음
  aspects      jsonb,                         -- {"맛": 1, "대기": -1} · NULL = 미검수
  vague        boolean NOT NULL DEFAULT false, -- 사람도 애매하다고 본 것 (채점 제외)
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, reviewer_id)            -- 한 사람이 한 댓글에 한 번
);
CREATE INDEX IF NOT EXISTS admin_reviews_comment ON admin_reviews (comment_id);

-- ── 화면이 읽는 집계 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_stats (
  store_id      text PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  comments_all  integer NOT NULL DEFAULT 0,   -- 받은 댓글 수
  comments_used integer NOT NULL DEFAULT 0,   -- 항목이 잡힌 댓글 수
  visits        integer NOT NULL DEFAULT 0,   -- 방문 명시 댓글 수
  negatives     integer NOT NULL DEFAULT 0,   -- 대기 제외 부정 수
  waits         integer NOT NULL DEFAULT 0,   -- 대기 부정 수 (줄 서는 집)
  aspects       jsonb,                        -- [{"a":"맛","p":100,"n":4}, ...]
  quotes        jsonb,                        -- {"pos":{...},"neg":{...}}
  guide_level   smallint,                     -- 1~3 · NULL = 배지 없음
  status        text NOT NULL DEFAULT 'NEW',  -- NEW / RATED
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_stats_rank ON store_stats (comments_used DESC, visits DESC);

-- ── 운영 로그 (중점 심사: AI 운영 로그) ─────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id           bigserial PRIMARY KEY,
  step         text NOT NULL,                 -- collect_channel / collect_comments / analyze / build_stats
  model        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  ok           boolean,
  quota_used   integer,
  counts       jsonb,                         -- {"videos":1027,"comments":275867}
  message      text
);

-- 사용 현황 (중점 심사: 사용 현황)
CREATE TABLE IF NOT EXISTS access_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  path         text NOT NULL,
  store_id     text,
  creator_id   text,
  session      text
);
CREATE INDEX IF NOT EXISTS access_log_at ON access_log (at DESC);

-- 사용자 피드백 (중점 심사: 피드백)
CREATE TABLE IF NOT EXISTS feedback (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  store_id     text REFERENCES stores(id) ON DELETE SET NULL,
  kind         text NOT NULL,                 -- wrong_place / closed / wrong_score / other
  body         text,
  session      text,
  handled      boolean NOT NULL DEFAULT false
);

COMMIT;
