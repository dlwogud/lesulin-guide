/* 시연 식당에 혼합 판정을 실제로 적용하고, 그 결과로 근거 연결 3줄 요약을 만듭니다.
 *
 *   node --experimental-strip-types scripts/ai/apply.ts --dry          몇 건이 LLM 으로 가는지만 셈 (호출 없음)
 *   node --experimental-strip-types scripts/ai/apply.ts                판정 적용 + 요약 생성
 *   node --experimental-strip-types scripts/ai/apply.ts --summary-only 판정은 두고 요약만 다시
 *
 * 대상은 data/ai_stores.json 의 식당입니다(시작 화면에서 사람이 검증한 예시 식당).
 * 판정은 ai_visit · llm_judgments 에, 요약은 ai_summaries 에, 호출마다 ai_calls 에 남깁니다.
 * 이미 LLM 판정이 있는 댓글은 다시 부르지 않습니다(같은 프롬프트 버전일 때). */

import { readFileSync } from "node:fs";
import { q, pool } from "../../src/lib/db.ts";
import { route, hybridFinal, ROUTE_VERSION } from "../../src/lib/hybrid.ts";
import { judgeVisit, summarizeStore, VISIT_PROMPT_VERSION, SUMMARY_PROMPT_VERSION, LLM_MODEL } from "../../src/lib/llm.ts";

const DRY = process.argv.includes("--dry"), SUMMARY_ONLY = process.argv.includes("--summary-only");
const STORES: string[] = JSON.parse(readFileSync("data/ai_stores.json", "utf8")).stores;
const MAX_EVIDENCE = 40;     // 요약에 넘기는 방문 댓글 수 상한 (좋아요 많은 순)
const MIN_EVIDENCE = 3;      // 이보다 적으면 요약하지 않고 "부족"으로 둡니다

type C = { id: number; body: string; likes: number; video: string; store: string };

async function comments(storeId: string): Promise<C[]> {
  return q<C>(`
    SELECT c.id::int, c.body, c.likes, v.title AS video, s.name AS store
      FROM stores s JOIN store_videos sv ON sv.store_id = s.id
      JOIN videos v ON v.id = sv.video_id JOIN comments c ON c.video_id = v.id
     WHERE s.id = $1 AND NOT c.is_owner
     ORDER BY c.id`, [storeId]);
}

async function logCall(endpoint: string, ref: string, r: { model: string; ms: number; inputTokens: number; outputTokens: number; costUsd: number | null; promptVersion: string } | null, chars: number, err?: string) {
  await q(`INSERT INTO ai_calls (endpoint, model, ms, chars, n, ok, error, caller, input_tokens, output_tokens, cost_usd, prompt_version, ref)
           VALUES ($1,$2,$3,$4,1,$5,$6,'script',$7,$8,$9,$10,$11)`,
    [endpoint, r?.model ?? LLM_MODEL, r?.ms ?? 0, chars, !err, err ?? null, r?.inputTokens ?? null, r?.outputTokens ?? null, r?.costUsd ?? null,
     r?.promptVersion ?? (endpoint === "summary" ? SUMMARY_PROMPT_VERSION : VISIT_PROMPT_VERSION), ref]);
}

async function pool4<T>(xs: T[], f: (x: T) => Promise<void>) {
  let i = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (i < xs.length) await f(xs[i++]); }));
}

let calls = 0, cost = 0;
for (const sid of STORES) {
  const cs = await comments(sid);
  if (!cs.length) { console.log(sid, "댓글 없음"); continue; }
  const routes = new Map(cs.map((c) => [c.id, route(c.body)]));
  const toLLM = cs.filter((c) => routes.get(c.id)!.toLLM);
  const ruleV = cs.filter((c) => routes.get(c.id)!.rule).length;
  console.log(`${sid} ${cs[0].store} — 댓글 ${cs.length} · 규칙 방문 ${ruleV} · LLM 으로 ${toLLM.length}`);
  if (DRY) { calls += toLLM.length; continue; }

  if (!SUMMARY_ONLY) {
    const done = new Map((await q<{ comment_id: number; id: number; label: string | null }>(`
      SELECT DISTINCT ON (comment_id) comment_id::int, id::int, label FROM llm_judgments
       WHERE comment_id = ANY($1) AND prompt_version = $2 AND label IS NOT NULL ORDER BY comment_id, id DESC`,
      [toLLM.map((c) => c.id), VISIT_PROMPT_VERSION])).map((r) => [r.comment_id, r]));
    const judged = new Map<number, { id: number; label: string | null }>(done);
    await pool4(toLLM.filter((c) => !done.has(c.id)), async (c) => {
      try {
        const j = await judgeVisit({ text: c.body, store: c.store, video: c.video });
        const [row] = await q<{ id: number }>(`
          INSERT INTO llm_judgments (comment_id, purpose, label, evidence, evidence_ok, reason, model, prompt_version, input_tokens, output_tokens, cost_usd, ms, actor)
          VALUES ($1,'store_apply',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'script') RETURNING id::int`,
          [c.id, j.label, j.evidence, j.evidenceOk, j.reason, j.model, j.promptVersion, j.inputTokens, j.outputTokens, j.costUsd, j.ms]);
        judged.set(c.id, { id: row.id, label: j.label });
        await logCall("visit_llm", String(c.id), j, c.body.length);
        calls++; cost += j.costUsd ?? 0;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const [row] = await q<{ id: number }>(`INSERT INTO llm_judgments (comment_id, purpose, model, prompt_version, error, actor)
          VALUES ($1,'store_apply',$2,$3,$4,'script') RETURNING id::int`, [c.id, LLM_MODEL, VISIT_PROMPT_VERSION, msg.slice(0, 300)]);
        judged.set(c.id, { id: row.id, label: null });
        await logCall("visit_llm", String(c.id), null, c.body.length, msg.slice(0, 300));
      }
    });
    /* 한 식당분을 한 번에 씁니다 (한 줄씩 쓰면 풀러 왕복 때문에 식당당 몇 분이 걸립니다) */
    const recs = cs.map((c) => {
      const r = routes.get(c.id)!, j = judged.get(c.id);
      const f = hybridFinal(r, (j?.label as "yes" | "no" | "unsure" | null) ?? null);
      return { id: c.id, rule: r.rule, routed: r.toLLM, why: r.why.join("|"), jid: j?.id ?? null, visit: f.visit, source: f.source, pv: r.toLLM ? VISIT_PROMPT_VERSION : null };
    });
    await q(`INSERT INTO ai_visit (comment_id, store_id, rule_visit, routed, why, judgment_id, final_visit, source, route_version, prompt_version, updated_at)
             SELECT x.id, $2, x.rule, x.routed, CASE WHEN x.why = '' THEN '{}'::text[] ELSE string_to_array(x.why, '|') END, x.jid, x.visit, x.source, $3, x.pv, now()
               FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, rule boolean, routed boolean, why text, jid bigint, visit boolean, source text, pv text)
             ON CONFLICT (comment_id) DO UPDATE SET store_id=EXCLUDED.store_id, rule_visit=EXCLUDED.rule_visit, routed=EXCLUDED.routed, why=EXCLUDED.why,
               judgment_id=EXCLUDED.judgment_id, final_visit=EXCLUDED.final_visit, source=EXCLUDED.source,
               route_version=EXCLUDED.route_version, prompt_version=EXCLUDED.prompt_version, updated_at=now()`,
      [JSON.stringify(recs), sid, ROUTE_VERSION]);
  }

  /* 이미 같은 프롬프트로 만든 요약이 있으면 두지 않고 넘어갑니다 (--resummarize 로 강제). 검수한 요약이 바뀌지 않게. */
  const [had] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM ai_summaries WHERE store_id = $1 AND (prompt_version = $2 OR status = 'insufficient')`, [sid, SUMMARY_PROMPT_VERSION]);
  if (had.n && !process.argv.includes("--resummarize")) { console.log("   요약: 이미 있음 — 건너뜀"); continue; }

  /* 근거 요약 — 혼합 판정이 "방문"인 댓글만, 좋아요 많은 순으로 */
  const ev = await q<{ id: number; body: string }>(`
    SELECT c.id::int, c.body FROM ai_visit a JOIN comments c ON c.id = a.comment_id
     WHERE a.store_id = $1 AND a.final_visit ORDER BY c.likes DESC, c.id LIMIT ${MAX_EVIDENCE}`, [sid]);
  const finalV = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ai_visit WHERE store_id=$1 AND final_visit`, [sid]))[0].n;
  if (ev.length < MIN_EVIDENCE) {
    await q(`INSERT INTO ai_summaries (store_id, status, lines, evidence_ids, n_evidence, created_at)
             VALUES ($1,'insufficient','[]',$2,$3, now())
             ON CONFLICT (store_id) DO UPDATE SET status='insufficient', lines='[]', evidence_ids=EXCLUDED.evidence_ids, n_evidence=EXCLUDED.n_evidence,
               model=NULL, prompt_version=NULL, input_tokens=NULL, output_tokens=NULL, cost_usd=NULL, ms=NULL, created_at=now(), reviewed_at=NULL, reviewer_id=NULL, review=NULL`,
      [sid, ev.map((e) => e.id), ev.length]);
    console.log(`   요약: 방문 댓글 ${ev.length}개 — 부족`);
    continue;
  }
  try {
    const s = await summarizeStore(cs[0].store, ev.map((e) => ({ id: e.id, text: e.body })));
    await q(`INSERT INTO ai_summaries (store_id, status, lines, evidence_ids, n_evidence, model, prompt_version, input_tokens, output_tokens, cost_usd, ms, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
             ON CONFLICT (store_id) DO UPDATE SET status=EXCLUDED.status, lines=EXCLUDED.lines, evidence_ids=EXCLUDED.evidence_ids, n_evidence=EXCLUDED.n_evidence,
               model=EXCLUDED.model, prompt_version=EXCLUDED.prompt_version, input_tokens=EXCLUDED.input_tokens, output_tokens=EXCLUDED.output_tokens,
               cost_usd=EXCLUDED.cost_usd, ms=EXCLUDED.ms, created_at=now(), reviewed_at=NULL, reviewer_id=NULL, review=NULL`,
      [sid, s.status, JSON.stringify(s.lines), ev.map((e) => e.id), ev.length, s.model, s.promptVersion, s.inputTokens, s.outputTokens, s.costUsd, s.ms]);
    await logCall("summary", sid, s, ev.reduce((a, e) => a + e.body.length, 0));
    calls++; cost += s.costUsd ?? 0;
    console.log(`   요약(${s.status}, 근거 ${ev.length}/${finalV}개): ` + s.lines.map((l) => `[${l.kind}] ${l.text} ←${l.commentIds.join(",")}`).join("  "));
  } catch (e) {
    await logCall("summary", sid, null, 0, e instanceof Error ? e.message : String(e));
    console.log("   요약 실패:", e instanceof Error ? e.message : e);
  }
}
console.log(DRY ? `\n예상 LLM 호출 ${calls}건 (판정) — 약 $${(calls * 0.0065).toFixed(2)} (개발 표본 평균 단가 기준 추정)` : `\nLLM 호출 ${calls}건 · 측정 비용 $${cost.toFixed(4)}`);
await pool().end();
