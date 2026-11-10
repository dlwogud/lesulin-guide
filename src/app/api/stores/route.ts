import { NextRequest, NextResponse } from "next/server";
import { getStores } from "@/lib/data";
import type { GuideLevel, SearchFilters, StoreStatus } from "@/lib/types";

export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const f: SearchFilters = {
    creator: p.get("creator") ?? undefined,
    region: p.get("region") ?? undefined,
    category: p.get("category") ?? undefined,
    q: p.get("q") ?? undefined,
    level: p.get("level") ? (Number(p.get("level")) as GuideLevel) : undefined,
    status: (p.get("status") as StoreStatus) ?? undefined,
  };
  const b = p.get("bounds");            // "swLat,swLng,neLat,neLng"
  if (b) {
    const n = b.split(",").map(Number);
    if (n.length === 4 && n.every(Number.isFinite)) {
      f.bounds = { sw: [n[0], n[1]], ne: [n[2], n[3]] };
    }
  }
  const stores = getStores(f);
  return NextResponse.json({ stores, total: stores.length });
}
