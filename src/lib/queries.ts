import { q } from "./db";

export type CreatorRow = {
  id: string; name: string; handle: string | null; short_name: string;
  color: string; subscribers: string | null; stores: number;
};

export async function creators(): Promise<CreatorRow[]> {
  return q<CreatorRow>(`
    SELECT c.id, c.name, c.handle, c.short_name, c.color, c.subscribers,
           count(DISTINCT sv.store_id)::int AS stores
      FROM creators c
      LEFT JOIN videos v       ON v.creator_id = c.id
      LEFT JOIN store_videos sv ON sv.video_id = v.id
     GROUP BY c.id
     ORDER BY c.subscribers DESC NULLS LAST`);
}

/** 지도가 묻는 것: "이 화면 안의 식당". bbox는 stores_bbox 인덱스를 씁니다. */
export async function storesInBounds(b?: [number, number, number, number], limit = 3000) {
  const where = b ? `WHERE s.lat BETWEEN $1 AND $3 AND s.lng BETWEEN $2 AND $4` : "";
  return q(`
    SELECT s.id, s.name, s.region, s.address, s.category, s.lat, s.lng, s.coord_source,
           st.comments_all, st.comments_used, st.visits, st.negatives, st.waits,
           st.aspects, NULLIF(COALESCE(st.level_override, st.score_level), 0) AS guide_level, st.score, st.status,
           COALESCE(json_agg(DISTINCT jsonb_build_object(
             'id', v.id, 'title', v.title, 'at', v.published_at,
             'creator', v.creator_id, 'views', v.views, 'duration', v.duration
           )) FILTER (WHERE v.id IS NOT NULL), '[]') AS videos
      FROM stores s
      LEFT JOIN store_stats st   ON st.store_id = s.id
      LEFT JOIN store_videos sv  ON sv.store_id = s.id
      LEFT JOIN videos v         ON v.id = sv.video_id
      ${where}
     GROUP BY s.id, st.store_id
     ORDER BY st.comments_used DESC NULLS LAST, st.visits DESC NULLS LAST
     LIMIT ${limit}`, b ?? []);
}

export async function storeDetail(id: string) {
  const [s] = await q(`
    SELECT s.*, st.comments_all, st.comments_used, st.visits, st.negatives, st.waits,
           st.aspects, st.quotes, NULLIF(COALESCE(st.level_override, st.score_level), 0) AS guide_level, st.score, st.status
      FROM stores s LEFT JOIN store_stats st ON st.store_id = s.id
     WHERE s.id = $1`, [id]);
  if (!s) return null;
  const videos = await q(`
    SELECT v.id, v.title, v.published_at, v.views, v.duration, v.creator_id
      FROM store_videos sv JOIN videos v ON v.id = sv.video_id
     WHERE sv.store_id = $1 ORDER BY v.published_at DESC`, [id]);
  return { ...s, videos, ai: await storeAi(id).catch(() => null) };
}

/** AI(혼합 판정 + 근거 요약)를 적용한 식당만 값이 있습니다. 나머지는 null — 규칙 결과만 있다는 뜻입니다. */
export async function storeAi(id: string) {
  const [v] = await q<{ n: number; routed: number; rule_visit: number; final_visit: number; at: string | null; route_version: string | null; prompt_version: string | null }>(`
    SELECT count(*)::int AS n, count(*) FILTER (WHERE routed)::int AS routed,
           count(*) FILTER (WHERE rule_visit)::int AS rule_visit, count(*) FILTER (WHERE final_visit)::int AS final_visit,
           max(updated_at) AS at, max(route_version) AS route_version, max(prompt_version) AS prompt_version
      FROM ai_visit WHERE store_id = $1`, [id]);
  if (!v || !v.n) return null;
  const [s] = await q<{ status: string; lines: { kind: string; text: string; commentIds: number[] }[]; n_evidence: number; model: string | null;
                        prompt_version: string | null; created_at: string; reviewed_at: string | null }>(`
    SELECT status, lines, n_evidence, model, prompt_version, created_at, reviewed_at FROM ai_summaries WHERE store_id = $1`, [id]);
  const ids = [...new Set((s?.lines ?? []).flatMap((l) => l.commentIds))];
  const ev = ids.length ? await q<{ id: number; body: string; likes: number; published_at: string }>(`
    SELECT id::int, body, likes, to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS published_at
      FROM comments WHERE id = ANY($1)`, [ids]) : [];
  return { visit: v, summary: s ?? null, evidence: Object.fromEntries(ev.map((e) => [e.id, { x: e.body, like: e.likes, at: e.published_at }])) };
}

/** 관리자 화면 머리에 올리는 숫자. 하드코딩하지 않고 그 자리에서 셉니다. */
export async function adminSummary() {
  const [r] = await q<Record<string, string>>(`
    SELECT (SELECT count(*) FROM stores)            AS stores,
           (SELECT count(*) FROM videos)            AS videos,
           (SELECT count(*) FROM comments)          AS comments,
           (SELECT count(*) FROM comment_analysis
             WHERE is_visit)                        AS visits,
           (SELECT count(*) FROM comment_aspects)   AS aspects,
           (SELECT count(*) FROM store_stats
             WHERE status = 'RATED')                AS rated,
           (SELECT count(*) FROM store_stats
             WHERE COALESCE(level_override, score_level) > 0) AS badged,
           (SELECT count(*) FROM admin_reviews)     AS reviews,
           (SELECT count(*) FROM feedback
             WHERE NOT handled)                     AS feedback_open`);
  return r;
}
