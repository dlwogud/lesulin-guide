import { chromium } from 'playwright';
const b = await chromium.launch();
const D = { width: 1240, height: 800 }, M = { width: 390, height: 780 };

const shots = [
  ['01-map',      D, async p => {}],
  ['02-search',   D, async p => { await p.getByLabel('통합 검색').fill('국밥'); await p.waitForTimeout(800); }],
  ['03-filter',   D, async p => { await p.getByRole('button',{name:/먹탐정/}).click(); await p.waitForTimeout(700); }],
  ['04-list',     D, async p => { await p.getByRole('button',{name:'목록'}).click(); await p.waitForTimeout(600); }],
  ['05-sheet',    D, async p => { await p.getByRole('button',{name:'목록'}).click(); await p.waitForTimeout(500);
                                  await p.locator('li button').first().click(); await p.waitForTimeout(700); }],
  ['06-detail',   D, async p => { await p.goto('http://localhost:3000/store/s7',{waitUntil:'networkidle'}); await p.waitForTimeout(500); }],
  ['07-method',   D, async p => { await p.goto('http://localhost:3000/methodology',{waitUntil:'networkidle'}); await p.waitForTimeout(400); }],
  ['m1-map',      M, async p => {}],
  ['m2-list',     M, async p => { await p.getByRole('button',{name:'목록'}).click(); await p.waitForTimeout(600); }],
  ['m3-sheet',    M, async p => { await p.getByRole('button',{name:'목록'}).click(); await p.waitForTimeout(500);
                                  await p.locator('li button').first().click(); await p.waitForTimeout(700); }],
];
for (const [name, vp, act] of shots) {
  const p = await b.newPage({ viewport: vp });
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await act(p);
  await p.screenshot({ path: `shots/${name}.png` });
  console.log('  ' + name);
  await p.close();
}
await b.close();
