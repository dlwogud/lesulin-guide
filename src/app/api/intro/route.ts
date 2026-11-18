import { NextResponse } from "next/server";
import { dbReady } from "@/lib/db";
import { loadIntro } from "@/lib/intro";

/** 시작 화면 v3 — 유튜버별 예시 식당과 숫자. 고르는 건 화면이 하고, 여기선 10명 분을 한 번에 줍니다. */
export async function GET() {
  if (!(await dbReady())) {
    return NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 });
  }
  const data = await loadIntro();
  const cache = "public, s-maxage=600, stale-while-revalidate=3600";   // /api/seed 와 같음
  return NextResponse.json(data, { headers: { "Cache-Control": cache, "CDN-Cache-Control": cache } });
}
