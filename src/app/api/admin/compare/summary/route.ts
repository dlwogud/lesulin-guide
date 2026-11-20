import { NextRequest, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { q, dbReady } from "@/lib/db";
import { audit } from "@/lib/manage";

type Line = { kind: string; text: string; commentIds: number[] };

/* 근거 요약 검수 — 줄마다 근거 댓글 원문을 붙여 돌려주고, 사람이 대조한 결과를 저장합니다. */
export async function GET() {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });
  const rows = await q<{ store_id: string; name: string; status: string; lines: Line[]; n_evidence: number; model: string | null;
    prompt_version: string | null; cost_usd: string | null; created_at: string; reviewed_at: string | null; review: unknown; reviewer: string | null }>(`
    SELECT a.store_id, s.name, a.status, a.lines, a.n_evidence, a.model, a.prompt_version, a.cost_usd, a.created_at, a.reviewed_at, a.review, u.email AS reviewer
      FROM ai_summaries a JOIN stores s ON s.id = a.store_id LEFT JOIN admin_users u ON u.id = a.reviewer_id ORDER BY a.store_id`);
  const ids = [...new Set(rows.flatMap((r) => r.lines.flatMap((l) => l.commentIds)))];
  const cs = ids.length ? await q<{ id: number; body: string }>(`SELECT id::int, body FROM comments WHERE id = ANY($1)`, [ids]) : [];
  return NextResponse.json({ items: rows, comments: Object.fromEntries(cs.map((c) => [c.id, c.body])) });
}

export async function POST(req: NextRequest) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { storeId?: string; review?: { line: number; ok: boolean; note?: string }[] };
  if (!b.storeId || !Array.isArray(b.review)) return NextResponse.json({ error: "식당과 검수 결과가 필요합니다." }, { status: 400 });
  const review = b.review.map((r) => ({ line: Number(r.line), ok: !!r.ok, note: String(r.note ?? "").slice(0, 300) }));
  const [before] = await q(`SELECT review, reviewed_at FROM ai_summaries WHERE store_id = $1`, [b.storeId]);
  if (!before) return NextResponse.json({ error: "요약이 없습니다." }, { status: 404 });
  await q(`UPDATE ai_summaries SET review = $2, reviewed_at = now(), reviewer_id = $3 WHERE store_id = $1`, [b.storeId, JSON.stringify(review), me.id]);
  await audit(me.id, "summary_review", "store", b.storeId, before, { review });
  return NextResponse.json({ ok: true });
}
