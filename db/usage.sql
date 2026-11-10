-- 사용 현황 기록 (중점 심사 02: 방문자·검색어·클릭·재방문)
--   .venv/bin/python scripts/db_init.py --file db/usage.sql
--
-- 남기는 것과 남기지 않는 것을 분명히 둡니다.
--   남김   익명 방문자 id(브라우저가 만든 난수), 무슨 화면·무엇을 눌렀나, 검색어
--   안 남김 IP, 사용자 에이전트, 이메일 — 개인을 지목할 수 있는 것은 받지 않습니다
--
-- visitor 와 session 을 따로 둡니다.
--   session  탭을 닫으면 끝 → "이번에 몇 번 눌렀나"
--   visitor  브라우저에 계속 남음 → "다시 왔나" (재방문)

BEGIN;

ALTER TABLE access_log
  ADD COLUMN IF NOT EXISTS event   text NOT NULL DEFAULT 'view',
  ADD COLUMN IF NOT EXISTS q       text,
  ADD COLUMN IF NOT EXISTS visitor text,
  ADD COLUMN IF NOT EXISTS day     date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  ADD COLUMN IF NOT EXISTS meta    jsonb;

CREATE INDEX IF NOT EXISTS access_log_event   ON access_log (event, at DESC);
CREATE INDEX IF NOT EXISTS access_log_visitor ON access_log (visitor, day);
CREATE INDEX IF NOT EXISTS access_log_day     ON access_log (day);
CREATE INDEX IF NOT EXISTS access_log_store   ON access_log (store_id) WHERE store_id IS NOT NULL;

-- 하루 지표. 대시보드가 이걸 읽습니다.
CREATE OR REPLACE VIEW usage_daily AS
SELECT day,
       count(DISTINCT visitor)                                AS visitors,
       count(DISTINCT session)                                AS sessions,
       count(*) FILTER (WHERE event = 'view')                 AS views,
       count(*) FILTER (WHERE event = 'search')               AS searches,
       count(*) FILTER (WHERE event = 'store_open')           AS store_opens,
       count(*) FILTER (WHERE event = 'creator_pick')         AS creator_picks,
       count(*) FILTER (WHERE event = 'poll_open')            AS poll_opens
  FROM access_log
 GROUP BY day;

/* 재방문 — 이틀 이상 온 방문자.
   하루만 온 사람과 나눠 보면 "다시 쓰는 서비스인가"가 숫자로 나옵니다. */
CREATE OR REPLACE VIEW usage_returning AS
WITH v AS (SELECT visitor, count(DISTINCT day) AS days, min(day) AS first_day, max(day) AS last_day
             FROM access_log WHERE visitor IS NOT NULL GROUP BY visitor)
SELECT count(*)                              AS visitors,
       count(*) FILTER (WHERE days >= 2)     AS returning,
       round(100.0 * count(*) FILTER (WHERE days >= 2) / NULLIF(count(*), 0), 1) AS rate,
       round(avg(days), 2)                   AS avg_days
  FROM v;

COMMIT;
