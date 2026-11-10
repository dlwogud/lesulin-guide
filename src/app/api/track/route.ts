import { NextRequest, NextResponse } from "next/server";
import { q, dbReady } from "@/lib/db";

/* 화면이 모아서 한 번에 보냅니다(5초마다 또는 탭을 떠날 때).
   클릭마다 요청을 보내면 쓸데없이 느려지고 무료 티어 연결도 금방 찹니다. */

const EVENTS = new Set([
  "view", "search", "store_open", "creator_pick", "fav_set",
  "poll_open", "poll_new", "poll_vote", "feedback", "region_pick",
]);
const ID = /^[A-Za-z0-9_-]{8,64}$/;

type Hit = {
  event?: unknown; path?: unknown; storeId?: unknown; creatorId?: unknown;
  q?: unknown; session?: unknown; visitor?: unknown;
};

export async function POST(req: NextRequest) {
  if (!(await dbReady())) return NextResponse.json({ ok: false }, { status: 204 });
  const body = (await req.json().catch(() => null)) as { hits?: Hit[] } | null;
  const hits = Array.isArray(body?.hits) ? body!.hits.slice(0, 50) : [];
  if (!hits.length) return NextResponse.json({ ok: true, n: 0 });

  const rows: unknown[][] = [];
  for (const h of hits) {
    const ev = typeof h.event === "string" && EVENTS.has(h.event) ? h.event : null;
    if (!ev) continue;                                  // 모르는 이벤트는 버립니다
    const sid = typeof h.session === "string" && ID.test(h.session) ? h.session : null;
    const vid = typeof h.visitor === "string" && ID.test(h.visitor) ? h.visitor : null;
    if (!sid || !vid) continue;
    rows.push([
      ev,
      typeof h.path === "string" ? h.path.slice(0, 120) : "/map",
      typeof h.storeId === "string" ? h.storeId.slice(0, 32) : null,
      typeof h.creatorId === "string" ? h.creatorId.slice(0, 8) : null,
      // 검색어는 그대로 남겨야 "무엇을 찾는가"를 볼 수 있습니다. 40자로 자릅니다.
      typeof h.q === "string" ? h.q.trim().slice(0, 40) || null : null,
      sid, vid,
    ]);
  }
  if (!rows.length) return NextResponse.json({ ok: true, n: 0 });

  const vals = rows.map((_, i) => {
    const b = i * 7;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
  }).join(",");
  await q(`INSERT INTO access_log (event, path, store_id, creator_id, q, session, visitor)
           VALUES ${vals}`, rows.flat());
  return NextResponse.json({ ok: true, n: rows.length });
}
