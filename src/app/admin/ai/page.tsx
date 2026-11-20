"use client";
import { useCallback, useEffect, useState } from "react";

type Res = {
  text: string; visit: boolean; promo: boolean;
  aspects: { aspect: string; polarity: number }[]; clauses: string[];
};
type Daily = {
  day: string; calls: number; items: number; avg_ms: number; max_ms: number;
  p95_ms: number; chars: number; errors: number; input_tokens?: number; output_tokens?: number; cost_usd?: string;
};
type Call = {
  id: number; at: string; endpoint: string; ms: number; chars: number | null;
  n: number; ok: boolean; error: string | null; caller: string | null;
  model?: string; input_tokens?: number | null; output_tokens?: number | null; cost_usd?: string | null;
};

const EXAMPLES = [
  "어제 다녀왔는데 웨이팅 40분 했어요 그래도 양이 푸짐하고 가격도 저렴해서 만족합니다",
  "시경씨 너무 맛있게 드시네요 영상 잘 보고 갑니다",
  "가보고 싶네요 맛있겠다",
  "20여 년 단골인데 사람들 몰려 있어 한참 기다렸습니다",
  "안녕하세요 여원찜갈비 입니다. 방문 감사합니다",
];

export default function AiOps() {
  const [text, setText] = useState(EXAMPLES[0]);
  const [res, setRes] = useState<Res | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);

  const loadLog = useCallback(async () => {
    const r = await fetch("/api/admin/ai");
    if (!r.ok) return;
    const d = await r.json();
    setDaily(d.daily ?? []); setCalls(d.calls ?? []);
  }, []);
  useEffect(() => { loadLog(); }, [loadLog]);

  async function run() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await fetch("/api/classify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const d = await r.json();
    setRes(d.results?.[0] ?? null); setMs(d.ms ?? null); setModel(d.model ?? "");
    setBusy(false); loadLog();
  }

  const t = daily[0];

  return (
    <div className="flex flex-col gap-4 max-w-[1000px]">
      <section className="rounded-xl p-4" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        <h1 className="text-xs font-semibold mb-0.5">AI 실시간 호출 — 규칙 분류기</h1>
        <p className="text-[10.5px] mb-3 leading-relaxed" style={{ color: "var(--ink-3)" }}>
          아무 문장이나 넣으면 <b>그 자리에서</b> 분류합니다. 미리 돌려 둔 결과를 읽는 게 아닙니다.
          절을 어떻게 나눴는지도 같이 보여 주므로 왜 그렇게 판정했는지 확인할 수 있습니다.
        </p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={2000}
                  className="w-full rounded-lg px-3 py-2 text-[12.5px] mb-2"
                  style={{ border: "1px solid var(--line)" }} />
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {EXAMPLES.map((e, i) => (
            <button key={i} onClick={() => setText(e)} className="text-[10px] px-2 py-1 rounded"
                    style={{ border: "1px solid var(--line)", color: "var(--ink-3)" }}>
              예{i + 1}
            </button>
          ))}
          <button onClick={run} disabled={busy}
                  className="ml-auto text-[12px] font-semibold px-5 py-2 rounded-lg"
                  style={{ background: "var(--accent)", color: "#fff" }}>
            {busy ? "분류 중…" : "분류하기"}
          </button>
        </div>

        {res && (
          <div className="rounded-lg p-3 mt-1" style={{ background: "var(--surface-2)" }}>
            <p className="text-[10px] mb-2 tabular-nums" style={{ color: "var(--ink-3)" }}>
              {model} · 응답 {ms}ms · 토큰 비용 0원(규칙 기반)
            </p>
            <p className="text-[12px] mb-1">
              방문 경험:{" "}
              <b style={{ color: res.visit ? "var(--good)" : "var(--ink-2)" }}>
                {res.visit ? "있다" : "없다"}
              </b>
              {res.promo && <span className="ml-2" style={{ color: "var(--warn)" }}>운영자·홍보 댓글로 봄</span>}
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {res.aspects.length === 0
                ? <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>찾은 항목 없음</span>
                : res.aspects.map(a => (
                  <span key={a.aspect} className="text-[11px] px-2 py-0.5 rounded"
                        style={{ background: "var(--surface)", border: "1px solid var(--line)",
                                 color: a.polarity > 0 ? "var(--good)" : "var(--bad)" }}>
                    {a.aspect} {a.polarity > 0 ? "긍정" : "부정"}
                  </span>
                ))}
            </div>
            <p className="text-[10px] mb-1" style={{ color: "var(--ink-3)" }}>
              나눈 절 {res.clauses.length}개
            </p>
            <ol className="text-[11px] flex flex-col gap-0.5" style={{ color: "var(--ink-2)" }}>
              {res.clauses.map((c, i) => <li key={i}>{i + 1}. {c}</li>)}
            </ol>
          </div>
        )}
      </section>

      <section className="rounded-xl p-4" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-xs font-semibold mb-2">AI 운영 로그 — 오늘</h2>
        {!t ? (
          <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
            오늘 호출이 없습니다. 위에서 분류하면 여기 쌓입니다.
          </p>
        ) : (
          <dl className="grid grid-cols-3 md:grid-cols-8 gap-3">
            {[["호출 수", t.calls], ["분류 건수", t.items], ["평균 응답", `${t.avg_ms}ms`],
              ["95% 응답", `${t.p95_ms}ms`], ["최대", `${t.max_ms}ms`], ["오류", t.errors],
              ["LLM 토큰(입력/출력)", `${(t.input_tokens ?? 0).toLocaleString("ko-KR")}/${(t.output_tokens ?? 0).toLocaleString("ko-KR")}`],
              ["LLM 비용", `$${t.cost_usd ?? "0"}`]]
              .map(([k, v]) => (
              <div key={k as string}>
                <dd className="text-[15px] font-semibold tabular-nums"
                    style={{ color: k === "오류" && Number(v) > 0 ? "var(--bad)" : undefined }}>{v}</dd>
                <dt className="text-[10px]" style={{ color: "var(--ink-3)" }}>{k}</dt>
              </div>
            ))}
          </dl>
        )}
        <p className="text-[10px] mt-3 pt-2 leading-relaxed"
           style={{ color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}>
          <b>classify</b> 는 규칙 분류(토큰 0) · <b>visit_llm</b>·<b>summary</b> 는 Claude 호출이며, 응답의 실제 토큰 × 공개 단가로 비용을 셉니다.
          규칙·LLM 비교와 실시간 LLM 호출은 <a href="/admin/compare" style={{ textDecoration: "underline" }}>AI 비교</a> 화면에 있습니다.
        </p>
      </section>

      <section className="rounded-xl p-4" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-xs font-semibold mb-2">최근 호출</h2>
        {calls.length === 0 ? (
          <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>기록이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {calls.map(c => (
              <li key={c.id} className="text-[11px] flex gap-2 tabular-nums">
                <span style={{ color: c.ok ? "var(--good)" : "var(--bad)" }}>{c.ok ? "✓" : "✕"}</span>
                <span style={{ color: "var(--ink-3)" }}>
                  {new Date(c.at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })}
                </span>
                <span>{c.endpoint}</span>
                <span style={{ color: "var(--ink-3)" }}>{c.caller}</span>
                {c.error && <span style={{ color: "var(--bad)" }}>{c.error}</span>}
                <span className="ml-auto">{c.model} · {c.ms}ms · {c.chars ?? 0}자{c.input_tokens != null ? ` · 토큰 ${c.input_tokens}/${c.output_tokens} · $${Number(c.cost_usd ?? 0).toFixed(4)}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
