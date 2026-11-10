import { NextRequest, NextResponse } from "next/server";
import { q, dbReady } from "@/lib/db";

/* 사용자가 "정보가 틀렸어요"를 눌렀을 때. 로그인 없이 받습니다 —
   틀린 걸 알려주려고 계정을 만들라고 하면 아무도 안 알려줍니다. */
const KINDS = new Set(["wrong_place", "closed", "wrong_video", "wrong_score", "other"]);
const ID = /^[A-Za-z0-9_-]{8,64}$/;

export async function POST(req: NextRequest) {
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = typeof b.kind === "string" && KINDS.has(b.kind) ? b.kind : null;
  if (!kind) return NextResponse.json({ error: "신고 종류를 고르세요." }, { status: 400 });

  const session = typeof b.session === "string" && ID.test(b.session) ? b.session : null;
  const visitor = typeof b.visitor === "string" && ID.test(b.visitor) ? b.visitor : null;
  if (!session) return NextResponse.json({ error: "세션이 올바르지 않습니다." }, { status: 400 });

  /* 한 사람이 같은 가게를 쏟아내지 못하게 막습니다. */
  const [dup] = await q<{ n: string }>(
    `SELECT count(*)::int AS n FROM feedback
      WHERE session = $1 AND at > now() - interval '10 minutes'`, [session]);
  if (Number(dup.n) >= 5) {
    return NextResponse.json({ error: "잠시 뒤에 다시 보내 주세요." }, { status: 429 });
  }
  const storeId = typeof b.storeId === "string" && b.storeId ? b.storeId.slice(0, 32) : null;
  const body = typeof b.body === "string" ? b.body.trim().slice(0, 500) || null : null;

  const [row] = await q<{ id: string }>(
    `INSERT INTO feedback (store_id, kind, body, session, visitor)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`, [storeId, kind, body, session, visitor]);
  return NextResponse.json({ ok: true, id: Number(row.id) });
}
