-- AI 적용 (최종발표): LLM 판정 · 혼합 결과 · 근거 요약 · AI 비교 검수
-- 기존 규칙 결과(comment_analysis)·사람 검수(admin_reviews)·식당 점수(store_stats)는 건드리지 않습니다.
-- 추가만 합니다 — 다시 실행해도 안전합니다.
BEGIN;

-- 호출 로그에 토큰·비용 칸 추가 (규칙 호출은 0 / NULL)
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS input_tokens   integer;
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS output_tokens  integer;
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS cost_usd       numeric(10,6);
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS ref            text;      -- 댓글 id · 식당 id

-- LLM 이 한 번 판정할 때마다 한 줄. 같은 댓글을 다시 부르면 줄이 늘어납니다(덮어쓰지 않음).
CREATE TABLE IF NOT EXISTS llm_judgments (
  id             bigserial PRIMARY KEY,
  comment_id     bigint REFERENCES comments(id) ON DELETE CASCADE,
  purpose        text NOT NULL,          -- store_apply (시연 식당 적용) / admin_live (Admin 버튼)
  label          text,                   -- yes / no / unsure (오류면 NULL)
  evidence       text,
  evidence_ok    boolean,
  reason         text,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(10,6),
  ms             integer,
  error          text,
  actor          text,                   -- script / admin:<id>
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_judgments_comment ON llm_judgments (comment_id, id DESC);

-- 시연 식당 댓글의 혼합 판정 (규칙 → 애매하면 LLM). 이 표에 있는 댓글만 "AI 분석 적용"입니다.
CREATE TABLE IF NOT EXISTS ai_visit (
  comment_id     bigint PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
  store_id       text NOT NULL REFERENCES stores(id),
  rule_visit     boolean NOT NULL,
  routed         boolean NOT NULL,       -- LLM 에 보냈는가
  why            text[],                 -- 보낸 이유 (분기 조건)
  judgment_id    bigint REFERENCES llm_judgments(id),
  final_visit    boolean NOT NULL,
  source         text NOT NULL,          -- rule / llm / rule-fallback
  route_version  text NOT NULL,
  prompt_version text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_visit_store ON ai_visit (store_id);

-- 식당별 근거 댓글 3줄 요약. 화면을 열 때 만들지 않고 여기 저장한 것을 보여 줍니다.
CREATE TABLE IF NOT EXISTS ai_summaries (
  store_id       text PRIMARY KEY REFERENCES stores(id),
  status         text NOT NULL,          -- ok / insufficient
  lines          jsonb NOT NULL,         -- [{kind, text, commentIds:[...]}]
  evidence_ids   bigint[] NOT NULL,      -- 요약에 넘긴 방문 댓글 전부
  n_evidence     integer NOT NULL,
  model          text,
  prompt_version text,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(10,6),
  ms             integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at    timestamptz,            -- 사람이 원문과 대조한 때
  reviewer_id    bigint REFERENCES admin_users(id),
  review         jsonb                   -- 줄별 대조 결과 {line: ok|fix, note}
);

-- AI 비교 화면에서 사람이 내린 최종 판정. admin_reviews(무작위 정확도 표본)와 섞지 않습니다.
CREATE TABLE IF NOT EXISTS ai_reviews (
  id           bigserial PRIMARY KEY,
  comment_id   bigint NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reviewer_id  bigint REFERENCES admin_users(id),
  is_visit     boolean NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reviews_comment ON ai_reviews (comment_id, id DESC);

-- 하루 지표에 토큰·비용 추가 (기존 열 순서 유지, 뒤에만 붙임)
CREATE OR REPLACE VIEW ai_daily AS
SELECT day,
       count(*)::int                                   AS calls,
       sum(n)::int                                     AS items,
       round(avg(ms))::int                             AS avg_ms,
       max(ms)                                         AS max_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY ms) AS p95_ms,
       sum(chars)::int                                 AS chars,
       count(*) FILTER (WHERE NOT ok)::int             AS errors,
       COALESCE(sum(input_tokens), 0)::int             AS input_tokens,
       COALESCE(sum(output_tokens), 0)::int            AS output_tokens,
       COALESCE(sum(cost_usd), 0)::numeric(10,4)       AS cost_usd
  FROM ai_calls GROUP BY day;
COMMIT;
