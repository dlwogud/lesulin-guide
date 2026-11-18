/* /api/showcase 확인 — 시작 화면의 예시 식당 데이터가 DB에서 제대로 오는지.
 *
 *   node scripts/check-showcase.mjs [기준 주소]     기본값: http://localhost:3000
 */
import assert from "node:assert/strict";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const res = await fetch(`${BASE}/api/showcase`);
assert.equal(res.status, 200, `HTTP ${res.status}`);
assert.match(res.headers.get("cache-control") || "", /s-maxage=600/, "CDN 캐시 헤더");

const d = await res.json();

assert.equal(d.store.id, "s126");
assert.equal(d.store.name, "복춘식당");
assert.ok(d.store.visits > 0, "다녀왔다고 적은 댓글 수");
assert.ok(d.store.commentsAll >= d.store.visits, "전체 댓글 ≥ 방문 언급");
assert.ok(Number.isInteger(d.store.waits), "웨이팅 언급 수");

assert.equal(d.video.id, "ZZAqSGZjiPo");
assert.ok(d.video.views > 0, "조회수");
assert.equal(d.video.creatorName, "성시경의 먹을텐데");

assert.equal(d.good.id, 291815);
assert.ok(d.good.text.includes("아구탕"), "좋았다는 이야기 본문");
assert.equal(d.bad.id, 291672);
assert.ok(d.bad.text.includes("재료소진"), "아쉬웠다는 이야기 본문");

assert.equal(d.creators.length, 10);
assert.ok(d.creators.every(c => c.stores > 0), "유튜버마다 식당 수");
for (let i = 1; i < d.creators.length; i++) {
  assert.ok(d.creators[i - 1].stores >= d.creators[i].stores, "식당 많은 순");
}

assert.equal(d.meta.creators, 10);
assert.ok(d.meta.videos > 0 && d.meta.stores > 0, "meta");

console.log("showcase OK");
