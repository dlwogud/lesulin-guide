import { q } from "@/lib/db";

/** 화면 위쪽 숫자(식당·영상·댓글 …). 지도(/api/seed)와 시작 화면(/api/intro)이 같은 값을 쓰도록 한 곳에 둡니다. */
export type SiteMeta = {
  stores: number; videos: number; comments: number; visit: number; used: number; rated: number; badged: number;
};

export async function siteMeta(): Promise<SiteMeta> {
  const [m] = await q<SiteMeta>(`
    SELECT (SELECT count(*) FROM stores WHERE NOT hidden)::int AS stores,
           (SELECT count(*) FROM videos)::int  AS videos,
           (SELECT COALESCE(sum(comments_all), 0) FROM store_stats)::int AS comments,
           (SELECT COALESCE(sum(visits), 0) FROM store_stats)::int       AS visit,
           (SELECT COALESCE(sum(comments_used), 0) FROM store_stats)::int AS used,
           (SELECT count(*) FROM store_stats st JOIN stores s ON s.id = st.store_id
             WHERE st.status = 'RATED' AND NOT s.hidden)::int AS rated,
           (SELECT count(*) FROM store_stats st JOIN stores s ON s.id = st.store_id
             WHERE st.guide_level IS NOT NULL AND NOT s.hidden)::int AS badged`);
  return m;
}
