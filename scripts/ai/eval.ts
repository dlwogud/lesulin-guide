/* 규칙 / LLM / 혼합 — 같은 댓글, 같은 사람 정답으로 방문 경험 언급 분류를 비교합니다.
 *
 *   node --experimental-strip-types scripts/ai/eval.ts dev     개발용 1차 196건 (분기 조건·프롬프트를 만든 표본)
 *   node --experimental-strip-types scripts/ai/eval.ts eval    평가용 2차 90건 (조정에 쓰지 않은 표본)
 *
 * LLM 은 표본 전부에 한 번씩 호출합니다(B). 혼합(C)은 그중 분기 조건에 걸린 댓글의 결과만 씁니다 —
 * 같은 호출을 두 번 하지 않으므로, C 의 토큰·비용·시간은 C 가 보낸 댓글의 실제 측정값을 더한 값입니다.
 * 호출 결과는 labeling/ai/cache/<프롬프트 버전>/ 에 저장해 다시 돌려도 과금되지 않습니다(저장된 측정값을 씁니다).
 * 결과(숫자와 댓글별 판정, 원문 제외)는 data/ai_eval/<표본>.json 에 남깁니다. */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { visited, MODEL as RULE_MODEL } from "../../src/lib/classify.ts";
import { judgeVisit, LLM_MODEL, VISIT_PROMPT_VERSION, type VisitJudgment } from "../../src/lib/llm.ts";
import { route, hybridFinal, ROUTE_VERSION } from "../../src/lib/hybrid.ts";

type Item = { id: string; comment_id?: number; store: string; video: string; text: string; human: boolean; stratum?: boolean };
const which = process.argv[2] === "eval" ? "eval" : "dev";
const raw = JSON.parse(readFileSync(`labeling/ai/${which}.json`, "utf8"));
const items: Item[] = which === "eval" ? raw.items : raw;
const meta = which === "eval" ? raw.meta as { pop_visit: number; pop_non: number } : null;

const cacheDir = `labeling/ai/cache/${VISIT_PROMPT_VERSION}`;
mkdirSync(cacheDir, { recursive: true });

async function llm(it: Item): Promise<(VisitJudgment & { error?: string }) | { error: string }> {
  const f = `${cacheDir}/${it.id}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  for (let a = 0; a < 3; a++) {
    try {
      const j = await judgeVisit({ text: it.text, store: it.store, video: it.video });
      writeFileSync(f, JSON.stringify({ ...j, at: new Date().toISOString() }));
      return j;
    } catch (e) {
      if (a === 2) return { error: e instanceof Error ? e.message : String(e) };
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  }
  return { error: "unreachable" };
}

/* 4개씩 동시에 */
async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
}

const wall0 = performance.now();
const llmRes = await pool(items, 4, llm);
const llmWall = performance.now() - wall0;

/* 규칙 시간 — 같은 표본을 규칙으로 다시 돌려 잽니다 */
const r0 = performance.now();
const rulePred = items.map((it) => visited(it.text));
const ruleMs = performance.now() - r0;
const routes = items.map((it) => route(it.text));

type Row = { id: string; human: boolean; rule: boolean; llm: string; hybrid: boolean; routed: boolean; why: string[]; source: string };
const rows: Row[] = items.map((it, k) => {
  const j = llmRes[k] as VisitJudgment & { error?: string };
  const label = j.error ? "error" : j.label;
  const h = hybridFinal(routes[k], j.error ? null : j.label);
  return { id: it.id, human: it.human, rule: rulePred[k], llm: label, hybrid: h.visit, routed: routes[k].toLLM, why: routes[k].why, source: h.source };
});

/* 지표. 방문/비방문 쪽을 따로 뽑은 2차 표본은 각 쪽 모집단 크기로 가중한 추정치도 냅니다. */
function metrics(pred: (r: Row) => boolean) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) { const p = pred(r); if (p && r.human) tp++; else if (p) fp++; else if (r.human) fn++; else tn++; }
  const P = tp + fp ? tp / (tp + fp) : null, R = tp + fn ? tp / (tp + fn) : null;
  const F = P != null && R != null && P + R ? (2 * P * R) / (P + R) : null;
  let w: { P: number | null; R: number | null; F: number | null } | null = null;
  if (meta) {
    const k: Record<string, number> = { tp: 0, fp: 0, fn: 0 };
    for (const s of [true, false]) {
      const rs = rows.filter((r, i) => !!items[i].stratum === s), N = s ? meta.pop_visit : meta.pop_non;
      for (const r of rs) { const p = pred(r); const wt = N / rs.length; if (p && r.human) k.tp += wt; else if (p) k.fp += wt; else if (r.human) k.fn += wt; }
    }
    const wp = k.tp + k.fp ? k.tp / (k.tp + k.fp) : null, wr = k.tp + k.fn ? k.tp / (k.tp + k.fn) : null;
    w = { P: wp, R: wr, F: wp != null && wr != null && wp + wr ? (2 * wp * wr) / (wp + wr) : null };
  }
  return { tp, fp, fn, tn, P, R, F, weighted: w };
}

const okJ = (k: number) => !(llmRes[k] as { error?: string }).error;
const sumOver = (ks: number[], f: (j: VisitJudgment) => number) => ks.filter(okJ).reduce((a, k) => a + f(llmRes[k] as VisitJudgment), 0);
const all = items.map((_, k) => k), routed = all.filter((k) => routes[k].toLLM);
const usage = (ks: number[]) => ({
  calls: ks.length,
  input_tokens: sumOver(ks, (j) => j.inputTokens),
  output_tokens: sumOver(ks, (j) => j.outputTokens),
  cost_usd: +sumOver(ks, (j) => j.costUsd ?? 0).toFixed(4),
  llm_ms_sum: sumOver(ks, (j) => j.ms),
  llm_ms_avg: ks.length ? Math.round(sumOver(ks, (j) => j.ms) / ks.filter(okJ).length) : 0,
});

const unsure = rows.filter((r) => r.llm === "unsure").length, errors = rows.filter((r) => r.llm === "error").length;
const result = {
  set: which, n: items.length, human_visit: rows.filter((r) => r.human).length,
  sample: which === "eval" ? `2차 층화 표본 — 규칙 판정 기준 방문 쪽 ${items.filter((i) => i.stratum).length} / 비방문 쪽 ${items.filter((i) => !i.stratum).length} (모집단 ${meta!.pop_visit} / ${meta!.pop_non})` : "1차 표본 — 규칙 개선·분기 조건·프롬프트 작성에 사용 (독립 평가 아님)",
  versions: { rule: RULE_MODEL, llm: LLM_MODEL, prompt: VISIT_PROMPT_VERSION, route: ROUTE_VERSION },
  run_at: new Date().toISOString(),
  methods: {
    rule: { ...metrics((r) => r.rule), llm_ratio: 0, usage: usage([]), time_ms: +ruleMs.toFixed(2) },
    llm: { ...metrics((r) => r.llm === "yes"), llm_ratio: 1, usage: usage(all), unsure, errors, unsure_as: "아니오로 셈" },
    hybrid: { ...metrics((r) => r.hybrid), llm_ratio: routed.length / items.length, usage: usage(routed), rule_fallback: rows.filter((r) => r.source === "rule-fallback").length },
  },
  llm_wall_ms: Math.round(llmWall),
  evidence_not_in_comment: items.filter((_, k) => okJ(k) && !(llmRes[k] as VisitJudgment).evidenceOk).length,
  rows,
};
mkdirSync("data/ai_eval", { recursive: true });
writeFileSync(`data/ai_eval/${which}.json`, JSON.stringify(result, null, 1));

const pct = (x: number | null | undefined) => (x == null ? "—" : (100 * x).toFixed(1) + "%");
console.log(`\n${which} — ${result.sample}`);
console.log(`버전: 규칙 ${RULE_MODEL} · LLM ${LLM_MODEL} · 프롬프트 ${VISIT_PROMPT_VERSION} · 분기 ${ROUTE_VERSION}\n`);
console.log("| 방식 | n | TP/FP/FN/TN | 정밀도 | 재현율 | F1 |" + (meta ? " 가중 정밀도 | 가중 재현율 | 가중 F1 |" : "") + " LLM 전송 | 입력/출력 토큰 | 비용 | LLM 시간(합/평균) |");
for (const [name, m] of Object.entries(result.methods) as [string, any][]) {
  console.log(`| ${name} | ${items.length} | ${m.tp}/${m.fp}/${m.fn}/${m.tn} | ${pct(m.P)} | ${pct(m.R)} | ${pct(m.F)} |` +
    (meta ? ` ${pct(m.weighted.P)} | ${pct(m.weighted.R)} | ${pct(m.weighted.F)} |` : "") +
    ` ${pct(m.llm_ratio)} (${m.usage.calls}건) | ${m.usage.input_tokens}/${m.usage.output_tokens} | $${m.usage.cost_usd} | ${(m.usage.llm_ms_sum / 1000).toFixed(1)}s/${m.usage.llm_ms_avg}ms |`);
}
console.log(`\nLLM 판단 어려움 ${unsure}건(아니오로 셈) · 오류 ${errors}건 · 근거 구절이 원문에 없음 ${result.evidence_not_in_comment}건 · 혼합에서 규칙으로 돌아감 ${result.methods.hybrid.rule_fallback}건 · 규칙 ${ruleMs.toFixed(1)}ms`);
if (which === "dev") {
  const show = (f: (r: Row) => boolean, t: string) => { const xs = rows.filter(f); console.log(`\n${t} ${xs.length}건: ${xs.map((r) => `${r.id}(${r.why.join("/") || "-"})`).join(" ")}`); };
  show((r) => r.rule !== r.human && !r.routed, "혼합이 놓친 규칙 오류(LLM 에 안 보냄)");
  show((r) => r.routed && r.hybrid !== r.human, "LLM 에 보냈는데도 틀림");
  show((r) => r.rule === r.human && r.routed && r.hybrid !== r.human, "규칙은 맞았는데 LLM 이 뒤집어 틀림");
}
