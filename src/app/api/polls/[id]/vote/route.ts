import { NextRequest, NextResponse } from "next/server";
import { q, dbReady } from "@/lib/db";
import { badSession } from "@/lib/polls";

/** 같은 걸 다시 누르면 취소, 반대를 누르면 바뀝니다. 한 브라우저 한 표. */
export async function POST(
  req: NextRequest, { params }: { params: Promise<{ id: string }> }
) {
  if (!(await dbReady())) {
    return NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 });
  }
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const err = badSession(b.session);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const v = Number(b.value);
  if (v !== 1 && v !== -1 && v !== 0) {
    return NextResponse.json({ error: "값이 올바르지 않습니다." }, { status: 400 });
  }
  const session = b.session as string;
  const target = b.target === "reply" ? "reply" : "poll";
  const [table, col] = target === "reply"
    ? ["reply_votes", "reply_id"] : ["poll_votes", "poll_id"];
  const n = Number(id);
  if (!Number.isInteger(n)) {
    return NextResponse.json({ error: "잘못된 대상입니다." }, { status: 400 });
  }
  if (v === 0) {
    await q(`DELETE FROM ${table} WHERE ${col} = $1 AND session = $2`, [n, session]);
  } else {
    await q(`INSERT INTO ${table} (${col}, session, value) VALUES ($1,$2,$3)
             ON CONFLICT (${col}, session) DO UPDATE SET value = EXCLUDED.value`,
            [n, session, v]);
  }
  const sumSql = target === "reply"
    ? `SELECT count(*) FILTER (WHERE value = 1)::int AS up,
              count(*) FILTER (WHERE value = -1)::int AS down
         FROM reply_votes WHERE reply_id = $1`
    : `SELECT count(*) FILTER (WHERE value = 1)::int AS up,
              count(*) FILTER (WHERE value = -1)::int AS down
         FROM poll_votes WHERE poll_id = $1`;
  const [t] = await q(sumSql, [n]);
  return NextResponse.json({ ok: true, ...t, my_vote: v });
}
