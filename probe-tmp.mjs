import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const pg = await ctx.newPage();
const errs = [];
pg.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
pg.on("pageerror", e => errs.push("pageerror: " + String(e).slice(0, 200)));
pg.on("requestfailed", r => errs.push("요청실패: " + r.url().slice(0, 90)));

await pg.goto("https://lesulin-guide.vercel.app/", { waitUntil: "networkidle", timeout: 60000 });
await pg.waitForTimeout(2500);

// 모달이 떠 있으면 닫습니다
if (await pg.locator("#favWrap:not([hidden])").count()) {
  await pg.locator("#favSkip").click();
  await pg.waitForTimeout(500);
}
console.log("식당 카드:", await pg.locator(".rcard").count());

// 첫 식당 열기
await pg.locator(".rcard").first().click();
await pg.waitForTimeout(1200);
console.log("상세 열림:", await pg.locator(".det").count() > 0);
console.log("  큰 썸네일 링크(.det-open):", await pg.locator(".det-open").count());
console.log("  영상 목록(.vid):", await pg.locator(".vid").count());

const vid = pg.locator(".vid").first();
if (await vid.count()) {
  console.log("  첫 영상 href:", (await vid.getAttribute("href")) ?? "없음");
  const box = await vid.boundingBox();
  console.log("  크기:", box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "보이지 않음");
  // 실제로 클릭했을 때 새 탭이 열리나
  const [popup] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 6000 }).catch(() => null),
    vid.click({ force: false }).catch(e => errs.push("클릭실패: " + String(e).slice(0, 120))),
  ]);
  console.log("  클릭 → 새 탭:", popup ? popup.url().slice(0, 60) : "안 열림 ✗");
}
console.log("\n오류:", errs.length ? "" : "없음");
for (const e of [...new Set(errs)].slice(0, 10)) console.log("  " + e);
await b.close();
