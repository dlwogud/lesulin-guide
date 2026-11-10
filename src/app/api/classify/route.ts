import { NextRequest, NextResponse } from "next/server";
import { analyze, visited, promo, clauses, MODEL } from "@/lib/classify";
import { q, dbReady } from "@/lib/db";
import { currentAdmin } from "@/lib/auth";

/* 문장을 그 자리에서 분류합니다 — 미리 돌려 둔 결과를 읽어 주는 게 아닙니다.
   규칙 기반이라 외부 호출도, 토큰 비용도 없습니다. 보통 1ms 안에 끝납니다.
   호출마다 응답 시간과 오류를 ai_calls 에 남겨 운영 로그로 씁니다. */

const MAX = 2000;

export async function POST(req: NextRequest) {
  const t0 = performance.now();
  let caller = "user", chars = 0, n = 1;
  let err: string | null = null;
  let body: unknown = null;

  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const me = await currentAdmin().catch(() => null);
    caller = me ? "admin" : "user";

    const texts = Array.isArray(b.texts)
      ? (b.texts as unknown[]).slice(0, 50).map(String)
      : typeof b.text === "string" ? [b.text] : [];
    if (!texts.length) throw new Error("분류할 문장이 없습니다.");
    n = texts.length;

    const results = texts.map(raw => {
      const t = raw.slice(0, MAX);
      chars += t.length;
      const asp = analyze(t);
      return {
        text: t,
        visit: visited(t),
        promo: promo(t),
        aspects: Object.entries(asp).map(([a, p]) => ({ aspect: a, polarity: p })),
        clauses: clauses(t),          // 왜 그렇게 봤는지 절 단위로 보여 줍니다
      };
    });
    body = { ok: true, model: MODEL, results };
  } catch (e) {
    err = e instanceof Error ? e.message : "분류하지 못했습니다";
    body = { error: err };
  }

  const ms = Math.round(performance.now() - t0);
  /* 로그 때문에 응답이 느려지면 안 됩니다. 실패해도 결과는 그대로 돌려줍니다. */
  if (await dbReady().catch(() => false)) {
    q(`INSERT INTO ai_calls (endpoint, model, ms, chars, n, ok, error, caller)
       VALUES ('classify',$1,$2,$3,$4,$5,$6,$7)`,
      [MODEL, ms, chars, n, !err, err, caller]).catch(() => {});
  }
  return NextResponse.json(
    { ...(body as object), ms },
    { status: err ? 400 : 200, headers: { "x-model": MODEL, "x-ms": String(ms) } });
}
