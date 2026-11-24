import { NextRequest, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { q, dbReady } from "@/lib/db";
import { audit } from "@/lib/manage";

/* 관리자가 커뮤니티 글·답글을 가리거나 되돌립니다. 지우지 않고 가리기만 하며, 수정 이력에 남깁니다.
   body: { target: "poll" | "reply", hidden: boolean } — 경로의 id 는 target 의 id */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });

  const n = Number((await params).id);
  if (!Number.isInteger(n)) return NextResponse.json({ error: "잘못된 글입니다." }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.hidden !== "boolean") {
    return NextResponse.json({ error: "hidden 값이 올바르지 않습니다." }, { status: 400 });
  }
  const table = b.target === "reply" ? "poll_replies" : "polls";

  const [before] = await q<{ hidden: boolean; body: string }>(
    `SELECT hidden, body FROM ${table} WHERE id = $1`, [n]);
  if (!before) return NextResponse.json({ error: "없는 글입니다." }, { status: 404 });
  await q(`UPDATE ${table} SET hidden = $1 WHERE id = $2`, [b.hidden, n]);
  await audit(me.id, b.hidden ? "community_hide" : "community_show",
              table === "polls" ? "poll" : "poll_reply", String(n),
              { hidden: before.hidden, body: before.body }, { hidden: b.hidden });
  return NextResponse.json({ ok: true });
}
