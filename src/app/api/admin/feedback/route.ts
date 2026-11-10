import { NextRequest, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { q, dbReady } from "@/lib/db";

export async function GET(req: NextRequest) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });

  const st = req.nextUrl.searchParams.get("status");
  const where = st && st !== "all" ? "WHERE f.status = $1" : "";
  const items = await q(`
    SELECT f.id, f.at, f.kind, f.body, f.status, f.memo, f.handled_at,
           f.store_id, s.name AS store_name, s.region AS store_region,
           u.email AS handler
      FROM feedback f
      LEFT JOIN stores s ON s.id = f.store_id
      LEFT JOIN admin_users u ON u.id = f.handled_by
      ${where}
     ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'doing' THEN 1 ELSE 2 END, f.id DESC
     LIMIT 100`, where ? [st] : []);
  const counts = await q(`SELECT status, count(*)::int AS n FROM feedback GROUP BY status`);
  return NextResponse.json({ items, counts });
}
