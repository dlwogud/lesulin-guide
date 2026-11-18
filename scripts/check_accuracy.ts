/* 검수 정확도 계산 테스트 — DB 없이 계산만 봅니다.
 *
 *   node --experimental-strip-types scripts/check_accuracy.ts
 *
 * 검수는 "다녀왔다로 분류된 댓글"과 "아닌 댓글"을 따로 뽑아 봅니다(층화).
 * 그대로 합쳐 세면 재현율이 부풀려집니다 — 실제로는 아닌 댓글이 95% 이상이라
 * 거기서 놓친 비율을 전체 크기만큼 키워서 세야 합니다.
 */
import assert from "node:assert/strict";
import { stratified } from "../src/lib/accuracy.ts";

const near = (a: number | null, b: number, msg: string) =>
  assert.ok(a !== null && Math.abs(a - b) < 1e-3, `${msg}: ${a} ≠ ${b}`);

// 1) 아무것도 검수하지 않았으면 전부 비어 있어야 합니다
{
  const r = stratified({ tpV: 0, fpV: 0, fnN: 0, tnN: 0, popVisit: 12445, popNon: 261322 });
  assert.equal(r.n, 0);
  assert.equal(r.precision, null); assert.equal(r.recall, null); assert.equal(r.f1, null);
}

// 2) "다녀왔다" 쪽만 검수 → 정밀도는 나오고 재현율은 아직 못 냅니다
{
  const r = stratified({ tpV: 8, fpV: 2, fnN: 0, tnN: 0, popVisit: 12445, popNon: 261322 });
  near(r.precision, 0.8, "정밀도");
  assert.equal(r.recall, null, "아닌 쪽을 안 봤는데 재현율이 나옴");
  assert.equal(r.reviewedVisit, 10); assert.equal(r.reviewedNon, 0);
}

// 3) 양쪽 100건씩 — 재현율은 전체 크기로 보정합니다 (합쳐 세면 80/82 = 97.6%)
{
  const r = stratified({ tpV: 80, fpV: 20, fnN: 2, tnN: 98, popVisit: 12445, popNon: 261322 });
  near(r.precision, 0.8, "정밀도");
  const tp = 12445 * 0.8, fn = 261322 * 0.02;
  near(r.recall, tp / (tp + fn), "보정 재현율");
  assert.ok(r.recall! < 0.7, `재현율이 보정되지 않음: ${r.recall}`);
  near(r.f1, (2 * 0.8 * r.recall!) / (0.8 + r.recall!), "F1");
  assert.equal(r.n, 200);
  // 화면이 예전처럼 tp/fp/fn/tn 을 읽어도 되게 검수 건수 그대로 돌려줍니다
  assert.deepEqual([r.tp, r.fp, r.fn, r.tn], [80, 20, 2, 98]);
}

// 4) 아닌 쪽에서 놓친 게 하나도 없으면 재현율 100%
{
  const r = stratified({ tpV: 50, fpV: 0, fnN: 0, tnN: 50, popVisit: 100, popNon: 1000 });
  near(r.recall, 1, "재현율");
}

console.log("accuracy OK");
