import { q } from "@/lib/db";

/* 시작 화면에 보여줄 "실제 식당 한 곳".
 *
 * 무엇을 보여줄지는 사람이 원문을 읽고 여기서 고릅니다. 자동 분류가 고른
 * 대표 댓글은 쓰지 않습니다 — 나진국밥의 "아쉬운 점"이 실제로는 칭찬이었고,
 * 사장님 댓글이 대표로 뽑힌 식당도 있었습니다.
 *
 * 숫자(다녀왔다고 적은 댓글 수, 조회수, 좋아요 …)와 본문은 전부 DB에서 읽습니다.
 * 화면에 숫자를 직접 적지 않습니다. */
export const SHOWCASE = {
  store: "s126",          // 복춘식당 (전남 여수)
  video: "ZZAqSGZjiPo",   // 성시경의 먹을텐데 l 여수 복춘식당
  good: 291815,           // "현지인 맛집이라고 해서 갔다가 아구탕 먹고 깜짝 놀랐어요"
  bad: 291672,            // "전화했더니 재료소진으로 홀이랑 포장이 다 마감"
} as const;

export type Quote = { id: number; text: string; likes: number; at: string };

export type Showcase = {
  store: {
    id: string; name: string; region: string; category: string; lat: number; lng: number;
    visits: number; commentsAll: number; waits: number;
  } | null;
  video: {
    id: string; title: string; views: number; at: string; creatorId: string; creatorName: string;
  } | null;
  good: Quote | null;
  bad: Quote | null;
  creators: { id: string; name: string; stores: number }[];
  meta: { creators: number; videos: number; stores: number };
};

const ymd = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));

export async function loadShowcase(): Promise<Showcase> {
  const [stores, videos, comments, creators, meta] = await Promise.all([
    q<{ id: string; name: string; region: string; category: string; lat: number; lng: number;
        visits: number; comments_all: number; waits: number }>(
      `SELECT s.id, s.name, s.region, s.category, s.lat, s.lng,
              st.visits, st.comments_all, st.waits
         FROM stores s JOIN store_stats st ON st.store_id = s.id
        WHERE s.id = $1 AND NOT s.hidden`, [SHOWCASE.store]),
    q<{ id: string; title: string; views: number; published_at: Date; creator_id: string; name: string }>(
      `SELECT v.id, v.title, v.views, v.published_at, v.creator_id, c.name
         FROM videos v JOIN creators c ON c.id = v.creator_id
        WHERE v.id = $1`, [SHOWCASE.video]),
    q<{ id: number; body: string; likes: number; published_at: Date }>(
      `SELECT id, body, likes, published_at FROM comments WHERE id = ANY($1::bigint[])`,
      [[SHOWCASE.good, SHOWCASE.bad]]),
    q<{ id: string; name: string; stores: number }>(
      `SELECT c.id, c.name, count(DISTINCT s.id)::int AS stores
         FROM creators c
         JOIN videos v ON v.creator_id = c.id
         JOIN store_videos sv ON sv.video_id = v.id
         JOIN stores s ON s.id = sv.store_id AND NOT s.hidden
        GROUP BY c.id, c.name
        ORDER BY stores DESC, c.name`),
    q<{ creators: number; videos: number; stores: number }>(
      `SELECT (SELECT count(*) FROM creators)::int AS creators,
              (SELECT count(*) FROM videos)::int AS videos,
              (SELECT count(*) FROM stores WHERE NOT hidden)::int AS stores`),
  ]);

  const s = stores[0], v = videos[0];
  const quote = (id: number): Quote | null => {
    const c = comments.find(r => Number(r.id) === id);
    return c ? { id: Number(c.id), text: c.body, likes: Number(c.likes), at: ymd(c.published_at) } : null;
  };

  return {
    store: s ? {
      id: s.id, name: s.name, region: s.region, category: s.category,
      lat: Number(s.lat), lng: Number(s.lng),
      visits: Number(s.visits), commentsAll: Number(s.comments_all), waits: Number(s.waits),
    } : null,
    video: v ? {
      id: v.id, title: v.title, views: Number(v.views), at: ymd(v.published_at),
      creatorId: v.creator_id, creatorName: v.name,
    } : null,
    good: quote(SHOWCASE.good),
    bad: quote(SHOWCASE.bad),
    creators: creators.map(c => ({ id: c.id, name: c.name, stores: Number(c.stores) })),
    meta: meta[0],
  };
}
