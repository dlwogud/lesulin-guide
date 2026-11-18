/* 배포된 화면을 실제 브라우저로 열어 확인합니다.
 *
 *   node scripts/probe.mjs [주소]        기본값: 배포 주소
 *
 * 코드만 읽고 추측하면 틀립니다. 실제로 이것 때문에 한참 헤맸습니다 —
 * "영상이 안 눌린다"의 원인이 썸네일 링크가 아니라 상세 패널 전체가
 * 예외로 안 그려지던 것이었고, 이 스크립트를 돌리자 한 줄로 나왔습니다. */
import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
// 점검이 실서비스 방문 기록을 오염시키지 않게 /api/track 은 보내지 않습니다
/* 지도는 창을 닫을 때 sendBeacon 으로 기록을 보내는데, 이건 route 로 막히지 않습니다 */
await ctx.addInitScript(() => { navigator.sendBeacon = () => true; });
await ctx.route("**/api/track", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
const pg = await ctx.newPage();
const errs = [];
pg.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
pg.on("pageerror", e => errs.push("pageerror: " + String(e).slice(0, 200)));
pg.on("requestfailed", r => errs.push("요청실패: " + r.url().slice(0, 90)));

const URL = process.argv[2] || "https://lesulin-guide.vercel.app/map.html";   // / 는 이제 시작 화면입니다
await pg.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
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
