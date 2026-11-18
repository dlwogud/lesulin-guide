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

await scenario("2. 최대 3명까지만 선택", async page => {
  await openStart(page);
  const chips = page.locator("#chips [data-id]");
  for (let i = 0; i < 4; i++) await chips.nth(i).click();
  ok((await selected(page)).length === 3, "선택 수");
  ok((await page.textContent("#pickCnt")).includes("3"), "선택 수 표시");
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

await scenario("5a. API 실패 → 예시만 숨기고 지도로 갈 수 있음", async page => {
  await page.route("**/api/showcase", r => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await openStart(page);
  ok(await page.locator("#ex").isHidden(), "예시 카드가 보임");
  await page.click("#go");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
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

await browser.close();
if (fails.length) { console.log(`\n실패 ${fails.length}건`); process.exit(1); }
console.log("\nstart e2e OK");
