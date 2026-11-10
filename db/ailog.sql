-- AI 운영 로그 (중점 심사 06: 호출 수·응답 시간·비용·오류)
BEGIN;
CREATE TABLE IF NOT EXISTS ai_calls (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  day        date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  endpoint   text NOT NULL,            -- classify / classify_batch
  model      text NOT NULL,
  ms         integer NOT NULL,         -- 응답 시간
  chars      integer,                  -- 입력 길이 (비용 대신 쓰는 지표)
  n          integer NOT NULL DEFAULT 1,
  ok         boolean NOT NULL DEFAULT true,
  error      text,
  caller     text,                     -- admin / user / api
  session    text
);
CREATE INDEX IF NOT EXISTS ai_calls_day ON ai_calls (day, id DESC);
CREATE INDEX IF NOT EXISTS ai_calls_ok  ON ai_calls (ok) WHERE NOT ok;

/* 하루 지표. "비용(토큰)" 자리에는 입력 글자 수를 둡니다 —
   규칙 기반이라 토큰을 쓰지 않아서 비용이 0원입니다. 숨기지 않고 그대로 적습니다. */
CREATE OR REPLACE VIEW ai_daily AS
SELECT day,
       count(*)::int                                   AS calls,
       sum(n)::int                                     AS items,
       round(avg(ms))::int                             AS avg_ms,
       max(ms)                                         AS max_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY ms) AS p95_ms,
       sum(chars)::int                                 AS chars,
       count(*) FILTER (WHERE NOT ok)::int             AS errors
  FROM ai_calls GROUP BY day;
COMMIT;
