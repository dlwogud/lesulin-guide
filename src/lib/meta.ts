import { q } from "@/lib/db";

/** 화면 위쪽 숫자(식당·영상·댓글 …). 지도(/api/seed)와 시작 화면(/api/intro)이 같은 값을 쓰도록 한 곳에 둡니다.
 *  숨긴 가게(중복 합침 등)는 뺍니다 — 같은 영상 댓글이라 더하면 두 번 셉니다. */
export type SiteMeta = {
  stores: number; videos: number; comments: number; visit: number; used: number; rated: number; badged: number;
};

export async function siteMeta(): Promise<SiteMeta> {
  const [m] = await q<SiteMeta>(`
    SELECT (SELECT count(*) FROM stores WHERE NOT hidden)::int AS stores,
           (SELECT count(*) FROM videos)::int  AS videos,
           (SELECT COALESCE(sum(st.comments_all), 0) FROM store_stats st JOIN stores s ON s.id = st.store_id WHERE NOT s.hidden)::int AS comments,
           (SELECT COALESCE(sum(st.visits), 0) FROM store_stats st JOIN stores s ON s.id = st.store_id WHERE NOT s.hidden)::int AS visit,
           (SELECT COALESCE(sum(st.comments_used), 0) FROM store_stats st JOIN stores s ON s.id = st.store_id WHERE NOT s.hidden)::int AS used,
           (SELECT count(*) FROM store_stats st JOIN stores s ON s.id = st.store_id
             WHERE st.status = 'RATED' AND NOT s.hidden)::int AS rated,
           (SELECT count(*) FROM store_stats st JOIN stores s ON s.id = st.store_id
             WHERE st.guide_level IS NOT NULL AND NOT s.hidden)::int AS badged`);
  return m;
}
