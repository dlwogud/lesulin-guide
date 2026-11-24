import { NextRequest, NextResponse } from "next/server";
import { q, dbReady } from "@/lib/db";
import { badBody, badSession } from "@/lib/polls";
import { OWN_SQL } from "@/lib/pollsOwn";

/* 쓴 사람이 자기 글을 고치거나 지웁니다. 세션이 다르면 0행 → 404.
   남의 글인지 없는 글인지는 구분해 알려 주지 않습니다. */
const NOT_MINE = "없는 글이거나 내가 쓴 글이 아닙니다.";

async function read(req: NextRequest, params: Promise<{ id: string }>) {
  if (!(await dbReady())) return { res: NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 }) };
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return { res: NextResponse.json({ error: "잘못된 글입니다." }, { status: 400 }) };
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const err = badSession(b.session);
  if (err) return { res: NextResponse.json({ error: err }, { status: 400 }) };
  return { id, b, session: b.session as string };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await read(req, params);
  if (r.res) return r.res;
  const err = badBody(r.b.body);
  const body = typeof r.b.body === "string" ? r.b.body.trim() : "";
  if (err || body.length < 2) {           // 글은 DB 제약상 2자 이상
    return NextResponse.json({ error: err ?? "2자 이상 써 주세요." }, { status: 400 });
  }
  const rows = await q(OWN_SQL.editPoll, [r.id, r.session, body]);
  if (!rows.length) return NextResponse.json({ error: NOT_MINE }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await read(req, params);
  if (r.res) return r.res;
  const rows = await q(OWN_SQL.deletePoll, [r.id, r.session]);
  if (!rows.length) return NextResponse.json({ error: NOT_MINE }, { status: 404 });
  return NextResponse.json({ ok: true });
}
