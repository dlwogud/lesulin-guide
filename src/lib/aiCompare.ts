/* AI 비교 검수 — 한 댓글에 대해 규칙 / LLM / 혼합 / 사람 판정을 모읍니다. 서버 전용. */
import { q } from "./db";
import { visited } from "./classify";
import { route, hybridFinal, ROUTE_VERSION } from "./hybrid";
import { judgeVisit, VISIT_PROMPT_VERSION, LLM_MODEL, type VisitJudgment } from "./llm";
import demo from "../../data/ai_demo.json";

export type CaseRow = {
  comment_id: number; body: string; likes: number; store_id: string | null; store: string | null; video: string | null;
  rule_visit: boolean; routed: boolean; why: string[];
  llm: { id: number; label: string | null; evidence: string | null; evidence_ok: boolean | null; reason: string | null;
         model: string; prompt_version: string; input_tokens: number | null; output_tokens: number | null;
         cost_usd: string | null; ms: number | null; purpose: string; created_at: string; error: string | null } | null;
  hybrid: { visit: boolean; source: string };
  applied: boolean;                      // ai_visit 에 들어 있는 (시연 식당) 댓글인가
  human: { is_visit: boolean; reason: string | null; created_at: string; reviewer: string | null } | null;
  demo?: { kind: string; note: string; truth?: string };
};

type Base = { comment_id: number; body: string; likes: number; store_id: string | null; store: string | null; video: string | null; applied: boolean };

async function bases(ids: number[]): Promise<Base[]> {
  if (!ids.length) return [];
  return q<Base>(`
    SELECT c.id::int AS comment_id, c.body, c.likes,
           COALESCE(a.store_id, (SELECT sv.store_id FROM store_videos sv WHERE sv.video_id = c.video_id ORDER BY sv.store_id LIMIT 1)) AS store_id,
           (SELECT s.name FROM stores s WHERE s.id = COALESCE(a.store_id, (SELECT sv.store_id FROM store_videos sv WHERE sv.video_id = c.video_id ORDER BY sv.store_id LIMIT 1))) AS store,
           v.title AS video, (a.comment_id IS NOT NULL) AS applied
      FROM comments c JOIN videos v ON v.id = c.video_id
      LEFT JOIN ai_visit a ON a.comment_id = c.id
     WHERE c.id = ANY($1)`, [ids]);
}

export async function buildCases(ids: number[]): Promise<CaseRow[]> {
  const bs = await bases(ids);
  const llm = await q<NonNullable<CaseRow["llm"]> & { comment_id: number }>(`
    SELECT DISTINCT ON (comment_id) comment_id::int, id::int, label, evidence, evidence_ok, reason, model, prompt_version,
           input_tokens, output_tokens, cost_usd, ms, purpose, created_at, error
      FROM llm_judgments WHERE comment_id = ANY($1) AND prompt_version = $2
     ORDER BY comment_id, (purpose = 'admin_live') DESC, id DESC`, [ids, VISIT_PROMPT_VERSION]);
  const human = await q<NonNullable<CaseRow["human"]> & { comment_id: number }>(`
    SELECT DISTINCT ON (r.comment_id) r.comment_id::int, r.is_visit, r.reason, r.created_at, u.email AS reviewer
      FROM ai_reviews r LEFT JOIN admin_users u ON u.id = r.reviewer_id
     WHERE r.comment_id = ANY($1) ORDER BY r.comment_id, r.id DESC`, [ids]);
  const L = new Map(llm.map((x) => [x.comment_id, x])), H = new Map(human.map((x) => [x.comment_id, x]));
  const D = new Map((demo.cases as { comment_id: number; kind: string; note: string; truth?: string }[]).map((d) => [d.comment_id, d]));
  const order = new Map(ids.map((id, i) => [id, i]));
  return bs.sort((a, b) => order.get(a.comment_id)! - order.get(b.comment_id)!).map((b) => {
    const r = route(b.body), l = L.get(b.comment_id) ?? null;
    return {
      ...b, rule_visit: r.rule, routed: r.toLLM, why: r.why,
      llm: l, hybrid: hybridFinal(r, (l?.label as "yes" | "no" | "unsure" | null) ?? null),
      human: H.get(b.comment_id) ?? null, demo: D.get(b.comment_id),
    };
  });
}

/* 시연 사례 + 시연 식당에서 규칙과 LLM 판정이 엇갈린 댓글 */
export async function caseIds(limit = 30): Promise<number[]> {
  const pinned = (demo.cases as { comment_id: number }[]).map((d) => d.comment_id);
  const diff = await q<{ id: number }>(`
    SELECT a.comment_id::int AS id FROM ai_visit a JOIN llm_judgments j ON j.id = a.judgment_id
     WHERE a.routed AND j.label IS NOT NULL AND (j.label = 'yes') <> a.rule_visit
     ORDER BY md5(a.comment_id::text) LIMIT ${limit}`);
  return [...new Set([...pinned, ...diff.map((d) => d.id)])];
}

export async function appliedStats() {
  const [s] = await q<Record<string, number>>(`
    SELECT count(DISTINCT store_id)::int AS stores, count(*)::int AS comments,
           count(*) FILTER (WHERE routed)::int AS routed,
           count(*) FILTER (WHERE rule_visit)::int AS rule_visit,
           count(*) FILTER (WHERE final_visit)::int AS final_visit,
           count(*) FILTER (WHERE rule_visit <> final_visit)::int AS changed
      FROM ai_visit`);
  const [c] = await q<Record<string, string>>(`
    SELECT count(*)::int AS calls, COALESCE(sum(input_tokens),0)::int AS input_tokens, COALESCE(sum(output_tokens),0)::int AS output_tokens,
           COALESCE(sum(cost_usd),0)::numeric(10,4) AS cost_usd, round(avg(ms))::int AS avg_ms
      FROM llm_judgments WHERE purpose = 'store_apply' AND label IS NOT NULL`);
  const [m] = await q<Record<string, string>>(`
    SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'ok')::int AS ok,
           count(*) FILTER (WHERE reviewed_at IS NOT NULL)::int AS reviewed,
           COALESCE(sum(cost_usd),0)::numeric(10,4) AS cost_usd
      FROM ai_summaries`);
  return { visit: s, llm: c, summaries: m };
}

/* 관리자 한 명이 10분에 20번까지만 실시간 호출 — 비용 보호 */
export async function tooMany(adminId: number) {
  const [r] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM llm_judgments
     WHERE actor = $1 AND created_at > now() - interval '10 minutes'`, [`admin:${adminId}`]);
  return r.n >= 20;
}

export async function liveJudge(adminId: number, input: { commentId?: number; text?: string; store?: string; video?: string }) {
  let text = input.text ?? "", store = input.store ?? "", video = input.video ?? "", cid: number | null = null;
  if (input.commentId) {
    const [b] = await bases([input.commentId]);
    if (!b) throw new Error("댓글을 찾을 수 없습니다.");
    text = b.body; store = b.store ?? ""; video = b.video ?? ""; cid = b.comment_id;
  }
  if (!text.trim() || !store.trim()) throw new Error("댓글과 식당 이름이 필요합니다.");
  const rule = visited(text), r = route(text);
  let j: VisitJudgment | null = null, err: string | null = null;
  const t0 = Date.now();
  try { j = await judgeVisit({ text, store, video }); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  const [row] = await q<{ id: number; created_at: string }>(`
    INSERT INTO llm_judgments (comment_id, purpose, label, evidence, evidence_ok, reason, model, prompt_version, input_tokens, output_tokens, cost_usd, ms, error, actor)
    VALUES ($1,'admin_live',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id::int, created_at`,
    [cid, j?.label ?? null, j?.evidence ?? null, j?.evidenceOk ?? null, j?.reason ?? null, j?.model ?? LLM_MODEL, VISIT_PROMPT_VERSION,
     j?.inputTokens ?? null, j?.outputTokens ?? null, j?.costUsd ?? null, j?.ms ?? Date.now() - t0, err, `admin:${adminId}`]);
  await q(`INSERT INTO ai_calls (endpoint, model, ms, chars, n, ok, error, caller, input_tokens, output_tokens, cost_usd, prompt_version, ref)
           VALUES ('visit_llm',$1,$2,$3,1,$4,$5,'admin',$6,$7,$8,$9,$10)`,
    [j?.model ?? LLM_MODEL, j?.ms ?? Date.now() - t0, text.length, !err, err, j?.inputTokens ?? null, j?.outputTokens ?? null, j?.costUsd ?? null,
     VISIT_PROMPT_VERSION, cid ? String(cid) : null]).catch(() => {});
  return {
    id: row.id, at: row.created_at, error: err, rule, routed: r.toLLM, why: r.why, routeVersion: ROUTE_VERSION,
    hybrid: hybridFinal(r, j?.label ?? null),
    judgment: j && { label: j.label, evidence: j.evidence, evidenceOk: j.evidenceOk, reason: j.reason, model: j.model,
      promptVersion: j.promptVersion, inputTokens: j.inputTokens, outputTokens: j.outputTokens, costUsd: j.costUsd, ms: j.ms, requestId: j.requestId },
  };
}
