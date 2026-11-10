import { NextRequest, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { dbReady } from "@/lib/db";
import { listStores, auditLog, regions } from "@/lib/manage";

export async function GET(req: NextRequest) {
  const me = await currentAdmin().catch(() => null);
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });
  const p = req.nextUrl.searchParams;
  const [stores, log, regs] = await Promise.all([
    listStores({
      q: p.get("q") ?? undefined,
      region: p.get("region") ?? undefined,
      onlyHidden: p.get("hidden") === "1",
      onlyBadged: p.get("badged") === "1",
      limit: 60,
    }),
    auditLog(25),
    regions(),
  ]);
  return NextResponse.json({ stores, log, regions: regs });
}
