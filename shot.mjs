import { chromium } from 'playwright';
const b = await chromium.launch();
const shots = [
  ['desktop-map',  1280, 860, async p => {}],
  ['desktop-list', 1280, 860, async p => { await p.getByRole('button',{name:'목록'}).click(); await p.waitForTimeout(500); }],
  ['desktop-search',1280,860, async p => { await p.getByLabel('통합 검색').fill('국밥'); await p.waitForTimeout(700); }],
  ['mobile-list',   390, 844, async p => { await p.getByRole('button',{name:'목록'}).click(); await p.waitForTimeout(500); }],
];
for (const [name, w, h, act] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await act(p);
  await p.screenshot({ path: `shots/${name}.png` });
  console.log(name.padEnd(16), errs.length ? '오류: '+errs.slice(0,2).join(' | ') : 'OK');
  await p.close();
}
await b.close();
