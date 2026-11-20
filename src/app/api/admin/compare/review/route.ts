import { NextRequest, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { q, dbReady } from "@/lib/db";
import { audit } from "@/lib/manage";

/* AI 비교 화면의 사람 최종 판정. admin_reviews(무작위 정확도 표본)와 따로 저장하고,
   수정 전·후 · 검수자 · 시간 · 이유를 audit_log 에 남깁니다. 평가 표본 정답(파일)·식당 점수는 바꾸지 않습니다. */
export async function POST(req: NextRequest) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cid = Number(b.commentId);
  if (!Number.isInteger(cid) || typeof b.isVisit !== "boolean") return NextResponse.json({ error: "댓글과 판정이 필요합니다." }, { status: 400 });
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
  if (!reason) return NextResponse.json({ error: "판정 이유를 적어 주세요." }, { status: 400 });
  const [before] = await q<{ is_visit: boolean; reason: string | null }>(
    `SELECT is_visit, reason FROM ai_reviews WHERE comment_id = $1 ORDER BY id DESC LIMIT 1`, [cid]);
  const [row] = await q<{ id: number; created_at: string }>(
    `INSERT INTO ai_reviews (comment_id, reviewer_id, is_visit, reason) VALUES ($1,$2,$3,$4) RETURNING id::int, created_at`,
    [cid, me.id, b.isVisit, reason]);
  await audit(me.id, "ai_review", "comment", String(cid), before ?? null, { is_visit: b.isVisit, reason });
  return NextResponse.json({ ok: true, id: row.id, at: row.created_at });
}
