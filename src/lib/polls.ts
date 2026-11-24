import { q } from "./db";

/** 글이 너무 길거나 빈 것, 같은 사람이 연달아 쏟아내는 것을 막습니다. */
export function badBody(b: unknown, max = 300): string | null {
  if (typeof b !== "string") return "내용이 없습니다.";
  const t = b.trim();
  if (t.length < 1) return "내용을 입력해 주세요.";
  if (t.length > max) return `${max}자까지 쓸 수 있습니다.`;
  return null;
}

export function badSession(s: unknown): string | null {
  return typeof s === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(s)
    ? null : "세션이 올바르지 않습니다.";
}

/** 한 브라우저가 10분에 글 5개까지. 익명이라 이 정도는 걸어 둬야 합니다. */
export async function tooFast(session: string, table: "polls" | "poll_replies", limit = 5) {
  const [r] = await q<{ n: string }>(
    `SELECT count(*)::int AS n FROM ${table}
      WHERE session = $1 AND created_at > now() - interval '10 minutes'`, [session]);
  return Number(r.n) >= limit;
}

export type Sort = "hot" | "new";

/** 오늘(한국 시간) 올라온 것만 봅니다. 0시가 지나면 저절로 새 판입니다. */
export async function feed(sort: Sort, session: string | null, limit = 40) {
  const order = sort === "hot" ? "heat DESC, id DESC" : "id DESC";
  return q(`
    SELECT f.*,
           COALESCE(mv.value, 0) AS my_vote,
           (f.session_me IS NOT NULL) AS mine
      FROM (SELECT pf.*, p.edited_at, CASE WHEN p.session = $1 THEN 1 END AS session_me
              FROM poll_feed pf JOIN polls p ON p.id = pf.id) f
      LEFT JOIN poll_votes mv ON mv.poll_id = f.id AND mv.session = $1
     WHERE f.day = (now() AT TIME ZONE 'Asia/Seoul')::date
     ORDER BY ${order}
     LIMIT ${limit}`, [session ?? ""]);
}

export async function replies(pollIds: number[], session: string | null) {
  if (!pollIds.length) return [];
  return q(`
    SELECT r.id, r.poll_id, r.body, r.store_id, s.name AS store_name,
           r.nickname, r.created_at, r.edited_at,
           COALESCE(v.up, 0) AS ups,
           COALESCE(mv.value, 0) AS my_vote,
           (r.session = $2) AS mine
      FROM poll_replies r
      LEFT JOIN stores s ON s.id = r.store_id
      LEFT JOIN (SELECT reply_id, count(*) FILTER (WHERE value = 1) AS up
                   FROM reply_votes GROUP BY reply_id) v ON v.reply_id = r.id
      LEFT JOIN reply_votes mv ON mv.reply_id = r.id AND mv.session = $2
     WHERE r.poll_id = ANY($1::bigint[]) AND NOT r.hidden
     ORDER BY r.poll_id, r.id`, [pollIds, session ?? ""]);
}

/** 가장 큰 id — 화면이 "내가 본 뒤 새 글이 있나"를 이걸로 판단합니다. */
export async function head() {
  const [r] = await q<{ max_poll: string | null; max_reply: string | null }>(`
    SELECT (SELECT max(id) FROM polls
              WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND NOT hidden) AS max_poll,
           (SELECT max(id) FROM poll_replies
              WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND NOT hidden) AS max_reply`);
  return { poll: Number(r.max_poll ?? 0), reply: Number(r.max_reply ?? 0) };
}
