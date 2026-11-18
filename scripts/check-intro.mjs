/* /api/intro 확인 — 시작 화면 v3 의 유튜버별 예시 식당.
 *
 *   node scripts/check-intro.mjs [기준 주소]     기본값: http://localhost:3000
 *
 * 대표 댓글은 "한 가게만 나오는 영상"에서 나온 것만 써야 합니다(여러 가게 영상 출처는
 * 39%가 다른 가게 얘기였습니다). 출처 영상 id(vid)를 지도 데이터(/api/seed)와 맞춰 봅니다.
 */
import assert from "node:assert/strict";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const res = await fetch(`${BASE}/api/intro`);
assert.equal(res.status, 200, `HTTP ${res.status}`);
assert.match(res.headers.get("cache-control") || "", /s-maxage=3600.*stale-while-revalidate=604800/, "CDN 캐시 헤더 (첫 방문자가 4~5초 기다리지 않게 길게)");
const d = await res.json();
const seed = await (await fetch(`${BASE}/api/seed`)).json();

assert.equal(d.creators.length, 10, "유튜버 수");
for (let i = 1; i < d.creators.length; i++) assert.ok(d.creators[i - 1].stores >= d.creators[i].stores, "식당 많은 순");
assert.equal(d.meta.stores, seed.meta.stores, "식당 수가 지도와 다름");
assert.equal(d.meta.videos, seed.meta.videos, "영상 수가 지도와 다름");
assert.equal(d.meta.comments, seed.meta.comments, "댓글 수가 지도와 다름");
/* 지도 화면 상단 '댓글'은 보이는 식당의 댓글 합입니다 — 숨긴 중복까지 더하면 두 번 셉니다 */
assert.equal(d.meta.comments, seed.stores.reduce((n, s) => n + s.cTotal, 0), "댓글 수가 지도 화면 상단 합과 다름(숨긴 가게 포함?)");

// 영상 → 그 영상에 연결된 (숨기지 않은) 식당 이름들, 영상 → 유튜버
const onVideo = new Map(), creatorOf = new Map();
for (const s of seed.stores) for (const v of s.vids) {
  if (!onVideo.has(v.id)) onVideo.set(v.id, new Set());
  onVideo.get(v.id).add(s.n); creatorOf.set(v.id, v.c);
}
const seedIds = new Set(seed.stores.map(s => s.id));
const ids = new Set(d.creators.map(c => c.id));
const per = new Map();
for (const p of d.places) {
  assert.ok(ids.has(p.creatorId), `${p.id}: 모르는 유튜버 ${p.creatorId}`);
  assert.ok(seedIds.has(p.id), `${p.id}: 지도에 없는(숨긴) 식당`);
  per.set(p.creatorId, (per.get(p.creatorId) || 0) + 1);
  assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng), `${p.id}: 좌표`);
  assert.ok(p.good && p.good.text, `${p.id}: 좋았다는 이야기 없음`);
  assert.ok(p.video && p.video.id && p.video.title, `${p.id}: 대표 영상 없음`);
  assert.equal(creatorOf.get(p.video.id), p.creatorId, `${p.id}: 대표 영상이 그 유튜버 영상이 아님`);
  for (const k of ["good", "bad"]) {
    const q = p[k]; if (!q || p.curated) continue;
    assert.ok(onVideo.has(q.vid), `${p.id}.${k}: 출처 영상 ${q.vid} 를 모름`);
    assert.equal(onVideo.get(q.vid).size, 1, `${p.id}.${k}: 여러 가게 영상 출처 (${[...onVideo.get(q.vid)].join(",")})`);
    assert.notEqual(creatorOf.get(q.vid), "c4", `${p.id}.${k}: 또간집 영상 출처`);
    assert.equal(typeof q.wait, "boolean", `${p.id}.${k}: wait`);
  }
}
for (const [c, n] of per) assert.ok(n <= 2, `${c}: ${n}곳 (최대 2)`);

/* 첫 화면에 나갈 댓글이라 더 엄격하게: 가게 이름을 직접 쓴 것, 좋았다엔 불만 단어 없음, 아쉬웠다엔 불만 단어 있음.
   (자동 분류만 믿으면 "완전 낭패"가 좋았다는 이야기로, 다른 가게 얘기가 대표로 나왔습니다) */
const flat = t => t.replace(/\s+/g, "");
const brand = n => flat(n.replace(/\(.*?\)/g, " ").trim().split(/\s+/)[0]);
const WISH = /저장(했|부터|해)|가보고 ?싶|가 ?보고 ?싶|가볼게|가봐야|가 ?볼래|기대(됩|되|돼)|가고 ?싶/;
const EXCLUDE = new Set(JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../data/intro_exclude.json", import.meta.url), "utf-8")).exclude.map(x => x.id));
const VISIT = /갔|가봤|가 봤|가서|다녀|먹었|먹어봤|먹어 봤|먹고 왔|방문|단골|사먹|포장해/;
const visitNear = (text, name) => {
  const t = flat(text), b = brand(name);
  for (let i = t.indexOf(b); i >= 0; i = t.indexOf(b, i + 1))
    if (VISIT.test(t.slice(Math.max(0, i - 30), i + b.length + 30))) return true;
  return false;
};
const branchOf = name => { const w = name.trim().split(/\s+/); return w.length > 1 && /점$/.test(w.at(-1)) ? w.at(-1).replace(/(직영점|본점|역점|점)$/, "") : null; };
const otherBranch = (text, name) => {
  const mine = branchOf(name); if (!mine) return false;
  const after = [...text.matchAll(new RegExp(brand(name) + "\\s*(\\S{1,8}?)(직영점|본점|역점|점)", "g"))].map(x => x[1]);
  const before = [...text.matchAll(new RegExp("(\\S{1,8}?)(직영점|본점|역점|점)\\s*" + brand(name), "g"))].map(x => x[1]);
  return [...after, ...before].some(b => b && !b.includes(mine) && !mine.includes(b));
};
const WISH_AFTER = /먹고싶|가보고싶|가고싶|가봐야|가볼게/;
const wishAfter = (text, name) => {
  const t = flat(text), b = brand(name);
  for (let i = t.indexOf(b); i >= 0; i = t.indexOf(b, i + 1))
    if (WISH_AFTER.test(t.slice(i, i + b.length + 25))) return true;
  return false;
};
const CITIES = ["서울","부산","대구","인천","광주","대전","울산","세종","제주","수원","성남","고양","용인","강릉","속초","춘천","원주","전주","군산","여수","순천","목포","경주","포항","창원","마산","통영","청주","천안","안산","평택","의정부","김포","파주","해운대","광안리","서면"];
const otherCity = (text, name, region) => {
  const t = text.split(brand(name)).join(" ");                 // 가게 이름 속 지명(서울곱창)은 빼고
  const said = CITIES.filter(c => t.includes(c));
  return said.length > 0 && !said.some(c => region.includes(c) || (c === "해운대" || c === "광안리" || c === "서면") && region.includes("부산"));
};
const GRIPE = /안감|안 감|싼마이|아쉬웠|아쉬웟|별루|최악|낭패|실망|별로|비추|노맛|그닥|글쎄|떨어진|아쉽|아쉬운|불친절|미지근|비싸|부실|짜다|짰|싱겁|적어|적다|느끼|비린|질기|잡내|기대이하|기대 이하|안 ?가|다시는/;
for (const p of d.places) {
  if (p.curated) continue;
  for (const k of ["good", "bad"]) {
    const q = p[k]; if (!q) continue;
    assert.ok(flat(q.text).includes(brand(p.name)), `${p.id} ${p.name}.${k}: 가게 이름이 없음 — ${q.text.slice(0, 40)}`);
  }
  assert.ok(!GRIPE.test(p.good.text), `${p.id} ${p.name}: 좋았다는 이야기에 불만 단어 — ${p.good.text.slice(0, 40)}`);
  for (const k of ["good", "bad"]) {
    const q = p[k]; if (!q) continue;
    assert.ok(!WISH.test(q.text), `${p.id} ${p.name}.${k}: 아직 안 가 본 댓글 — ${q.text.slice(0, 40)}`);
  }
  assert.ok(!EXCLUDE.has(p.id), `${p.id} ${p.name}: 제외 목록에 있는 식당`);
  for (const k of ["good", "bad"]) {
    const q = p[k]; if (!q) continue;
    assert.ok(visitNear(q.text, p.name), `${p.id} ${p.name}.${k}: 가게 이름 가까이에 다녀온 말이 없음 — ${q.text.slice(0, 40)}`);
    assert.ok(!otherBranch(q.text, p.name), `${p.id} ${p.name}.${k}: 다른 지점 얘기 — ${q.text.slice(0, 40)}`);
    assert.ok(!wishAfter(q.text, p.name), `${p.id} ${p.name}.${k}: 이름 뒤에 '먹고 싶/가고 싶' — ${q.text.slice(0, 40)}`);
    assert.ok(!otherCity(q.text, p.name, p.region), `${p.id} ${p.name}(${p.region}).${k}: 다른 도시 얘기 — ${q.text.slice(0, 40)}`);
  }
  if (p.bad) assert.ok(GRIPE.test(p.bad.text), `${p.id} ${p.name}: 아쉬웠다는 이야기에 불만 단어가 없음 — ${p.bad.text.slice(0, 40)}`);
}
const c1 = d.places.filter(p => p.creatorId === "c1");
assert.equal(c1[0]?.id, "s126", "성시경 첫 식당이 복춘식당이 아님");
assert.equal(c1[0]?.curated, true, "복춘식당이 curated 가 아님");
assert.ok(c1[0].good.text.includes("아구탕") && c1[0].bad.text.includes("재료소진"), "복춘식당 고정 댓글");

console.log(`intro OK — 식당 ${d.places.length}곳 · 유튜버별 ${[...per].map(([c, n]) => c + ":" + n).join(" ")}`);
