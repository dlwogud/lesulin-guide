/* 시작 화면(/) → 지도 흐름을 실제 브라우저로 확인합니다.
 *
 *   node scripts/e2e-start.mjs [기준 주소]     기본값: http://localhost:3000
 *
 * 하나라도 실패하면 exit 1. 화면의 숫자는 /api/showcase 를 직접 받아 비교합니다
 * (테스트에도 숫자를 적지 않습니다).
 */
import { chromium } from "playwright";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const SC = await (await fetch(`${BASE}/api/showcase`)).json();
const fails = [];
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const browser = await chromium.launch();

async function scenario(name, fn, { viewport = { width: 1440, height: 900 }, init } = {}) {
  const ctx = await browser.newContext({ viewport });
  if (init) await ctx.addInitScript(init);
  /* 점검이 실서비스 방문 기록(/api/track)을 오염시키지 않게 서버로 보내지 않습니다.
     요청 자체는 그대로 일어나므로 13번처럼 요청을 확인하는 시나리오는 그대로 동작합니다. */
  /* 지도는 창을 닫을 때 sendBeacon 으로 기록을 보내는데, 이건 route 로 막히지 않습니다 */
  await ctx.addInitScript(() => { navigator.sendBeacon = () => true; });
  await ctx.route("**/api/track", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  try {
    await fn(page, errors);
    ok(errors.length === 0, `pageerror: ${errors.join(" | ")}`);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails.push(name);
    console.log(`  ✗ ${name} — ${String(e.message || e).split("\n")[0]}`);
  } finally {
    await ctx.close();
  }
}

/* start.js 가 데이터를 다 채우면(실패해도) body[data-ready] 를 붙입니다 */
const openStart = async page => {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body[data-ready]", { timeout: 15000 });
};
const selected = page => page.$$eval('#chips [aria-pressed="true"]', els => els.map(e => e.dataset.id));

console.log(`시작 화면 e2e — ${BASE}`);

await scenario("1. 데스크톱: 문장·예시·칩 (숫자는 API 값과 일치)", async page => {
  await openStart(page);
  ok((await page.textContent("#hero")).includes("다녀왔다고 적은 사람들"), "핵심 문장");
  ok(await page.locator("#kmap").count() === 0, "시작 화면에 지도가 있음");
  ok((await page.textContent("#exCount")).includes(SC.store.visits.toLocaleString("ko-KR")), "다녀왔다고 적은 댓글 수");
  ok((await page.textContent("#exGood")).includes(SC.good.text.slice(0, 10)), "좋았다는 이야기");
  ok((await page.textContent("#exBad")).includes(SC.bad.text.slice(0, 10)), "아쉬웠다는 이야기");
  /* 이 두 댓글을 고른 이유가 되는 구절이 잘리지 않아야 합니다 */
  ok((await page.textContent("#exGoodText")).includes("아구탕"), "좋았다는 이야기 핵심 구절");
  ok((await page.textContent("#exBadText")).includes("재료소진"), "아쉬웠다는 이야기 핵심 구절");
  ok((await page.getAttribute("#exMap", "href")).endsWith("/map.html?store=s126"), "지도에서 보기 링크");
  ok(await page.locator("#chips [data-id]").count() === SC.creators.length, "유튜버 칩 수");
});

await scenario("2. 4번째를 고르면 가장 먼저 고른 사람이 빠짐 · 다시 누르면 해제", async page => {
  await openStart(page);
  const chips = page.locator("#chips [data-id]");
  const id = async i => chips.nth(i).getAttribute("data-id");
  for (let i = 0; i < 4; i++) await chips.nth(i).click();
  const got = (await selected(page)).sort();
  const want = [await id(1), await id(2), await id(3)].sort();
  ok(JSON.stringify(got) === JSON.stringify(want), `선택 ${got} (기대 ${want})`);
  ok((await page.textContent("#pickCnt")).includes("3"), "선택 수 표시");
  await chips.nth(2).click();                                   // 고른 걸 다시 누르면 해제
  ok(!(await selected(page)).includes(await id(2)), "다시 눌러도 해제 안 됨");
  ok((await selected(page)).length === 2, "해제 후 2명");
});

await scenario("2m. 지도의 고르기 창도 같은 방식", async page => {
  await page.goto(`${BASE}/map.html?pick=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#favWrap:not([hidden]) .favcard", { timeout: 20000 });
  const cards = page.locator("#favGrid .favcard");
  const ids = [];
  for (let i = 0; i < 4; i++) {
    ids.push(await cards.nth(i).locator("b").textContent());
    await cards.nth(i).click();
  }
  const on = await page.$$eval('#favGrid .favcard[aria-pressed="true"] b', els => els.map(e => e.textContent));
  ok(JSON.stringify(on.sort()) === JSON.stringify(ids.slice(1).sort()), `선택 ${on}`);
  await page.locator("#favGrid .favcard", { hasText: ids[3] }).click();
  const after = await page.$$eval('#favGrid .favcard[aria-pressed="true"] b', els => els.map(e => e.textContent));
  ok(after.length === 2 && !after.includes(ids[3]), `해제 후 ${after}`);
});

await scenario("3. 고르고 지도로 → 저장됨", async page => {
  await openStart(page);
  const chips = page.locator("#chips [data-id]");
  const ids = [await chips.nth(0).getAttribute("data-id"), await chips.nth(1).getAttribute("data-id")];
  await chips.nth(0).click(); await chips.nth(1).click();
  await page.click("#go");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("lesulin.fav")));
  ok(JSON.stringify([...saved].sort()) === JSON.stringify([...ids].sort()), `저장값 ${saved}`);
});

await scenario("4. 저장값 미리 선택 (없는 id 제외, 최대 3)", async page => {
  await openStart(page);
  const got = (await selected(page)).sort();
  ok(JSON.stringify(got) === JSON.stringify(["c1", "c2", "c4"]), `미리 선택 ${got}`);
}, { init: () => localStorage.setItem("lesulin.fav", JSON.stringify(["c1", "zz9", "c2", "c4", "c5"])) });

await scenario("3b. 고른 뒤 예시의 '지도에서 보기'로 나가도 선택이 저장됨", async page => {
  await openStart(page);
  const chips = page.locator("#chips [data-id]");
  const ids = [await chips.nth(2).getAttribute("data-id"), await chips.nth(3).getAttribute("data-id")];
  await chips.nth(2).click(); await chips.nth(3).click();
  await page.click("#exMap");
  await page.waitForURL(/\/map\.html\?store=/, { timeout: 15000 });
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("lesulin.fav")));
  ok(JSON.stringify([...saved].sort()) === JSON.stringify([...ids].sort()), `저장값 ${saved}`);
});

const SAVED = ["c1", "c2"];
const keepSaved = () => {
  /* 처음 한 번만 심습니다 — 지도 페이지로 넘어간 뒤 다시 덮어쓰면 검사가 무의미합니다 */
  if (!sessionStorage.getItem("seeded")) {
    localStorage.setItem("lesulin.fav", JSON.stringify(["c1", "c2"]));
    sessionStorage.setItem("seeded", "1");
  }
};

await scenario("5a. API 실패 → 예시만 숨기고 지도로 · 저장해 둔 유튜버는 그대로", async page => {
  await page.route("**/api/showcase", r => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await openStart(page);
  ok(await page.locator("#ex").isHidden(), "예시 카드가 보임");
  await page.click("#go");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
  const saved = await page.evaluate(() => localStorage.getItem("lesulin.fav"));
  ok(saved === JSON.stringify(SAVED), `저장값이 바뀜: ${saved}`);
}, { init: keepSaved });

await scenario("5c. 데이터가 오기 전에 버튼을 눌러도 저장해 둔 유튜버는 그대로", async page => {
  await page.route("**/api/showcase", async r => { await new Promise(res => setTimeout(res, 4000)); await r.continue(); });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.click("#go");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
  const saved = await page.evaluate(() => localStorage.getItem("lesulin.fav"));
  ok(saved === JSON.stringify(SAVED), `저장값이 바뀜: ${saved}`);
}, { init: keepSaved });

await scenario("13. 시작 화면도 방문 기록(view, path=/)을 남김", async page => {
  const req = page.waitForRequest(r => r.url().endsWith("/api/track") && r.method() === "POST"
    && /"event":"view"/.test(r.postData() || "") && /"path":"\/"/.test(r.postData() || ""), { timeout: 15000 });
  await openStart(page);
  const body = JSON.parse((await req).postData());
  const hit = body.hits.find(h => h.event === "view");
  ok(/^[A-Za-z0-9_-]{8,64}$/.test(hit.visitor) && /^[A-Za-z0-9_-]{8,64}$/.test(hit.session), "id 형식");
});

await scenario("5b. 고정 댓글 하나가 없으면 그 블록만 숨김", async page => {
  await page.route("**/api/showcase", async r => {
    const res = await r.fetch(); const d = await res.json(); d.good = null;
    await r.fulfill({ response: res, json: d });
  });
  await openStart(page);
  ok(await page.locator("#exGood").isHidden(), "좋았다는 이야기가 보임");
  ok(await page.locator("#exBad").isVisible(), "아쉬웠다는 이야기가 숨음");
  ok(await page.locator("#ex").isVisible(), "예시 전체가 숨음");
});

await scenario("6. localStorage 차단(시크릿 창) → 그래도 동작", async (page, errors) => {
  await openStart(page);
  ok(await page.locator("#hero").isVisible(), "문장");
  ok(errors.length === 0, `시작 화면 오류: ${errors}`);
  await page.click("#go");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
  errors.length = 0;   // 지도 쪽은 이 테스트 범위 밖
}, { init: () => Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }) });

await scenario("7. 모바일 390: 가로 넘침 없음 · 버튼 보임 · ①②③ 세로", async page => {
  await openStart(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, `가로 넘침 ${sw}px`);
  const go = await page.locator("#go").boundingBox();
  ok(go && go.y + go.height <= 844, "버튼이 화면 밖");
  const xs = [];
  for (const id of ["#st1", "#st2", "#st3"]) xs.push(Math.round((await page.locator(id).boundingBox()).x));
  ok(Math.max(...xs) - Math.min(...xs) <= 2, `세로 배치 아님 x=${xs}`);
}, { viewport: { width: 390, height: 844 } });

/* ── 지도와 연결 ── */
const mapReady = page => page.waitForSelector(".rcard", { timeout: 20000 });

await scenario("8. /map.html?store=s126 → 복춘식당 상세가 바로 열림", async page => {
  await page.goto(`${BASE}/map.html?store=s126`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".det .det-title", { timeout: 20000 });
  ok((await page.textContent(".det .det-title")).includes("복춘식당"), "상세 제목");
  ok(await page.locator("#favWrap").isHidden(), "유튜버 창이 뜸");
  /* 지도가 그 식당으로 옮겨 가 선택된 핀이 화면 안에 그려져야 합니다 */
  await page.waitForSelector(".pinbox.sel", { state: "visible", timeout: 20000 });
});

await scenario("9. 지도에서 유튜버 창이 자동으로 안 뜸 · ?pick=1 은 뜸", async page => {
  await page.goto(`${BASE}/map.html`, { waitUntil: "domcontentloaded" });
  await mapReady(page);
  ok(await page.locator("#favWrap").isHidden(), "자동으로 뜸");
  await page.goto(`${BASE}/map.html?pick=1`, { waitUntil: "domcontentloaded" });
  await mapReady(page);
  ok(await page.locator("#favWrap").isVisible(), "?pick=1 인데 안 뜸");
});

await scenario("10. /map.html?store=없는id → 평소처럼 뜸", async page => {
  await page.goto(`${BASE}/map.html?store=nope`, { waitUntil: "domcontentloaded" });
  await mapReady(page);
  ok(await page.locator(".rcard").count() > 0, "목록 없음");
});

await scenario("11. 지도 로고 → 시작 화면", async page => {
  await page.goto(`${BASE}/map.html`, { waitUntil: "domcontentloaded" });
  await mapReady(page);
  await page.click(".brand");
  await page.waitForURL(u => new URL(u).pathname === "/", { timeout: 15000 });
});

await scenario("12. 전체 흐름: 시작 → 2명 → 지도(내 유튜버 표시) → 시작 → 예시 상세 → 길찾기", async page => {
  await openStart(page);
  const chips = page.locator("#chips [data-id]");
  await chips.nth(0).click(); await chips.nth(1).click();
  await page.click("#go");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
  await page.waitForSelector(".pinbox.mine, .kcluster.mine", { timeout: 25000 });
  await page.click(".brand");
  await page.waitForSelector("body[data-ready]", { timeout: 15000 });
  await page.click("#exMap");
  await page.waitForSelector(".det .det-title", { timeout: 20000 });
  ok((await page.textContent(".det .det-title")).includes("복춘식당"), "상세 제목");
  ok((await page.getAttribute(".det a.pri", "href")).startsWith("https://map.kakao.com/link/to/"), "길찾기 링크");
});

await browser.close();
if (fails.length) { console.log(`\n실패 ${fails.length}건`); process.exit(1); }
console.log("\nstart e2e OK");
