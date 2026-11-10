import { NextRequest, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { q, dbReady } from "@/lib/db";
import { audit, storeVideos } from "@/lib/manage";

/* 수정할 수 있는 칸만 받습니다. 좌표·지역은 수집 파이프라인이 정하므로
   여기서 손대지 않습니다 — 손으로 고치면 다음 적재에서 덮어써집니다. */
const FIELDS = ["name", "address", "category"] as const;

export async function GET(
  _r: NextRequest, { params }: { params: Promise<{ id: string }> }
) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ videos: await storeVideos(id) });
}

export async function PATCH(
  req: NextRequest, { params }: { params: Promise<{ id: string }> }
) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });

  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const [before] = await q<Record<string, unknown>>(
    `SELECT s.name, s.address, s.category, s.hidden, s.hide_note,
            st.level_override
       FROM stores s LEFT JOIN store_stats st ON st.store_id = s.id
      WHERE s.id = $1`, [id]);
  if (!before) return NextResponse.json({ error: "없는 식당입니다." }, { status: 404 });

  const set: string[] = [], val: unknown[] = [];
  for (const f of FIELDS) {
    if (typeof b[f] === "string") {
      const v = (b[f] as string).trim().slice(0, 200) || null;
      if (v !== before[f]) { val.push(v); set.push(`${f} = $${val.length}`); }
    }
  }
  if (typeof b.hidden === "boolean" && b.hidden !== before.hidden) {
    val.push(b.hidden); set.push(`hidden = $${val.length}`);
    val.push(typeof b.hideNote === "string" ? b.hideNote.slice(0, 200) : null);
    set.push(`hide_note = $${val.length}`);
  }
  if (set.length) {
    val.push(id);
    await q(`UPDATE stores SET ${set.join(", ")}, updated_at = now()
              WHERE id = $${val.length}`, val);
  }

  /* 배지 수동 조정은 store_stats 에 따로 둡니다.
     파이프라인이 다시 계산해도 override 가 있으면 그걸 씁니다. */
  let lvChanged = false;
  if (b.levelOverride === null || typeof b.levelOverride === "number") {
    const lv = b.levelOverride === null ? null
             : Math.max(0, Math.min(3, Math.trunc(b.levelOverride as number))) || null;
    if (lv !== before.level_override) {
      await q(`INSERT INTO store_stats (store_id, level_override, override_note)
               VALUES ($1,$2,$3)
               ON CONFLICT (store_id) DO UPDATE
                 SET level_override = EXCLUDED.level_override,
                     override_note = EXCLUDED.override_note, updated_at = now()`,
              [id, lv, typeof b.overrideNote === "string" ? b.overrideNote.slice(0, 200) : null]);
      lvChanged = true;
    }
  }
  if (!set.length && !lvChanged) {
    return NextResponse.json({ ok: true, changed: false });
  }
  const [after] = await q<Record<string, unknown>>(
    `SELECT s.name, s.address, s.category, s.hidden, s.hide_note, st.level_override
       FROM stores s LEFT JOIN store_stats st ON st.store_id = s.id WHERE s.id = $1`, [id]);

  /* 바뀐 칸만 추려서 남깁니다. 전체를 남기면 이력에서 무엇이 바뀐지 안 보입니다. */
  const diffB: Record<string, unknown> = {}, diffA: Record<string, unknown> = {};
  for (const k of Object.keys(before)) {
    if (before[k] !== after[k]) { diffB[k] = before[k]; diffA[k] = after[k]; }
  }
  await audit(me.id, b.hidden === true ? "hide" : b.hidden === false ? "restore" : "update",
              "store", id, diffB, diffA);
  return NextResponse.json({ ok: true, changed: true, before: diffB, after: diffA });
}

/** 영상 연결 해제 — 영상 자체는 지우지 않습니다. 잘못 붙은 연결만 끊습니다. */
export async function DELETE(
  req: NextRequest, { params }: { params: Promise<{ id: string }> }
) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const vid = req.nextUrl.searchParams.get("video");
  if (!vid) return NextResponse.json({ error: "영상 id가 필요합니다." }, { status: 400 });
  const [v] = await q<{ title: string }>(`SELECT title FROM videos WHERE id = $1`, [vid]);
  await q(`DELETE FROM store_videos WHERE store_id = $1 AND video_id = $2`, [id, vid]);
  await audit(me.id, "unlink", "store_video", `${id}/${vid}`,
              { video: vid, title: v?.title ?? null }, null);
  return NextResponse.json({ ok: true });
}
