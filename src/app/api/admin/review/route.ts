import { NextRequest, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { q, dbReady } from "@/lib/db";
import { reviewQueue } from "@/lib/admin";

const ASPECTS = new Set(["맛", "양", "가격", "서비스", "대기", "분위기"]);

export async function GET(req: NextRequest) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });
  const only = req.nextUrl.searchParams.get("only");
  const rows = await reviewQueue(me.id, 20,
    only === "visit" || only === "nonvisit" ? only : undefined);
  const { accuracy } = await import("@/lib/admin");
  return NextResponse.json({ items: rows, accuracy: await accuracy() });
}

export async function POST(req: NextRequest) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cid = Number(b.commentId);
  if (!Number.isInteger(cid)) {
    return NextResponse.json({ error: "댓글을 찾을 수 없습니다." }, { status: 400 });
  }
  const vague = b.vague === true;
  const isVisit = typeof b.isVisit === "boolean" ? b.isVisit : null;

  /* 항목은 {"맛":1,"대기":-1} 꼴만 받습니다. 모르는 항목·값은 버립니다. */
  let aspects: Record<string, number> | null = null;
  if (b.aspects && typeof b.aspects === "object") {
    aspects = {};
    for (const [k, v] of Object.entries(b.aspects as Record<string, unknown>)) {
      if (ASPECTS.has(k) && (v === 1 || v === -1)) aspects[k] = v;
    }
  }
  await q(`INSERT INTO admin_reviews (comment_id, reviewer_id, is_visit, aspects, vague, note)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (comment_id, reviewer_id) DO UPDATE
             SET is_visit = EXCLUDED.is_visit, aspects = EXCLUDED.aspects,
                 vague = EXCLUDED.vague, note = EXCLUDED.note, created_at = now()`,
          [cid, me.id, isVisit, aspects ? JSON.stringify(aspects) : null, vague,
           typeof b.note === "string" ? b.note.slice(0, 300) : null]);

  /* 검수가 쌓일 때마다 정확도를 다시 재서 돌려줍니다 —
     화면 숫자를 하드코딩하지 않는다는 뜻이기도 합니다. */
  const { accuracy } = await import("@/lib/admin");
  return NextResponse.json({ ok: true, accuracy: await accuracy() });
}
