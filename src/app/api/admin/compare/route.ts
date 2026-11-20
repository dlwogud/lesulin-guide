import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { dbReady } from "@/lib/db";
import { buildCases, caseIds, appliedStats } from "@/lib/aiCompare";
import evalRes from "../../../../../data/ai_eval/eval.json";
import devRes from "../../../../../data/ai_eval/dev.json";

/* AI 비교 검수 — 평가 결과 표 + 시연 사례 + 시연 식당에서 규칙·LLM 이 엇갈린 댓글 */
export async function GET() {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = (r: any) => ({ set: r.set, n: r.n, sample: r.sample, versions: r.versions, run_at: r.run_at, methods: r.methods,
    llm_wall_ms: r.llm_wall_ms, evidence_not_in_comment: r.evidence_not_in_comment });
  const [cases, applied] = await Promise.all([caseIds().then(buildCases), appliedStats()]);
  return NextResponse.json({ eval: strip(evalRes), dev: strip(devRes), cases, applied });
}
