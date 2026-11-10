import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
p.on('pageerror', e => errs.push('JS: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

const step = async (name, fn) => {
  try { await fn(); console.log('  OK  ' + name); }
  catch (e) { console.log('  X   ' + name + ' → ' + e.message.split('\n')[0]); }
};

await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
console.log('사용자 흐름 검증');
await step('1. 메인 진입 · 30곳 표시', async () => {
  await p.waitForSelector('text=30곳', { timeout: 4000 });
});
await step('2. 유튜버 선택 → 결과 좁혀짐', async () => {
  await p.getByRole('button', { name: /먹탐정/ }).click();
  await p.waitForTimeout(600);
  const t = await p.locator('text=/^\\d+곳/').first().textContent();
  if (t.startsWith('30곳')) throw new Error('필터가 적용되지 않음');
});
await step('3. 지역 추가 → 복합 조건', async () => {
  await p.getByRole('button', { name: /서울 구로구/ }).click();
  await p.waitForTimeout(600);
});
await step('4. 목록 전환', async () => {
  await p.getByRole('button', { name: '목록' }).click();
  await p.waitForSelector('text=리뷰', { timeout: 3000 });
});
await step('5. 식당 선택 → 지도 + 시트', async () => {
  await p.locator('li button').first().click();
  await p.waitForSelector('text=상세 보기', { timeout: 3000 });
});
await step('6. 상세 페이지 이동', async () => {
  await p.getByRole('link', { name: '상세 보기' }).click();
  await p.waitForURL(/\/store\//, { timeout: 4000 });
  await p.waitForSelector('text=수집된 리뷰', { timeout: 3000 });
});
await p.screenshot({ path: 'shots/detail.png' });
await step('7. 길찾기 링크 존재', async () => {
  const href = await p.getByRole('link', { name: /네이버 지도로 길찾기/ }).getAttribute('href');
  if (!href?.startsWith('https://map.naver.com')) throw new Error('링크 오류');
});
await step('8. 방법론 페이지', async () => {
  await p.getByRole('link', { name: /분석 방법과 한계 보기/ }).click();
  await p.waitForSelector('text=최소 근거 조건', { timeout: 3000 });
});
await p.screenshot({ path: 'shots/methodology.png' });
await step('9. 초기화 복귀', async () => {
  await p.getByRole('link', { name: '← 탐색으로' }).click();
  await p.waitForSelector('text=30곳', { timeout: 4000 });
});
console.log(errs.length ? '\n콘솔 오류:\n  ' + errs.slice(0,4).join('\n  ') : '\n콘솔 오류 없음');
await b.close();
