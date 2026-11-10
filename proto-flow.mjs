import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
p.on('pageerror', e => errs.push('JS: ' + e.message));
p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: ' + m.text()); });
const go = async () => { await p.goto('file:///Users/ijaehyeong/코테/.report-assets/proto.html'); await p.waitForTimeout(1200); };
const ok = async (n, f) => { try { await f(); console.log('  OK  ' + n); } catch(e){ console.log('  X   ' + n + ' → ' + e.message.split('\n')[0]); } };

await go();
console.log('프로토타입 조작 검증');
await ok('1. 클러스터 클릭 → 확대', async () => {
  const before = await p.locator('#map .pin').count();
  await p.locator('#map .pin').first().click();
  await p.waitForTimeout(700);
  const after = await p.locator('#map .pin').count();
  if (after <= before) throw new Error(`핀 ${before}→${after}, 풀리지 않음`);
});
await ok('2. 개별 핀 클릭 → 시트', async () => {
  await go();                                  // 전체 보기 상태에서 다시
  const pin = p.locator('#map g.pin[data-id]').first();
  await pin.scrollIntoViewIfNeeded().catch(()=>{});
  const box = await pin.boundingBox();
  if (!box) throw new Error('핀을 찾지 못함');
  await p.mouse.click(box.x + box.width/2, box.y + box.height/2);
  await p.waitForSelector('#sheet:not([hidden])', { timeout: 3000 });
  await p.waitForSelector('#sheet h2', { timeout: 2000 });
});
await p.screenshot({ path: 'shots/p-sheet.png' });
await ok('3. 예시 모드 → 점수·영상 등장', async () => {
  await p.getByRole('button', { name: /예시 모드/ }).click();
  await p.waitForTimeout(500);
  if (!(await p.locator('#sheet .bars').count())) throw new Error('항목 막대 없음');
  if (!(await p.locator('#sheet .vid').count())) throw new Error('영상 없음');
});
await p.screenshot({ path: 'shots/p-demo.png' });
await ok('4. 배지가 생긴 식당 존재', async () => {
  await p.getByRole('button', { name: '목록' }).click();
  await p.waitForTimeout(400);
  const n = await p.locator('#listUl .bdg.g').count();
  if (!n) throw new Error('배지 0곳');
  console.log('       배지 부여:', n, '곳');
});
await p.screenshot({ path: 'shots/p-list.png' });
await ok('5. 검색 자동완성', async () => {
  await p.getByRole('button', { name: '지도' }).click();
  await p.getByLabel('통합 검색').fill('부산');
  await p.waitForTimeout(500);
  await p.waitForSelector('#ac:not([hidden])', { timeout: 2000 });
});
await p.screenshot({ path: 'shots/p-search.png' });
await ok('6. 지역 선택 → 결과 축소', async () => {
  await p.locator('#ac button').first().click();
  await p.waitForTimeout(600);
  const t = await p.locator('#count').textContent();
  if (t.startsWith('30곳')) throw new Error('필터 미적용: ' + t);
  console.log('       결과:', t);
});
await ok('7. 초기화 복귀', async () => {
  await p.locator('#reset').click();
  await p.waitForTimeout(600);
  const t = await p.locator('#count').textContent();
  if (!t.startsWith('30곳')) throw new Error(t);
});
await ok('8. 줌 버튼', async () => {
  const s1 = await p.evaluate(() => document.querySelector('#map g').getAttribute('transform'));
  await p.locator('#zIn').click(); await p.waitForTimeout(300);
  const s2 = await p.evaluate(() => document.querySelector('#map g').getAttribute('transform'));
  if (s1 === s2) throw new Error('변화 없음');
});
await ok('9. 분석 방법 모달', async () => {
  await p.locator('#howto').click();
  await p.waitForSelector('#ov:not([hidden])', { timeout: 2000 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  if (!(await p.locator('#ov').isHidden())) throw new Error('Esc로 안 닫힘');
});
console.log(errs.length ? '\n오류:\n  ' + errs.slice(0,3).join('\n  ') : '\n콘솔 오류 없음');
await b.close();
