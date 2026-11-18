/* 검수 화면이 댓글을 어떻게 뽑는지 확인합니다 — 읽기만 하고 검수 기록은 남기지 않습니다.
 *
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/check_review_queue.mjs [주소]
 *
 * 좋아요 순으로 뽑으면 "인기 댓글에서의 정확도"가 되어 전체 정확도가 아닙니다.
 * 고정된 무작위 순서여야 합니다 — 다시 불러도, 다른 사람이 해도 같은 순서.
 */
import assert from "node:assert/strict";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
});
assert.equal(login.status, 200, "로그인 실패");
const cookie = login.headers.get("set-cookie").split(";")[0];
const get = async only => (await (await fetch(`${BASE}/api/admin/review?only=${only}`, { headers: { cookie } })).json()).items;

for (const only of ["visit", "nonvisit"]) {
  const a = await get(only), b = await get(only);
  assert.equal(a.length, 20, `${only}: 20건이 아님`);
  assert.deepEqual(a.map(x => x.id), b.map(x => x.id), `${only}: 부를 때마다 순서가 다름`);
  assert.ok(a.every(x => x.pred_visit === (only === "visit")), `${only}: 다른 쪽 댓글이 섞임`);
  const likes = a.map(x => Number(x.likes));
  const byLikes = likes.every((v, i) => i === 0 || likes[i - 1] >= v);
  assert.ok(!byLikes, `${only}: 좋아요 순으로 뽑힘 (${likes.slice(0, 6).join(",")}…)`);
}
console.log("review queue OK");
