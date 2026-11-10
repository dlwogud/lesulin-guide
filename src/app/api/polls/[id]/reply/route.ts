import { NextRequest, NextResponse } from "next/server";
import { q, dbReady } from "@/lib/db";
import { badBody, badSession, tooFast } from "@/lib/polls";

export async function POST(
  req: NextRequest, { params }: { params: Promise<{ id: string }> }
) {
  if (!(await dbReady())) {
    return NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 });
  }
  const { id } = await params;
  const pollId = Number(id);
  if (!Number.isInteger(pollId)) {
    return NextResponse.json({ error: "잘못된 글입니다." }, { status: 400 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const err = badSession(b.session) ?? badBody(b.body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const session = b.session as string;
  if (await tooFast(session, "poll_replies", 15)) {
    return NextResponse.json({ error: "답글을 너무 빨리 달고 있습니다." }, { status: 429 });
  }
  /* 어제 글에는 답글을 달 수 없습니다 — 0시에 새 판이 시작되는 규칙과 맞춰야
     "실시간"이 말이 됩니다. */
  const [live] = await q<{ ok: boolean }>(`
    SELECT (day = (now() AT TIME ZONE 'Asia/Seoul')::date AND NOT hidden) AS ok
      FROM polls WHERE id = $1`, [pollId]);
  if (!live) return NextResponse.json({ error: "없는 글입니다." }, { status: 404 });
  if (!live.ok) {
    return NextResponse.json({ error: "오늘 올라온 글에만 답글을 달 수 있습니다." }, { status: 410 });
  }
  const storeId = typeof b.storeId === "string" && b.storeId ? b.storeId : null;
  const nick = typeof b.nickname === "string" ? b.nickname.trim().slice(0, 12) || null : null;
  const [row] = await q<{ id: string }>(`
    INSERT INTO poll_replies (poll_id, body, store_id, nickname, session)
    VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [pollId, (b.body as string).trim(), storeId, nick, session]);
  return NextResponse.json({ ok: true, id: Number(row.id) });
}
