import { NextRequest, NextResponse } from "next/server";
import { q, dbReady } from "@/lib/db";
import { feed, replies, head, badBody, badSession, tooFast, type Sort } from "@/lib/polls";
import { INSERT_POLL } from "@/lib/pollsSql";

/** 화면이 8초마다 부릅니다. 목록 + 답글 + 최신 id 를 한 번에 줍니다. */
export async function GET(req: NextRequest) {
  if (!(await dbReady())) {
    return NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 });
  }
  const p = req.nextUrl.searchParams;
  const sort = (p.get("sort") === "new" ? "new" : "hot") as Sort;
  const session = p.get("session");
  const polls = await feed(sort, session);
  const ids = polls.map((x) => Number((x as { id: string }).id));
  return NextResponse.json({
    polls,
    replies: await replies(ids, session),
    head: await head(),
    today: new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }),
  });
}

export async function POST(req: NextRequest) {
  if (!(await dbReady())) {
    return NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const err = badSession(b.session) ?? badBody(b.body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const session = b.session as string;
  if (await tooFast(session, "polls")) {
    return NextResponse.json(
      { error: "잠시 뒤에 다시 올려 주세요. 10분에 5개까지 쓸 수 있습니다." }, { status: 429 });
  }
  const storeId = typeof b.storeId === "string" && b.storeId ? b.storeId : null;
  const kind = storeId ? "store" : "ask";
  const lat = Number.isFinite(Number(b.lat)) ? Number(b.lat) : null;
  const lng = Number.isFinite(Number(b.lng)) ? Number(b.lng) : null;

  /* 위치를 주소로 바꾸는 API를 또 부르지 않습니다.
     이미 1,512곳의 좌표가 DB에 있으니 가장 가까운 식당의 시군구를 씁니다.
     "서울 마포구" 정도만 보여 주면 되고, 좌표는 이 계산에만 쓰고 저장하지 않습니다. */
  let place: string | null = null;
  if (lat !== null && lng !== null) {
    const [near] = await q<{ region: string }>(`
      SELECT region FROM stores
       ORDER BY (lat - $1) * (lat - $1) + (lng - $2) * (lng - $2)
       LIMIT 1`, [lat, lng]);
    place = near?.region ?? null;
  }
  const nick = typeof b.nickname === "string" ? b.nickname.trim().slice(0, 12) || null : null;

  const [row] = await q<{ id: string }>(INSERT_POLL,
    [kind, (b.body as string).trim(), storeId, place, nick, session]);
  return NextResponse.json({ ok: true, id: Number(row.id) });
}
