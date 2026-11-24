-- 실시간 투표·토론 (에브리타임식)
--   .venv/bin/python scripts/db_init.py --file db/polls.sql
--
-- 2026-11-24 부터 밤 12시 초기화가 없습니다. 글은 쓴 사람이 지우거나 관리자가 가리기 전까지 남고,
-- 화면의 인기순만 최근 7일 글로 좁힙니다(src/lib/pollsSql.ts). day 칸은 하루 통계용으로 남겨 둡니다.

BEGIN;

CREATE TABLE IF NOT EXISTS polls (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL,                  -- ask: 자유 질문 · store: 가게 지정
  body       text NOT NULL,
  store_id   text REFERENCES stores(id) ON DELETE SET NULL,
  lat        double precision,               -- 쓰지 않음 (11/24 부터 좌표는 저장하지 않고 place 만 남김)
  lng        double precision,
  place      text,                           -- "서울 마포구" 처럼 사람이 읽는 위치
  nickname   text,
  session    text NOT NULL,                  -- 익명 식별 (브라우저별)
  created_at timestamptz NOT NULL DEFAULT now(),
  day        date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  hidden     boolean NOT NULL DEFAULT false, -- Admin 이 가리는 용도
  CONSTRAINT polls_kind   CHECK (kind IN ('ask', 'store')),
  CONSTRAINT polls_body   CHECK (char_length(body) BETWEEN 2 AND 300),
  -- 가게를 지정한 글이면 가게가 있어야 좋아요·싫어요가 의미를 가집니다
  CONSTRAINT polls_store  CHECK (kind <> 'store' OR store_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS polls_day ON polls (day DESC, id DESC);

CREATE TABLE IF NOT EXISTS poll_replies (
  id         bigserial PRIMARY KEY,
  poll_id    bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  body       text NOT NULL,
  store_id   text REFERENCES stores(id) ON DELETE SET NULL,  -- 답글로 가게를 추천할 수 있습니다
  nickname   text,
  session    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  day        date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  hidden     boolean NOT NULL DEFAULT false,
  CONSTRAINT replies_body CHECK (char_length(body) BETWEEN 1 AND 300)
);
CREATE INDEX IF NOT EXISTS poll_replies_poll ON poll_replies (poll_id, id);

-- 한 브라우저가 한 글에 한 표. 다시 누르면 바꾸거나 취소합니다.
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  session    text NOT NULL,
  value      smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, session),
  CONSTRAINT votes_pm1 CHECK (value IN (-1, 1))
);

-- 답글에도 공감을 달 수 있게 둡니다 (추천이 모이는 글은 답글이 핵심입니다)
CREATE TABLE IF NOT EXISTS reply_votes (
  reply_id   bigint NOT NULL REFERENCES poll_replies(id) ON DELETE CASCADE,
  session    text NOT NULL,
  value      smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reply_id, session),
  CONSTRAINT reply_votes_pm1 CHECK (value IN (-1, 1))
);

-- 쓴 사람이 고친 시각. 화면에 "수정됨"을 붙입니다 (2026-11-24).
ALTER TABLE polls        ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE poll_replies ADD COLUMN IF NOT EXISTS edited_at timestamptz;

/* 좌측 "실시간 인기" — 반응이 많은 순.
   답글은 투표보다 품이 들어서 2배로 셉니다. 찬반이 갈려 시끄러운 글도
   올라오도록 투표는 부호를 지우고 양으로 셉니다(에브리타임 실시간 느낌).
   같은 점수면 최근 글이 위로 갑니다. */
CREATE OR REPLACE VIEW poll_feed AS
SELECT p.id, p.kind, p.body, p.store_id, s.name AS store_name, s.region AS store_region,
       p.place, p.nickname, p.created_at, p.day,
       COALESCE(r.n, 0)                                   AS replies,
       COALESCE(v.up, 0)                                  AS ups,
       COALESCE(v.down, 0)                                AS downs,
       COALESCE(r.n, 0) * 2 + COALESCE(v.up, 0) + COALESCE(v.down, 0) AS heat
  FROM polls p
  LEFT JOIN stores s ON s.id = p.store_id
  LEFT JOIN (SELECT poll_id, count(*) AS n FROM poll_replies
              WHERE NOT hidden GROUP BY poll_id) r ON r.poll_id = p.id
  LEFT JOIN (SELECT poll_id,
                    count(*) FILTER (WHERE value = 1)  AS up,
                    count(*) FILTER (WHERE value = -1) AS down
               FROM poll_votes GROUP BY poll_id) v ON v.poll_id = p.id
 WHERE NOT p.hidden;

COMMIT;
