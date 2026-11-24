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

/* 관리자가 글·답글을 아예 지웁니다. ?target=poll | reply
   글을 지우면 답글·추천도 FK(ON DELETE CASCADE)로 함께 지워집니다.
   지운 본문은 수정 이력(before)에만 남습니다. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });

  const n = Number((await params).id);
  if (!Number.isInteger(n)) return NextResponse.json({ error: "잘못된 글입니다." }, { status: 400 });
  const isReply = req.nextUrl.searchParams.get("target") === "reply";

  const [before] = isReply
    ? await q<{ body: string; poll_id: string }>(
        `SELECT body, poll_id FROM poll_replies WHERE id = $1`, [n])
    : await q<{ body: string; replies: number }>(
        `SELECT p.body, (SELECT count(*)::int FROM poll_replies r WHERE r.poll_id = p.id) AS replies
           FROM polls p WHERE p.id = $1`, [n]);
  if (!before) return NextResponse.json({ error: "없는 글입니다." }, { status: 404 });
  await q(`DELETE FROM ${isReply ? "poll_replies" : "polls"} WHERE id = $1`, [n]);
  await audit(me.id, "community_delete", isReply ? "poll_reply" : "poll", String(n), before, null);
  return NextResponse.json({ ok: true });
}
