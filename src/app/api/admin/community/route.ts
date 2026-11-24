import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { q, dbReady } from "@/lib/db";

/* 관리자 커뮤니티 목록 — 가린 글까지 전체 글과 그 답글.
   세션 값은 내보내지 않습니다(관리자에게도 필요 없는 식별값). */
export async function GET() {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });

  const polls = await q(`
    SELECT p.id, p.body, p.place, p.created_at, p.edited_at, p.hidden,
           s.name AS store_name
      FROM polls p LEFT JOIN stores s ON s.id = p.store_id
     ORDER BY p.id DESC`);
  const ids = polls.map((p) => Number((p as { id: string }).id));
  const replies = ids.length ? await q(`
    SELECT r.id, r.poll_id, r.body, r.created_at, r.edited_at, r.hidden
      FROM poll_replies r
     WHERE r.poll_id = ANY($1::bigint[])
     ORDER BY r.poll_id, r.id`, [ids]) : [];
  return NextResponse.json({ polls, replies });
}
