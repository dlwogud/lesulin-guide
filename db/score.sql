-- 르슐랭 점수(100점) · 점수 기반 배지 (2026-11-23)
--
-- 점수 = 100 × (0.6 × 반응 점수 + 0.4 × 만족 점수)
--   반응 점수 = ln(1 + 반응) ÷ ln(1 + 40)                         반응 40건이면 만점, 로그라 적은 쪽 차이가 큽니다
--   보정 만족률 = (반응 − 쓴소리 + 5 × 0.919) ÷ (반응 + 5)         반응이 적으면 전체 평균 만족률 91.9% 쪽으로 당깁니다
--   만족 점수 = (보정 만족률 − 0.5) ÷ 0.5 를 0~1 로 자름            만족률 75%(옛 배지의 쓴소리 25% 경계)가 0.5
--   반응 = 방문 댓글 중 항목이 1개 이상 잡힌 수(comments_used), 쓴소리 = 대기 뺀 항목에서 부정이 있는 수(negatives)
--   0.919 = 11/23 전체 식당의 1 − Σ쓴소리 ÷ Σ반응
-- 대상: 방문 댓글 5개 이상이고 반응이 1건 이상인 식당. 나머지는 NULL(= "평가 부족", 0점이 아님)
-- 배지: 95점 이상 3 · 90~94 2 · 85~89 1. 관리자가 정한 level_override 가 있으면 그것이 우선합니다.
--
-- 조회수는 넣지 않습니다 (11/24 에 20% 넣었다가 되돌림).
--   조회수 가산점이 식당이 아니라 채널 크기를 따라갔습니다 — 20점 만점에 쯔양·또간집 평균 20.0,
--   회사랑 12.4. 한 영상에 식당이 여럿 나오면 모두 같은 조회수를 받아 식당끼리 구분도 안 됩니다.
--   조회수 "대비" 반응도 쓰지 않습니다 — 댓글을 영상당 400개까지만 모아 큰 영상일수록 비율이 낮게 나옵니다.
--
-- 옛 배지(guide_level, 반응 순위 기준)는 지우지 않고 남깁니다. 화면은 score_level 을 읽습니다.
-- 추가·갱신만 합니다 — 다시 실행해도 안전합니다. 적재 스크립트는 lesulin_refresh_scores() 만 부릅니다.
BEGIN;

ALTER TABLE store_stats ADD COLUMN IF NOT EXISTS score       smallint;   -- 0~100 · NULL = 평가 부족
ALTER TABLE store_stats ADD COLUMN IF NOT EXISTS score_level smallint;   -- 1~3 · NULL = 배지 없음

-- 조회수를 받던 4인자 함수는 지웁니다(같은 이름이 둘이면 어느 쪽이 불렸는지 헷갈립니다)
DROP FUNCTION IF EXISTS lesulin_score(int, int, int, bigint);

CREATE OR REPLACE FUNCTION lesulin_score(used int, neg int, visits int) RETURNS smallint
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN COALESCE(visits, 0) < 5 OR COALESCE(used, 0) < 1 THEN NULL ELSE
    round(100 * (
        0.6 * ln(1 + used) / ln(41)
      + 0.4 * greatest(0, least(1, ((used - COALESCE(neg, 0) + 5 * 0.919) / (used + 5.0) - 0.5) / 0.5))
    ))::smallint END
$$;

CREATE OR REPLACE FUNCTION lesulin_score_level(score smallint) RETURNS smallint
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN score >= 95 THEN 3 WHEN score >= 90 THEN 2 WHEN score >= 85 THEN 1 END::smallint
$$;

CREATE OR REPLACE FUNCTION lesulin_refresh_scores() RETURNS void
LANGUAGE sql AS $$
  UPDATE store_stats
     SET score       = lesulin_score(comments_used, negatives, visits),
         score_level = lesulin_score_level(lesulin_score(comments_used, negatives, visits));
$$;

SELECT lesulin_refresh_scores();

COMMIT;
