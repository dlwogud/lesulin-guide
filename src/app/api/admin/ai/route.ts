import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { q, dbReady } from "@/lib/db";

export async function GET() {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });
  const [daily, calls] = await Promise.all([
    q(`SELECT * FROM ai_daily ORDER BY day DESC LIMIT 14`),
    q(`SELECT id, at, endpoint, ms, chars, n, ok, error, caller
         FROM ai_calls ORDER BY id DESC LIMIT 20`),
  ]);
  return NextResponse.json({ daily, calls });
}
