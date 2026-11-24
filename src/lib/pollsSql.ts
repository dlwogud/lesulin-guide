/* 커뮤니티 SQL — 목록·글 올리기·쓴 사람의 고치기·지우기.
 *
 * 다른 파일을 import 하지 않습니다. scripts/check-community-own.mjs 가 이 SQL 을 그대로 불러와
 * 롤백되는 트랜잭션에서 검사하기 때문입니다.
 *
 * 2026-11-24: 밤 12시 초기화를 없앴습니다. 글은 지우기 전까지 남고,
 *   · 최신순 = 전체에서 최근 40개
 *   · 인기순 = 최근 7일 글 중 반응 많은 순 (누적 점수로 옛 글이 1위에 붙어 있지 않게)
 * 위치는 "서울 성동구" 같은 시군구만 남기고 좌표(lat/lng)는 저장하지 않습니다.
 */
export const HOT_DAYS = 7;
export const FEED_LIMIT = 40;

/** $1 세션(내 글·내 투표 표시용, 없으면 ''). 세션 값 자체는 내보내지 않고 mine 만 내보냅니다. */
export function feedSql(sort: "hot" | "new"): string {
  const where = sort === "hot" ? `WHERE f.created_at > now() - interval '${HOT_DAYS} days'` : "";
  const order = sort === "hot" ? "heat DESC, id DESC" : "id DESC";
  return `
    SELECT f.*,
           COALESCE(mv.value, 0) AS my_vote,
           (f.session_me IS NOT NULL) AS mine
      FROM (SELECT pf.*, p.edited_at, CASE WHEN p.session = $1 THEN 1 END AS session_me
              FROM poll_feed pf JOIN polls p ON p.id = pf.id) f
      LEFT JOIN poll_votes mv ON mv.poll_id = f.id AND mv.session = $1
     ${where}
     ORDER BY ${order}
     LIMIT ${FEED_LIMIT}`;
}

/** 가장 큰 id — 화면이 "내가 본 뒤 새 글이 있나"를 이걸로 판단합니다. */
export const HEAD_SQL = `
  SELECT (SELECT max(id) FROM polls        WHERE NOT hidden) AS max_poll,
         (SELECT max(id) FROM poll_replies WHERE NOT hidden) AS max_reply`;

/** $1 kind · $2 내용 · $3 가게 · $4 시군구 · $5 닉네임 · $6 세션. 좌표 칸은 비워 둡니다. */
export const INSERT_POLL = `
  INSERT INTO polls (kind, body, store_id, place, nickname, session)
  VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`;

/* 쓴 사람 = 글을 올린 브라우저의 익명 세션(session)이 같은 것. 조건이 안 맞으면 0행이 바뀝니다. */
export const OWN_SQL = {
  /** $1 글 id · $2 세션 · $3 새 내용. 관리자가 가린 글은 못 고칩니다. */
  editPoll: `UPDATE polls SET body = $3, edited_at = now()
              WHERE id = $1 AND session = $2 AND NOT hidden
              RETURNING id`,
  /** $1 글 id · $2 세션. 답글·추천은 FK(ON DELETE CASCADE)로 함께 지워집니다. */
  deletePoll: `DELETE FROM polls WHERE id = $1 AND session = $2 RETURNING id`,
  /** $1 답글 id · $2 글 id · $3 세션 · $4 새 내용 */
  editReply: `UPDATE poll_replies SET body = $4, edited_at = now()
               WHERE id = $1 AND poll_id = $2 AND session = $3 AND NOT hidden
               RETURNING id`,
  /** $1 답글 id · $2 글 id · $3 세션 */
  deleteReply: `DELETE FROM poll_replies WHERE id = $1 AND poll_id = $2 AND session = $3 RETURNING id`,
} as const;
