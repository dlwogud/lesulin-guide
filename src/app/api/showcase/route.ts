import { NextResponse } from "next/server";
import { dbReady } from "@/lib/db";
import { loadShowcase } from "@/lib/showcase";

/** 시작 화면의 예시 식당. 고르는 건 src/lib/showcase.ts, 숫자와 본문은 DB. */
export async function GET() {
  if (!(await dbReady())) {
    return NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 });
  }
  const data = await loadShowcase();
  /* /api/seed 와 같은 캐시 — 데이터는 수집 파이프라인을 돌릴 때만 바뀝니다 */
  const cache = "public, s-maxage=600, stale-while-revalidate=3600";
  return NextResponse.json(data, {
    headers: { "Cache-Control": cache, "CDN-Cache-Control": cache },
  });
}
