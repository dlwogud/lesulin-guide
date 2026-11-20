import { NextRequest, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { dbReady } from "@/lib/db";
import { liveJudge, tooMany } from "@/lib/aiCompare";

/* "LLM으로 다시 분석" — 서버가 그 자리에서 Claude 를 호출합니다. 저장해 둔 결과를 읽는 게 아닙니다.
   키는 서버 환경변수에만 있고, 결과는 llm_judgments(purpose=admin_live)·ai_calls 에 남습니다.
   공개 화면의 판정(ai_visit)·식당 점수는 바꾸지 않습니다. */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const me = await currentAdmin();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await dbReady())) return NextResponse.json({ error: "DB 연결 실패" }, { status: 503 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "서버에 LLM 키가 없습니다." }, { status: 503 });
  if (await tooMany(me.id)) return NextResponse.json({ error: "10분에 20번까지 호출할 수 있습니다." }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await liveJudge(me.id, {
      commentId: Number.isInteger(Number(b.commentId)) && b.commentId ? Number(b.commentId) : undefined,
      text: typeof b.text === "string" ? b.text.slice(0, 3000) : undefined,
      store: typeof b.store === "string" ? b.store.slice(0, 100) : undefined,
      video: typeof b.video === "string" ? b.video.slice(0, 300) : undefined,
    });
    return NextResponse.json(r, { status: r.error ? 502 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "호출하지 못했습니다." }, { status: 400 });
  }
}
