/* 파이썬 분류기와 TypeScript 이식본이 같은 판정을 내는지 확인합니다.
 *
 *   .venv/bin/python scripts/export_golden.py        # 기준 만들기
 *   node --experimental-strip-types scripts/check_parity.ts
 *
 * 한 건이라도 다르면 실패하고 다른 예를 보여 줍니다.
 * 사전을 고칠 때는 visit_lexicon.py 와 classify.ts 를 같이 고쳐야 통과합니다. */
import { readFileSync } from "node:fs";
import { analyze, visited, promo } from "../src/lib/classify.ts";

type Row = { t: string; v: boolean; a: Record<string, number>; p: boolean };
const rows: Row[] = JSON.parse(readFileSync(new URL("../data/golden.json", import.meta.url), "utf8"));

let bad = { visit: 0, aspect: 0, promo: 0 };
const samples: string[] = [];

for (const r of rows) {
  const v = visited(r.t);
  if (v !== r.v) {
    bad.visit++;
    if (samples.length < 6) samples.push(`방문  py=${r.v} ts=${v}  ${r.t.slice(0, 60)}`);
  }
  const a = analyze(r.t);
  const want = JSON.stringify(Object.keys(r.a).sort().map(k => [k, r.a[k]]));
  const got = JSON.stringify(Object.keys(a).sort().map(k => [k, (a as Record<string, number>)[k]]));
  if (want !== got) {
    bad.aspect++;
    if (samples.length < 6) samples.push(`항목  py=${want} ts=${got}  ${r.t.slice(0, 50)}`);
  }
  if (promo(r.t) !== r.p) {
    bad.promo++;
    if (samples.length < 6) samples.push(`홍보  py=${r.p} ts=${promo(r.t)}  ${r.t.slice(0, 50)}`);
  }
}

const total = bad.visit + bad.aspect + bad.promo;
console.log(`표본 ${rows.length.toLocaleString("ko-KR")}건`);
console.log(`  방문 판정 불일치 ${bad.visit}`);
console.log(`  항목·감성 불일치 ${bad.aspect}`);
console.log(`  홍보 판정 불일치 ${bad.promo}`);
if (total) {
  console.log("\n다른 예:");
  for (const s of samples) console.log("  " + s);
  console.log(`\n실패 — 파이썬과 ${total}건 다릅니다.`);
  process.exit(1);
}
console.log("\n통과 — 두 구현의 판정이 전부 같습니다.");
