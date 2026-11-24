import { NextRequest, NextResponse } from "next/server";
import { q, dbReady } from "@/lib/db";
import { badBody, badSession } from "@/lib/polls";
import { OWN_SQL } from "@/lib/pollsSql";

/* 쓴 사람이 자기 답글을 고치거나 지웁니다. 세션이 다르면 0행 → 404. */
const NOT_MINE = "없는 답글이거나 내가 쓴 답글이 아닙니다.";
type P = Promise<{ id: string; rid: string }>;

async function read(req: NextRequest, params: P) {
  if (!(await dbReady())) return { res: NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 }) };
  const p = await params, pollId = Number(p.id), rid = Number(p.rid);
  if (!Number.isInteger(pollId) || !Number.isInteger(rid)) {
    return { res: NextResponse.json({ error: "잘못된 답글입니다." }, { status: 400 }) };
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const err = badSession(b.session);
  if (err) return { res: NextResponse.json({ error: err }, { status: 400 }) };
  return { pollId, rid, b, session: b.session as string };
}

export async function PATCH(req: NextRequest, { params }: { params: P }) {
  const r = await read(req, params);
  if (r.res) return r.res;
  const err = badBody(r.b.body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const rows = await q(OWN_SQL.editReply, [r.rid, r.pollId, r.session, (r.b.body as string).trim()]);
  if (!rows.length) return NextResponse.json({ error: NOT_MINE }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: P }) {
  const r = await read(req, params);
  if (r.res) return r.res;
  const rows = await q(OWN_SQL.deleteReply, [r.rid, r.pollId, r.session]);
  if (!rows.length) return NextResponse.json({ error: NOT_MINE }, { status: 404 });
  return NextResponse.json({ ok: true });
}
