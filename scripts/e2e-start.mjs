/* 시작 화면(/) → 지도 흐름을 실제 브라우저로 확인합니다.
 *
 *   node scripts/e2e-start.mjs [기준 주소]     기본값: http://localhost:3000
 *   ONLY="^1b|^7b" node scripts/e2e-start.mjs   이름이 맞는 시나리오만
 *
 * 하나라도 실패하면 exit 1. 화면 숫자는 /api/intro 를 직접 받아 비교합니다(테스트에도 숫자를 적지 않습니다).
 * 1·2번 칸은 4건 이상이면 저절로 흐르도록 카드를 한 번 더 붙입니다 — 그 복사본은 .dup 이라 셀 때 뺍니다.
 */
import { chromium } from "playwright";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const IN = await (await fetch(`${BASE}/api/intro`)).json();
const fails = [];
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const nf = n => Number(n).toLocaleString("ko-KR");

/* 화면과 같은 규칙: 고른 유튜버(없으면 c1 + 식당 많은 앞 2명)의 식당, 같은 식당은 한 번만 */
const DEFAULT = ["c1", ...IN.creators.map(c => c.id).filter(id => id !== "c1").slice(0, 2)];
const visible = ids => {
  const seen = new Set(), out = [];
  for (const p of IN.places) if (ids.includes(p.creatorId) && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
  return out;
};

const browser = await chromium.launch();

/* ONLY="^1b|^7b" 처럼 주면 이름이 맞는 시나리오만 돌립니다(전체는 10분 남짓) */
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
async function scenario(name, fn, { viewport = { width: 1440, height: 900 }, init, ctxOpts = {} } = {}) {
  if (ONLY && !ONLY.test(name)) return;
  const ctx = await browser.newContext({ viewport, ...ctxOpts });
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
  await page.waitForSelector("body[data-ready]", { timeout: 20000 });
};
const selected = page => page.$$eval('#chips [aria-pressed="true"]', els => els.map(e => e.dataset.id));
const shownStores = page => page.$$eval("#listVideos .vcard:not(.dup)", els => els.map(e => e.dataset.store));
/* 1·2번 칸은 저절로 흐릅니다. 사람처럼 칸 위에 마우스를 올려 멈춘 뒤 누릅니다 */
const clickIn = async (page, port, target) => { await page.hover(port); await page.click(target); };
const num = async (page, sel) => Number((await page.textContent(sel)).replace(/[^0-9]/g, ""));

console.log(`시작 화면 e2e — ${BASE}`);

await scenario("1. 데스크톱: 제목·숫자·세 칸·칩 (숫자는 API 값과 일치)", async page => {
  await openStart(page);
  ok((await page.textContent("#hero")).includes("다녀온 사람들은 뭐라고 했을까"), "핵심 문장");
  ok(await page.locator("#kmap").count() === 0, "지도 화면 요소가 섞임");
  ok((await page.textContent("#statStores")).includes(nf(IN.meta.stores)), "식당 수");
  ok((await page.textContent("#statVideos")).includes(nf(IN.meta.videos)), "영상 수");
  ok((await page.textContent("#statComments")).includes(nf(IN.meta.comments)), "댓글 수");
  const want = visible(DEFAULT);
  const got = await shownStores(page);
  ok(JSON.stringify(got) === JSON.stringify(want.map(p => p.id)), `영상 카드 ${got} ≠ ${want.map(p => p.id)}`);

  const revs = want.reduce((n, p) => n + (p.good ? 1 : 0) + (p.bad ? 1 : 0), 0);
  ok(await page.locator("#listReviews .rcard:not(.dup)").count() === revs, "댓글 카드 수");

  ok(await num(page, "#bigNum") === want.reduce((n, p) => n + p.used, 0), "큰 숫자");
  ok(await page.locator("#chips [data-id]").count() === IN.creators.length, "유튜버 칩 수");
  const rev = await page.textContent("#listReviews");
  ok(rev.includes("아구탕") && rev.includes("재료소진"), "복춘식당 고정 댓글");
  ok(/^https:\/\/www\.youtube\.com\/watch\?v=/.test(await page.getAttribute("#listVideos .vcard:not(.dup) a.vlink", "href")), "영상 링크");
});

await scenario("1b. 화면 구성(v4): 주황 테두리 표지 · 지도 버튼 화살표 · 구분선·옛 버튼 없음 · 고르기가 세 칸 위", async page => {
  await openStart(page);
  ok(await page.locator("#tagline").count() === 0, "헤더 한 줄 문구가 남음(제목과 같은 말이라 v4 에서 뺌)");
  ok((await page.textContent("#toMap")).trim() === "맛집 지도 열기 →", "지도 버튼 문구");
  ok((await page.$eval(".cover", e => getComputedStyle(e).boxShadow)).includes("251, 92, 1"), "표지 주황 테두리");
  ok(await page.$eval(".cover", e => getComputedStyle(e).backgroundColor) === "rgb(255, 255, 255)", "표지 흰 바탕");
  ok(await page.$eval("nav", e => getComputedStyle(e).borderBottomWidth) === "0px", "상단 구분선이 남음");
  ok(await page.locator(".ch").count() === 0, "칸 머리글이 남음");
  ok(await page.locator("#go").count() === 0, "'내 유튜버 맛집 지도 열기'가 남음");
  ok(!(await page.locator(".cover").textContent()).includes("방문 후기 ×"), "'유튜버 × 방문 후기 × 지도'가 남음");
  const [pk, st] = [await page.locator(".picker").boundingBox(), await page.locator("#stage").boundingBox()];
  ok(pk.y + pk.height <= st.y, "고르기가 세 칸 위에 있지 않음");
  ok(await page.$eval(".picker", e => getComputedStyle(e).backgroundColor) === "rgba(0, 0, 0, 0)", "고르기 배경이 남음");
});

await scenario("7b. 모바일에서도 제목·리본·지도 버튼이 보이고 넘침 없음", async page => {
  await openStart(page);
  ok(await page.locator("#hero").isVisible() && await page.locator(".ribbon").isVisible(), "모바일에서 제목·리본이 안 보임");
  ok(await page.locator("#toMap").isVisible(), "모바일에서 지도 버튼이 안 보임");
  ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, "가로 넘침");
}, { viewport: { width: 390, height: 844 } });

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

await scenario("2b. 유튜버를 고르면 세 칸이 그 유튜버 식당으로", async page => {
  await openStart(page);
  const c = IN.creators.find(x => x.id !== "c1" && IN.places.some(p => p.creatorId === x.id));
  await page.click(`#chips [data-id="${c.id}"]`);
  const want = visible([c.id]).map(p => p.id);
  const got = await shownStores(page);
  ok(JSON.stringify(got) === JSON.stringify(want), `${c.name}: ${got} ≠ ${want}`);

});

await scenario("2c. 고른 유튜버의 식당이 0곳이면 빈 상태 · 큰 숫자 0", async page => {
  await page.route("**/api/intro", async r => {
    const res = await r.fetch(); const d = await res.json();
    d.places = d.places.filter(p => p.creatorId !== "c4");
    await r.fulfill({ response: res, json: d });
  });
  await openStart(page);
  await page.click('#chips [data-id="c4"]');
  ok((await shownStores(page)).length === 0, "카드가 남음");
  ok(await num(page, "#bigNum") === 0, "큰 숫자");
  ok(await page.locator("#st1 .empty").isVisible(), "빈 상태가 안 보임");
});

await scenario("2s. 카드를 누르면 그 식당만 · 전체 보기로 되돌림", async page => {
  await openStart(page);
  const first = page.locator("#listVideos .vcard:not(.dup)").first();
  const sid = await first.getAttribute("data-store");
  await page.hover("#listVideos");
  await first.locator(".vm").click();
  ok(await first.getAttribute("aria-pressed") === "true", "선택 표시");
  const stores = await page.$$eval("#listReviews .rcard:not(.dup)", els => els.map(e => e.dataset.store));
  ok(stores.length > 0 && stores.every(s => s === sid), `댓글이 그 식당만이 아님 ${stores}`);
  await page.click("#rs");
  ok(await page.locator("#listReviews .rcard:not(.dup)").count() > 1, "전체 보기로 안 돌아옴");
  ok(await page.locator("#rs").isHidden(), "전체 보기 버튼이 남음");
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
  await page.click("#toMap");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("lesulin.fav")));
  ok(JSON.stringify([...saved].sort()) === JSON.stringify([...ids].sort()), `저장값 ${saved}`);
});

await scenario("4. 저장값 미리 선택 (없는 id 제외, 최대 3)", async page => {
  await openStart(page);
  const got = (await selected(page)).sort();
  ok(JSON.stringify(got) === JSON.stringify(["c1", "c2", "c4"]), `미리 선택 ${got}`);
}, { init: () => localStorage.setItem("lesulin.fav", JSON.stringify(["c1", "zz9", "c2", "c4", "c5"])) });

await scenario("3b. 고른 뒤 식당 이름 링크로 나가도 선택이 저장됨", async page => {
  await openStart(page);
  const chips = page.locator("#chips [data-id]");
  const ids = [await chips.nth(2).getAttribute("data-id"), await chips.nth(3).getAttribute("data-id")];
  await chips.nth(2).click(); await chips.nth(3).click();
  await clickIn(page, "#listVideos", "#listVideos .vcard:not(.dup) a.slink");
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

await scenario("5a. API 실패 → 세 칸 숨기고 지도로 · 저장해 둔 유튜버는 그대로", async page => {
  await page.route("**/api/intro", r => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await openStart(page);
  ok(await page.locator("#st1").isHidden(), "세 칸이 보임");
  ok(await page.locator("#chips").isHidden() && await page.locator("#pickCnt").isHidden(), "칩 없이 '즐겨찾기 0 / 3'이 보임");
  await page.click("#toMap");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
  const saved = await page.evaluate(() => localStorage.getItem("lesulin.fav"));
  ok(saved === JSON.stringify(SAVED), `저장값이 바뀜: ${saved}`);
}, { init: keepSaved });

await scenario("5c. 데이터가 오기 전에 버튼을 눌러도 저장해 둔 유튜버는 그대로", async page => {
  await page.route("**/api/intro", async r => { await new Promise(res => setTimeout(res, 4000)); await r.continue(); });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.click("#toMap");
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

await scenario("6. localStorage 차단(시크릿 창) → 그래도 동작", async (page, errors) => {
  await openStart(page);
  ok(await page.locator("#hero").isVisible(), "문장");
  ok(errors.length === 0, `시작 화면 오류: ${errors}`);
  await page.click("#toMap");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
  errors.length = 0;   // 지도 쪽은 이 테스트 범위 밖
}, { init: () => Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }) });

await scenario("7. 모바일 390: 가로 넘침 없음 · 지도 버튼 보임 · ①②③ 세로", async page => {
  await openStart(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, `가로 넘침 ${sw}px`);
  const go = await page.locator("#toMap").boundingBox();
  ok(go && go.y + go.height <= 844 && go.x + go.width <= 390, "상단 지도 버튼이 화면 밖");
  const xs = [];
  for (const id of ["#st1", "#st2", "#st3"]) xs.push(Math.round((await page.locator(id).boundingBox()).x));
  ok(Math.max(...xs) - Math.min(...xs) <= 2, `세로 배치 아님 x=${xs}`);
}, { viewport: { width: 390, height: 844 } });

/* ── 3번 칸 카카오맵 ── */
/* 가까운 핀은 묶음(.icluster, data-stores="a,b")으로 합쳐집니다 — 핀과 묶음 속 식당을 함께 셉니다 */
const pinsReady = page => page.waitForSelector("#introMap .ipin, #introMap .icluster", { timeout: 25000 });
const pinIds = page => page.$$eval("#introMap .ipin, #introMap .icluster",
  els => [...new Set(els.flatMap(e => (e.dataset.store || e.dataset.stores).split(",")))]);

await scenario("14. 지도 핀 수 = 3번 칸 개수 (보이는 식당과 같은 것)", async page => {
  await openStart(page);
  await pinsReady(page);
  const pins = (await pinIds(page)).sort();
  const cards = (await shownStores(page)).sort();
  ok(pins.length === (await shownStores(page)).length, `핀 ${pins.length}개`);
  ok(JSON.stringify(pins) === JSON.stringify(cards), `핀 ${pins} ≠ 카드 ${cards}`);
});

await scenario("15. 유튜버를 연달아 바꿔도 지난 핀이 남지 않음", async page => {
  await openStart(page);
  await pinsReady(page);
  const chips = page.locator("#chips [data-id]");
  for (const i of [3, 4, 5, 4]) await chips.nth(i).click();
  await page.waitForTimeout(800);
  const pins = (await pinIds(page)).sort(), cards = (await shownStores(page)).sort();
  ok(JSON.stringify(pins) === JSON.stringify(cards), `핀 ${pins} ≠ 카드 ${cards}`);
});

await scenario("14b. 가까운 핀은 묶음 · 누르면 확대돼 펼쳐짐", async page => {
  await openStart(page);
  await pinsReady(page);
  const cl = page.locator("#introMap .icluster").first();
  ok(await cl.count() === 1, "기본 보기에 묶음이 없음(서울 식당이 겹쳐야 정상)");
  const n = (await cl.getAttribute("data-stores")).split(",").length;
  ok(Number((await cl.textContent()).trim()) === n, "묶음 숫자 ≠ 묶인 식당 수");
  const members = (await cl.getAttribute("data-stores")).split(",");
  await cl.click();
  await page.waitForTimeout(1200);
  /* 확대되면 화면 밖 핀은 카카오가 문서에서 빼므로 전체 개수가 아니라 묶였던 식당이 나뉘었는지 봅니다 */
  const groups = await page.$$eval("#introMap .ipin, #introMap .icluster",
    (els, ids) => els.filter(e => (e.dataset.store || e.dataset.stores).split(",").some(x => ids.includes(x))).length, members);
  ok(groups > 1, `눌러도 안 펼쳐짐 (묶였던 ${members} 가 ${groups}덩어리)`);
});

await scenario("16. 카카오 지도를 못 불러오면 식당 이름 목록 · 나머지는 정상", async page => {
  await page.route("**/dapi.kakao.com/**", r => r.abort());
  await openStart(page);
  await page.waitForSelector("#introMapList a", { timeout: 20000 });
  ok(await page.locator("#introMapList a").count() === (await shownStores(page)).length, "목록 수");
  ok((await shownStores(page)).length > 0, "영상 카드가 없음");
  ok((await page.getAttribute("#introMapList a", "href")).startsWith("/map.html?store="), "목록 링크");
});

await scenario("17. 핀을 누르면 그 식당 카드 · '지도에서 보기'로 상세", async page => {
  await openStart(page);
  await pinsReady(page);
  /* 묶음만 있으면 눌러서 펼칩니다 — 눌릴 때마다 확대돼 결국 낱개 핀이 나와야 합니다 */
  for (let i = 0; i < 6 && !(await page.locator("#introMap .ipin").count()); i++) {
    await page.locator("#introMap .icluster").first().click();
    await page.waitForTimeout(900);
  }
  const pin = page.locator("#introMap .ipin").first();
  const sid = await pin.getAttribute("data-store");
  await pin.click();
  await page.waitForSelector("#place:not([hidden])", { timeout: 5000 });
  ok(await page.getAttribute("#place a.pri", "href") === `/map.html?store=${sid}`, "지도에서 보기 링크");
  ok((await page.getAttribute("#place a.route", "href")).startsWith("https://map.kakao.com/link/to/"), "길찾기 링크");
  const stores = await page.$$eval("#listReviews .rcard:not(.dup)", els => els.map(e => e.dataset.store));
  ok(stores.every(s => s === sid), "댓글이 그 식당으로 안 좁혀짐");
  const card = page.locator(`#listVideos .vcard[data-store="${sid}"]:not(.dup)`);
  ok(await card.getAttribute("aria-pressed") === "true", "1번 칸 카드가 선택 표시 안 됨");
  const [c, port] = [await card.boundingBox(), await page.locator("#listVideos").boundingBox()];
  ok(c.y >= port.y - 1 && c.y < port.y + port.height, "1번 칸에서 그 카드가 안 보임");
  await page.click("#place a.pri");
  await page.waitForSelector(".det .det-title", { timeout: 20000 });
});

await scenario("19. 흐르는 칸에서 눈에 보이는 카드는 어디를 눌러도 눌림(복사본 포함)", async page => {
  await openStart(page);
  for (const port of ["#listReviews", "#listVideos"]) {
    /* 고르기가 위로 올라가 세 칸이 첫 화면 아래까지 내려갑니다 — 칸이 화면에 다 보이게 한 뒤 잽니다 */
    await page.locator(port).evaluate(e => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    const r = await page.locator(port).boundingBox();
    for (const fy of [0.2, 0.5, 0.8]) {
      /* 카드 사이 12px 틈에 떨어질 수 있어 위아래로 조금씩 옮겨 가며 봅니다 */
      const hit = await page.evaluate(([x, y]) => {
        for (const d of [0, 8, -8, 16, -16]) {
          const el = document.elementFromPoint(x, y + d)?.closest(".vcard,.rcard");
          if (el) return { inert: el.inert || !!el.closest("[inert]") };
        }
        return null;
      }, [r.x + r.width / 2, r.y + r.height * fy]);
      ok(hit && !hit.inert, `${port} ${fy * 100}% 지점이 눌리지 않는 자리`);
    }
  }
  await page.locator("#listReviews").evaluate(e => e.scrollIntoView({ block: "center" }));
  const r = await page.locator("#listReviews").boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.waitForTimeout(300);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  ok(await page.locator("#rs").isVisible(), "보이는 댓글 카드를 눌러도 선택이 안 됨");
});

await scenario("20. 동작 줄이기 설정이면 카드를 두 번 보여 주지 않음", async page => {
  await openStart(page);
  const all = await page.locator("#listVideos .vcard").count(), orig = await page.locator("#listVideos .vcard:not(.dup)").count();
  ok(all === orig, `카드 ${all}개 중 원본 ${orig}개 — 복사본이 보임`);
}, { ctxOpts: { reducedMotion: "reduce" } });

await scenario("21. 지도 타일이 3번 칸을 꽉 채움", async page => {
  await openStart(page);
  await pinsReady(page);
  await page.waitForTimeout(2500);
  const r = await page.locator("#introMap").boundingBox();
  const span = await page.$$eval("#introMap img", (imgs, box) => {
    const rs = imgs.map(i => i.getBoundingClientRect()).filter(b => b.width > 100);   // 핀 얼굴 말고 지도 타일
    return { min: Math.min(...rs.map(b => b.left)), max: Math.max(...rs.map(b => b.right)) };
  }, r);
  ok(span.min <= r.x + 20 && span.max >= r.x + r.width - 20, `타일 ${Math.round(span.min)}~${Math.round(span.max)} / 칸 ${Math.round(r.x)}~${Math.round(r.x + r.width)}`);
  /* 위치만 보면 놓쳤던 문제: 칸 일부만 확대 배율 타일이고 나머지는 낮은 배율 타일이 흐릿하게 남음 */
  const levels = await page.$$eval("#introMap img", (imgs, box) => [...new Set(imgs
    .filter(i => /\/tile\//.test(i.src)).map(i => [i, i.getBoundingClientRect()])
    .filter(([, b]) => b.width > 100 && b.left < box.x + box.width && b.right > box.x)
    .map(([i]) => (i.src.match(/latest\/(\d+)\//) || [])[1]))], r);
  ok(levels.length === 1, `칸 안 타일 배율이 섞임: ${levels}`);
});

await scenario("22. 묶음 숫자가 원 가운데", async page => {
  await openStart(page);
  await pinsReady(page);
  const off = await page.$eval("#introMap .icluster", b => {
    const rg = document.createRange(); rg.selectNodeContents(b);
    const t = rg.getBoundingClientRect(), c = b.getBoundingClientRect();
    return Math.abs((t.left + t.right) / 2 - (c.left + c.right) / 2);
  });
  ok(off <= 2, `숫자가 가운데에서 ${off.toFixed(1)}px 벗어남`);
});

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

await scenario("12. 전체 흐름: 시작 → 2명 → 지도(내 유튜버 표시) → 시작(그 유튜버 식당) → 상세 → 길찾기", async page => {
  await openStart(page);
  const chips = page.locator("#chips [data-id]");
  await chips.nth(0).click(); await chips.nth(1).click();
  await page.click("#toMap");
  await page.waitForURL(/\/map\.html$/, { timeout: 15000 });
  await page.waitForSelector(".pinbox.mine, .kcluster.mine", { timeout: 25000 });
  await page.click(".brand");
  await page.waitForSelector("body[data-ready]", { timeout: 15000 });
  /* 돌아오면 고른 두 유튜버의 식당이 보입니다 — 그중 첫 식당을 엽니다 */
  const first = page.locator("#listVideos .vcard:not(.dup)").first();
  const name = (await first.locator("a.slink").textContent()).trim();
  await clickIn(page, "#listVideos", "#listVideos .vcard:not(.dup) a.slink");
  await page.waitForSelector(".det .det-title", { timeout: 20000 });
  ok((await page.textContent(".det .det-title")).includes(name), `상세 제목이 ${name} 이 아님`);
  ok((await page.getAttribute(".det a.pri", "href")).startsWith("https://map.kakao.com/link/to/"), "길찾기 링크");
});

await scenario("18. 지도 화면도 v3 색·글꼴·로고", async page => {
  await page.goto(`${BASE}/map.html`, { waitUntil: "domcontentloaded" });
  await mapReady(page);
  const st = await page.evaluate(() => {
    const r = getComputedStyle(document.documentElement), m = document.querySelector(".brand .mark");
    return { coral: r.getPropertyValue("--coral").trim().toUpperCase(), ink: r.getPropertyValue("--ink").trim().toUpperCase(),
             font: getComputedStyle(document.body).fontFamily,
             mark: m && m.complete && m.naturalWidth > 0 ? m.getAttribute("src") : null };
  });
  ok(st.coral === "#F2622A", `--coral ${st.coral}`);
  ok(st.ink === "#1F1B18", `--ink ${st.ink}`);
  ok(/Noto Sans KR/.test(st.font), `글꼴 ${st.font}`);
  ok(st.mark === "/img/brand/logo-64.png?v=3", `로고 ${st.mark}`);
});

await browser.close();
if (fails.length) { console.log(`\n실패 ${fails.length}건`); process.exit(1); }
console.log("\nstart e2e OK");
