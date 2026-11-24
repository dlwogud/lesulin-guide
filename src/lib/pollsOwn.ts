/* 커뮤니티 글·답글을 쓴 사람만 고치고 지우는 SQL.
 *
 * "쓴 사람" = 글을 올린 브라우저의 익명 세션(session)이 같은 것.
 * 세션 값은 응답에 내보내지 않고 mine(참/거짓)만 내보내므로, 남의 세션을 알아낼 수 없습니다.
 * 조건이 안 맞으면 0행이 바뀝니다 — API 는 "없는 글이거나 내 글이 아님"으로 답합니다.
 *
 * 다른 파일을 import 하지 않습니다. scripts/check-community-own.mjs 가 이 SQL 을 그대로 불러와
 * 롤백되는 트랜잭션에서 검사하기 때문입니다.
 */
const TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date";

export const OWN_SQL = {
  /** $1 글 id · $2 세션 · $3 새 내용. 오늘 글이고 가려지지 않은 것만. */
  editPoll: `UPDATE polls SET body = $3, edited_at = now()
              WHERE id = $1 AND session = $2 AND NOT hidden AND day = ${TODAY}
              RETURNING id`,
  /** $1 글 id · $2 세션. 답글·추천은 FK(ON DELETE CASCADE)로 함께 지워집니다. */
  deletePoll: `DELETE FROM polls WHERE id = $1 AND session = $2 RETURNING id`,
  /** $1 답글 id · $2 글 id · $3 세션 · $4 새 내용 */
  editReply: `UPDATE poll_replies SET body = $4, edited_at = now()
               WHERE id = $1 AND poll_id = $2 AND session = $3 AND NOT hidden AND day = ${TODAY}
               RETURNING id`,
  /** $1 답글 id · $2 글 id · $3 세션 */
  deleteReply: `DELETE FROM poll_replies WHERE id = $1 AND poll_id = $2 AND session = $3 RETURNING id`,
} as const;
