import { NextRequest, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { q, dbReady } from "@/lib/db";
import { audit } from "@/lib/manage";

const STATUS = new Set(["open", "doing", "done", "rejected"]);

export async function PATCH(
  req: NextRequest, { params }: { params: Promise<{ id: string }> }
) {
  const me = await currentAdmin().catch(() => null);
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });

  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n)) return NextResponse.json({ error: "잘못된 신고입니다." }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = typeof b.status === "string" && STATUS.has(b.status) ? b.status : null;
  if (!status) return NextResponse.json({ error: "상태가 올바르지 않습니다." }, { status: 400 });
  const memo = typeof b.memo === "string" ? b.memo.slice(0, 300) : null;

  const [before] = await q<Record<string, unknown>>(
    `SELECT status, memo FROM feedback WHERE id = $1`, [n]);
  if (!before) return NextResponse.json({ error: "없는 신고입니다." }, { status: 404 });

  await q(`UPDATE feedback
              SET status = $1, memo = $2, handled_by = $3,
                  handled_at = CASE WHEN $1 = 'open' THEN NULL ELSE now() END,
                  handled = ($1 = 'done')
            WHERE id = $4`, [status, memo, me.id, n]);
  await audit(me.id, "feedback", "feedback", String(n),
              before, { status, memo });
  return NextResponse.json({ ok: true });
}
