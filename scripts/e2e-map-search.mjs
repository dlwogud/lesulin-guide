/* 지도 검색창: 시·도 이름만 넣어도 그 지역으로 가는지, Enter 가 먹는지 실제 브라우저로 확인합니다.
 *
 *   node scripts/e2e-map-search.mjs [기준 주소]     기본값: http://localhost:3000
 *
 * 하나라도 실패하면 exit 1. 식당 수는 /api/seed 를 직접 받아 비교합니다.
 * GET 이 아닌 /api 요청(투표·신고·방문 기록)은 전부 막아 실서비스 DB 에 쓰지 않습니다.
 */
import { chromium } from "playwright";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const SEED = await (await fetch(`${BASE}/api/seed`)).json();
const STORES = SEED.stores;
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const fails = [];

const browser = await chromium.launch();
async function scenario(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    navigator.sendBeacon = () => true;
    localStorage.setItem("lesulin.fav", "[]");          // 첫 방문 유튜버 고르기 창을 건너뜀
  });
  await ctx.route("**/api/**", r => r.request().method() === "GET" ? r.continue()
    : r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  try {
    await page.goto(`${BASE}/map.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof kmap !== "undefined" && kmap, null, { timeout: 20000 });
    await fn(page);
    ok(errors.length === 0, `pageerror: ${errors.join(" | ")}`);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails.push(name);
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
  await ctx.close();
}

const center = page => page.evaluate(() => { const c = kmap.getCenter(); return [c.getLat(), c.getLng()]; });
const inBusan = ([lat, lng]) => lat > 34.9 && lat < 35.45 && lng > 128.75 && lng < 129.35;
const typeEnter = async (page, text) => {
  await page.click("#q");
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
};

const STORES_N = STORES.length;
const busanN = STORES.filter(s => s.r.split(" ")[0] === "부산광역시").length;

await scenario("1 '부산' 입력하면 자동완성 맨 위 지역에 '부산 전체'가 뜬다", async page => {
  await page.click("#q");
  await page.keyboard.type("부산", { delay: 30 });
  await page.waitForTimeout(400);
  const first = (await page.locator("#ac .g").filter({ hasText: "지역" }).locator("button").first().textContent()).replace(/\s+/g, " ").trim();
  ok(first.includes("부산 전체") && first.includes(`${busanN}곳`), `첫 지역 항목이 '${first}' (기대: 부산 전체 ${busanN}곳)`);
});

await scenario("2 '부산' + Enter 면 부산 전체로 거르고 지도가 부산으로 간다", async page => {
  await typeEnter(page, "부산");
  ok(await page.locator("#ac").isHidden(), "Enter 뒤에도 자동완성이 열려 있음");
  ok((await page.textContent("#rchip")).trim() === "부산", `지역 표시가 '${await page.textContent("#rchip")}'`);
  const n = await page.evaluate(() => filtered().length);
  ok(n === busanN, `걸러진 식당 ${n}곳 (기대 ${busanN})`);
  const c = await center(page);
  ok(inBusan(c), `지도 중심이 부산이 아님: ${c}`);
});

await scenario("3 '부산 해운대' + Enter 면 해운대구로 간다", async page => {
  await typeEnter(page, "부산 해운대");
  ok((await page.textContent("#rchip")).trim() === "부산 해운대구", `지역 표시가 '${await page.textContent("#rchip")}'`);
  ok(inBusan(await center(page)), "지도 중심이 부산이 아님");
});

await scenario("4 지역이 아닌 말은 띄어 써도 모든 낱말이 들어간 식당만 남긴다", async page => {
  const hay = s => (s.n + " " + s.addr + " " + s.r + " " + s.cat).toLowerCase();
  const want = STORES.filter(s => hay(s).includes("해운대") && hay(s).includes("국밥")).length;
  ok(want > 0, "표본 없음: 해운대 국밥");
  await page.click("#q");
  await page.keyboard.type("해운대 국밥", { delay: 30 });
  await page.waitForTimeout(500);
  const n = await page.evaluate(() => filtered().length);
  ok(n >= want, `'해운대 국밥' 결과 ${n}곳 (최소 ${want})`);
});

await scenario("5 왼쪽 위 지역 메뉴는 없고, 검색창 안 지역 표시를 누르면 풀린다", async page => {
  ok(await page.locator("#regToggle").count() === 0, "지역 메뉴가 남아 있음");
  ok(await page.locator("#rchip").isHidden(), "지역을 안 골랐는데 표시가 보임");
  await typeEnter(page, "부산");
  await page.click("#rchip");
  await page.waitForTimeout(500);
  ok(await page.locator("#rchip").isHidden(), "누른 뒤에도 지역 표시가 남음");
  const n = await page.evaluate(() => filtered().length);
  ok(n === STORES_N, `풀린 뒤 식당 ${n}곳 (기대 ${STORES_N})`);
}, );

/* 투표 답글 창 높이 조절 — 오늘 글이 없어도 돌도록 투표 목록은 가짜로 줍니다 */
const FAKE_POLLS = { polls: [{ id: 1, body: "점검용 글", nickname: "익명", created_at: new Date().toISOString(),
  ups: 0, downs: 0, replies: 1, my_vote: 0, mine: false }],
  replies: [{ id: 11, poll_id: "1", body: "점검용 답글", nickname: "익명", created_at: new Date().toISOString(), ups: 0, my_vote: 0 }],
  head: { poll: 1, reply: 11 } };
await scenario("6 답글 창 위 손잡이를 끌면 높이가 늘고 줄며, 다시 열어도 유지된다", async page => {
  await page.route("**/api/polls?**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_POLLS) }));
  await page.click("#bell");
  await page.locator(".pitem").first().click();
  await page.waitForTimeout(300);
  const h = async () => (await page.locator("#pThread").boundingBox()).height;
  const g = await page.locator("#pThGrip").boundingBox();
  ok(g, "손잡이(#pThGrip)가 없음");
  const x = g.x + g.width / 2, y = g.y + g.height / 2, h0 = await h();
  const drag = async dy => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + dy / 2, { steps: 4 }); await page.mouse.move(x, y + dy, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150); };
  await drag(-200);
  const h1 = await h();
  ok(h1 > h0 + 150, `위로 끌어도 안 늘어남: ${h0} → ${h1}`);
  const g2 = await page.locator("#pThGrip").boundingBox();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + 4); await page.mouse.down();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + 4 + 120, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
  const h2 = await h();
  ok(h2 < h1 - 90, `아래로 끌어도 안 줄어듦: ${h1} → ${h2}`);
  /* 닫았다 다시 열어도 그 높이 */
  await page.click("#pThX"); await page.waitForTimeout(150);
  await page.locator(".pitem").first().click(); await page.waitForTimeout(300);
  ok(Math.abs(await h() - h2) < 3, `다시 열었더니 높이가 돌아감: ${h2} → ${await h()}`);
  /* 너무 크게 끌어도 투표 목록 머리가 가려지지 않게 상한 */
  const g3 = await page.locator("#pThGrip").boundingBox();
  await page.mouse.move(g3.x + g3.width / 2, g3.y + 4); await page.mouse.down();
  await page.mouse.move(g3.x + g3.width / 2, 5, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
  const hb = await page.locator(".pollwrap>header").boundingBox(), tb = await page.locator("#pThread").boundingBox();
  ok(tb.y >= hb.y + hb.height, `답글 창이 투표 머리를 덮음: ${tb.y} < ${hb.y + hb.height}`);
});

/* 7·8: 쓴 사람만 고치고 지운다 — 화면이 내 글에만 버튼을 보이고, 맞는 주소로 요청을 보내는지.
   요청은 위 scenario() 가 모두 가로채므로 운영 DB 에는 아무것도 가지 않습니다. */
const MINE = { polls: [
  { id: 1, body: "내가 쓴 글", nickname: "익명", created_at: new Date().toISOString(), edited_at: null,
    ups: 0, downs: 0, replies: 2, heat: 4, my_vote: 0, mine: true },
  { id: 2, body: "남이 쓴 글", nickname: "익명", created_at: new Date().toISOString(), edited_at: new Date().toISOString(),
    ups: 0, downs: 0, replies: 0, heat: 0, my_vote: 0, mine: false }],
  replies: [
    { id: 11, poll_id: "1", body: "내 답글", nickname: "익명", created_at: new Date().toISOString(), edited_at: null, ups: 0, my_vote: 0, mine: true },
    { id: 12, poll_id: "1", body: "남의 답글", nickname: "익명", created_at: new Date().toISOString(), edited_at: null, ups: 0, my_vote: 0, mine: false }],
  head: { poll: 2, reply: 12 } };
const sent = page => {
  const log = [];
  page.on("request", r => { if (r.method() !== "GET" && r.url().includes("/api/polls/"))
    log.push({ m: r.method(), path: new URL(r.url()).pathname, body: JSON.parse(r.postData() || "{}") }); });
  return log;
};
await scenario("7 내 글에만 수정·삭제가 있고, 고치는 중엔 새로고침이 덮어쓰지 않으며, 맞는 요청이 나간다", async page => {
  await page.route("**/api/polls?**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MINE) }));
  const log = sent(page);
  await page.click("#bell");
  await page.locator("#p2").waitFor({ timeout: 10000 });            // 가짜 목록이 그려질 때까지
  ok(await page.locator("#p1 .ownb").count() === 2, "내 글에 수정·삭제 버튼이 없음");
  ok(await page.locator("#p2 .ownb").count() === 0, "남의 글에 수정·삭제 버튼이 있음");
  ok((await page.locator("#p2 .ph").textContent()).includes("수정됨"), "고친 글에 '수정됨' 표시가 없음");
  await page.locator("#p1 .ownb", { hasText: "수정" }).click();
  ok(await page.locator("#pThread").isHidden(), "수정 버튼을 눌렀는데 답글 창이 열림");
  const ta = page.locator("#p1 textarea.pedt");
  ok(await ta.inputValue() === "내가 쓴 글", "수정 칸에 원래 글이 안 채워짐");
  await ta.fill("고친 글입니다");
  await page.evaluate(() => pullPolls(false)); await page.waitForTimeout(200);   // 8초 새로고침이 와도
  ok(await page.locator("#p1 textarea.pedt").inputValue() === "고친 글입니다", "새로고침이 고치던 내용을 지움");
  await page.locator("#p1 .pesave").click(); await page.waitForTimeout(300);
  const e = log.find(x => x.m === "PATCH");
  ok(e && e.path === "/api/polls/1" && e.body.body === "고친 글입니다" && e.body.session, `PATCH 요청이 이상함: ${JSON.stringify(e)}`);
  await page.locator("#p1 .ownb", { hasText: "삭제" }).click();
  ok(await page.locator("#p1 .pdel").isVisible(), "삭제 확인이 안 뜸");
  ok(!log.some(x => x.m === "DELETE"), "확인 전에 지워짐");
  await page.locator("#p1 .pdelgo").click(); await page.waitForTimeout(300);
  const d = log.find(x => x.m === "DELETE");
  ok(d && d.path === "/api/polls/1" && d.body.session, `DELETE 요청이 이상함: ${JSON.stringify(d)}`);
});
await scenario("8 답글도 내 것에만 수정·삭제가 있고, 맞는 주소로 요청이 나간다", async page => {
  await page.route("**/api/polls?**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MINE) }));
  const log = sent(page);
  await page.click("#bell");
  await page.locator("#p2").waitFor({ timeout: 10000 });
  await page.locator("#p1 .pt").click(); await page.waitForTimeout(300);
  const mine = page.locator("#pThList .bub.me"), other = page.locator("#pThList .bub:not(.me)");
  ok(await mine.locator(".ownb").count() === 2, "내 답글에 수정·삭제가 없음");
  ok(await other.locator(".ownb").count() === 0, "남의 답글에 수정·삭제가 있음");
  await mine.locator(".ownb", { hasText: "수정" }).click();
  const ta = page.locator("#pThList textarea.pedt");
  ok(await ta.inputValue() === "내 답글", "답글 수정 칸에 원래 답글이 안 채워짐");
  await ta.fill("고친 답글"); await ta.press("Enter"); await page.waitForTimeout(300);
  const e = log.find(x => x.m === "PATCH");
  ok(e && e.path === "/api/polls/1/reply/11" && e.body.body === "고친 답글", `답글 PATCH 이상: ${JSON.stringify(e)}`);
  await page.locator("#pThList .bub.me .ownb", { hasText: "삭제" }).click();
  await page.locator("#pThList .pdelgo").click(); await page.waitForTimeout(300);
  const d = log.find(x => x.m === "DELETE");
  ok(d && d.path === "/api/polls/1/reply/11", `답글 DELETE 이상: ${JSON.stringify(d)}`);
});

/* 9: 시작 화면에서 고른 유튜버(?yt=)를 지도에서 해제하면 목록·핀 강조·주소가 함께 지워진다 */
await scenario("9 '내 유튜버 해제'를 누르면 핀의 주황 테두리와 주소의 ?yt= 도 사라지고, 새로고침해도 돌아오지 않는다", async page => {
  await page.goto(`${BASE}/map.html?yt=c1`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof kmap !== "undefined" && kmap, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const mine = () => page.locator(".pinbox.mine, .kcluster.mine").count();
  ok(await mine() > 0, "?yt=c1 로 들어왔는데 강조된 핀이 없음 (점검 전제가 깨짐)");
  ok(await page.locator(".favchip").count() > 0, "목록에 '내 유튜버' 표시가 없음 (점검 전제가 깨짐)");
  await page.click("#favClear"); await page.waitForTimeout(500);
  ok(await page.locator(".favchip").count() === 0, "해제했는데 목록에 '내 유튜버'가 남음");
  ok(await mine() === 0, `해제했는데 주황 테두리 핀이 ${await mine()}개 남음`);
  ok(!new URL(page.url()).searchParams.has("yt"), `해제했는데 주소에 ?yt= 가 남음: ${page.url()}`);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => typeof kmap !== "undefined" && kmap, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  ok(await mine() === 0 && await page.locator(".favchip").count() === 0, "새로고침했더니 해제한 유튜버가 다시 강조됨");
});

/* 10: 밤 12시 초기화 없음 — 지난 글도 보이고, 인기글은 최근 7일만 */
await scenario("10 지난 글은 'N일 전'으로 보이고, 왼쪽 인기글에는 7일 넘은 글이 빠지며, '밤 12시' 안내가 없다", async page => {
  const day = d => new Date(Date.now() - d * 864e5).toISOString();
  const OLD = { polls: [
    { id: 21, body: "사흘 전 글", nickname: "익명", created_at: day(3), edited_at: null, ups: 1, downs: 0, replies: 0, heat: 1, my_vote: 0, mine: false },
    { id: 20, body: "여드레 전 인기 글", nickname: "익명", created_at: day(8), edited_at: null, ups: 50, downs: 0, replies: 9, heat: 68, my_vote: 0, mine: false }],
    replies: [], head: { poll: 21, reply: 0 } };
  await page.route("**/api/polls?**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OLD) }));
  await page.evaluate(() => pullPolls(false)); await page.waitForTimeout(300);
  const hot = await page.locator("#hotList").textContent();
  ok(hot.includes("사흘 전 글") && !hot.includes("여드레 전"), `왼쪽 인기글에 7일 넘은 글이 남음: ${hot}`);
  await page.click("#bell"); await page.locator("#p21").waitFor({ timeout: 10000 });
  ok((await page.locator("#p21 .ph").textContent()).includes("3일 전"), "사흘 전 글이 '3일 전'으로 안 보임");
  const head = await page.locator(".pollwrap>header").textContent();
  ok(!head.includes("12시"), `패널 머리에 '12시' 안내가 남음: ${head}`);
  ok((await page.locator("#tabHot").textContent()).includes("7일"), "인기 탭 이름에 7일이 없음");
});

await browser.close();
if (fails.length) { console.log(`\n실패 ${fails.length}건`); process.exit(1); }
console.log("\n모두 통과");
