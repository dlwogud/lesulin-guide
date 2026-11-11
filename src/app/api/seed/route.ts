import { NextResponse } from "next/server";
import { q, dbReady } from "@/lib/db";

/* 지도 화면이 처음 읽는 것.
   대표 인용문(quotes)은 여기 담지 않습니다 — 전체의 33%(355KB)를 차지하는데
   식당 하나를 열 때만 필요합니다. 상세는 /api/store/[storeId] 가 줍니다. */
export async function GET() {
  if (!(await dbReady())) {
    return NextResponse.json(
      { error: "DATABASE_URL이 설정되지 않았거나 DB에 연결할 수 없습니다." },
      { status: 503 });
  }
  const creators = await q(`
    SELECT c.id, c.name AS n, c.short_name AS h, c.color AS col,
           c.handle, c.subscribers::bigint AS subs
      FROM creators c
     WHERE EXISTS (SELECT 1 FROM videos v
                     JOIN store_videos sv ON sv.video_id = v.id
                    WHERE v.creator_id = c.id)
     ORDER BY c.subscribers DESC NULLS LAST`);

  const stores = await q(`
    SELECT s.id, s.name AS n, s.region AS r, s.address AS addr, s.category AS cat,
           s.lat, s.lng, s.coord_source AS src,
           COALESCE(st.comments_all, 0)  AS "cTotal",
           COALESCE(st.visits, 0)        AS "cVisit",
           COALESCE(st.comments_used, 0) AS "cUsed",
           COALESCE(st.negatives, 0)     AS "negN",
           COALESCE(st.waits, 0)         AS "waitN",
           COALESCE(st.aspects, '[]')    AS aspects,
           -- 운영자가 손으로 조정한 배지가 있으면 그걸 씁니다.
           -- 0 은 "배지 없음으로 고정"이라 NULL 로 바꿔 내보냅니다.
           NULLIF(COALESCE(st.level_override, st.guide_level), 0) AS lvl,
           COALESCE(st.status, 'NEW')    AS status,
           ARRAY(SELECT DISTINCT v.creator_id
                   FROM store_videos sv JOIN videos v ON v.id = sv.video_id
                  WHERE sv.store_id = s.id ORDER BY v.creator_id) AS cs,
           COALESCE((SELECT json_agg(x ORDER BY x.at DESC) FROM (
                SELECT v.id, v.title AS t, v.published_at AS at, v.creator_id AS c,
                       v.views AS vw, v.duration AS dur
                  FROM store_videos sv JOIN videos v ON v.id = sv.video_id
                 WHERE sv.store_id = s.id) x), '[]') AS vids
      FROM stores s LEFT JOIN store_stats st ON st.store_id = s.id
     WHERE NOT s.hidden                      -- 운영자가 가린 곳은 내보내지 않습니다
     ORDER BY COALESCE(st.comments_used, 0) DESC, COALESCE(st.visits, 0) DESC`);

  const [meta] = await q(`
    SELECT (SELECT count(*) FROM stores WHERE NOT hidden)::int AS stores,
           (SELECT count(*) FROM videos)::int  AS videos,
           (SELECT COALESCE(sum(comments_all), 0) FROM store_stats)::int AS comments,
           (SELECT COALESCE(sum(visits), 0) FROM store_stats)::int       AS visit,
           (SELECT COALESCE(sum(comments_used), 0) FROM store_stats)::int AS used,
           (SELECT count(*) FROM store_stats WHERE status = 'RATED')::int AS rated,
           (SELECT count(*) FROM store_stats WHERE guide_level IS NOT NULL)::int AS badged`);

  /* 이 데이터는 수집 파이프라인을 돌릴 때만 바뀝니다. 방문자마다 1,512곳을
     다시 질의할 이유가 없습니다 — 캐시가 없어서 모두가 3초를 기다렸습니다.
       s-maxage              10분은 CDN 이 그대로 내보냅니다
       stale-while-revalidate 그 뒤 1시간은 옛 응답을 바로 주고 뒤에서 갱신합니다
     데이터를 새로 적재하면 다시 배포되므로 캐시도 함께 비워집니다. */
  return NextResponse.json({ creators, stores, meta }, {
    headers: {
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
      "CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
