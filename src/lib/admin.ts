import { stratified } from "@/lib/accuracy";
import { q } from "./db";

export async function usage() {
  const daily = await q(`SELECT * FROM usage_daily ORDER BY day DESC LIMIT 14`);
  const [ret] = await q(`SELECT * FROM usage_returning`);
  const terms = await q(`
    SELECT q AS term, count(*)::int AS n
      FROM access_log WHERE event = 'search' AND q IS NOT NULL
     GROUP BY q ORDER BY n DESC, term LIMIT 12`);
  const clicked = await q(`
    SELECT a.store_id, s.name, s.region, count(*)::int AS n
      FROM access_log a JOIN stores s ON s.id = a.store_id
     WHERE a.event = 'store_open'
     GROUP BY a.store_id, s.name, s.region ORDER BY n DESC LIMIT 12`);
  const picks = await q(`
    SELECT c.short_name AS name, count(*)::int AS n
      FROM access_log a JOIN creators c ON c.id = a.creator_id
     WHERE a.event IN ('creator_pick', 'store_open')
     GROUP BY c.short_name ORDER BY n DESC LIMIT 12`);
  return { daily, ret, terms, clicked, picks };
}

/** 분류기 vs 사람 검수. 하드코딩하지 않고 그 자리에서 셉니다. */
/** 사람 검수 vs 분류기. 방문/비방문 쪽을 따로 뽑은 표본을 전체 크기로 보정합니다(src/lib/accuracy.ts). */
export async function accuracy() {
  const [v] = await q<Record<string, string>>(`
    WITH j AS (
      SELECT a.is_visit AS pred, r.is_visit AS gold
        FROM admin_reviews r JOIN comment_analysis a ON a.comment_id = r.comment_id
       WHERE r.is_visit IS NOT NULL AND NOT r.vague)
    SELECT count(*) FILTER (WHERE pred AND gold)::int         AS tp,
           count(*) FILTER (WHERE pred AND NOT gold)::int     AS fp,
           count(*) FILTER (WHERE NOT pred AND gold)::int     AS fn,
           count(*) FILTER (WHERE NOT pred AND NOT gold)::int AS tn,
           (SELECT count(*) FROM comment_analysis WHERE is_visit)::int     AS pop_v,
           (SELECT count(*) FROM comment_analysis WHERE NOT is_visit)::int AS pop_n
      FROM j`);
  return stratified({ tpV: +v.tp, fpV: +v.fp, fnN: +v.fn, tnN: +v.tn,
                      popVisit: +v.pop_v, popNon: +v.pop_n });
}
export async function pipeline() {
  return q(`SELECT id, step, model, started_at, finished_at, ok, quota_used, counts, message
              FROM pipeline_runs ORDER BY id DESC LIMIT 20`);
}

/** 검수할 댓글을 가져옵니다. 아직 아무도 안 본 것부터. */
export async function reviewQueue(adminId: number, limit = 20, only?: "visit" | "nonvisit") {
  const filter = only === "visit" ? "AND a.is_visit"
               : only === "nonvisit" ? "AND NOT a.is_visit" : "";
  return q(`
    SELECT c.id, c.body, c.published_at, c.likes,
           a.is_visit AS pred_visit,
           COALESCE((SELECT json_agg(json_build_object('a', aspect, 'p', polarity))
                       FROM comment_aspects x WHERE x.comment_id = c.id), '[]') AS pred_aspects,
           v.title AS video_title, cr.short_name AS creator,
           (SELECT s.name FROM store_videos sv JOIN stores s ON s.id = sv.store_id
             WHERE sv.video_id = c.video_id LIMIT 1) AS store_name
      FROM comments c
      JOIN comment_analysis a ON a.comment_id = c.id
      JOIN videos v  ON v.id = c.video_id
      JOIN creators cr ON cr.id = v.creator_id
     WHERE NOT c.is_owner ${filter}
       AND NOT EXISTS (SELECT 1 FROM admin_reviews r
                        WHERE r.comment_id = c.id AND r.reviewer_id = $1)
     -- 고정된 무작위 순서. 좋아요 순으로 뽑으면 "인기 댓글에서의 정확도"가 됩니다.
     -- 해시라서 다시 불러도, 다른 사람이 해도 같은 순서로 나옵니다.
     ORDER BY md5(c.id::text)
     LIMIT ${limit}`, [adminId]);
}

export async function reviewStats() {
  const [r] = await q<Record<string, string>>(`
    SELECT count(*)::int AS reviewed,
           count(*) FILTER (WHERE vague)::int AS vague,
           count(DISTINCT reviewer_id)::int AS reviewers
      FROM admin_reviews`);
  return { reviewed: +r.reviewed, vague: +r.vague, reviewers: +r.reviewers };
}
