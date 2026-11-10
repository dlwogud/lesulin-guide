import { NextRequest, NextResponse } from "next/server";
import { getCreators, getRegions, getStores } from "@/lib/data";

/** 통합 검색: 유튜버 · 지역 · 식당을 한 번에 */
export function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return NextResponse.json({ creators: [], regions: [], stores: [] });
  return NextResponse.json({
    creators: getCreators().filter((c) => c.creatorName.toLowerCase().includes(q)).slice(0, 5),
    regions: getRegions().filter((r) => r.region.toLowerCase().includes(q)).slice(0, 5),
    stores: getStores({ q }).slice(0, 8),
  });
}
