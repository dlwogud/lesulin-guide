"use client";
import { useCallback, useEffect, useState } from "react";

const ASPECTS = ["맛", "양", "가격", "서비스", "대기", "분위기"] as const;
type Item = {
  id: number; body: string; published_at: string | null; likes: number;
  pred_visit: boolean; pred_aspects: { a: string; p: number }[];
  video_title: string; creator: string; store_name: string | null;
};
type Acc = { n: number; tp: number; fp: number; fn: number;
             precision: number | null; recall: number | null; f1: number | null };

const pct = (v: number | null) => v === null ? "—" : (v * 100).toFixed(1) + "%";

export default function Review() {
  const [items, setItems] = useState<Item[]>([]);
  const [i, setI] = useState(0);
  const [acc, setAcc] = useState<Acc | null>(null);
  const [only, setOnly] = useState<"all" | "visit" | "nonvisit">("all");
  const [mine, setMine] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const load = useCallback(async (f: typeof only) => {
    const r = await fetch(`/api/admin/review${f === "all" ? "" : `?only=${f}`}`);
    const d = await r.json();
    setItems(d.items ?? []); setI(0); setMine({});
  }, []);

  useEffect(() => { load(only); }, [only, load]);

  const cur = items[i];

  /* 사람이 고친 항목이 없으면 분류기 결과를 그대로 동의한 것으로 봅니다.
     "동의"도 데이터입니다 — 맞게 잡은 것(tp)을 세야 정밀도가 나옵니다. */
  function predAspects(it: Item) {
    const o: Record<string, number> = {};
    for (const x of it.pred_aspects ?? []) o[x.a] = x.p;
    return o;
  }

  async function send(isVisit: boolean | null, vague: boolean) {
    if (!cur || busy) return;
    setBusy(true);
    const aspects = Object.keys(mine).length ? mine : predAspects(cur);
    const r = await fetch("/api/admin/review", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commentId: cur.id, isVisit, vague, aspects }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.accuracy) setAcc(d.accuracy);
    setDone(n => n + 1); setMine({}); setBusy(false);
    if (i + 1 >= items.length) load(only); else setI(i + 1);
  }

  /* 키보드로 빨리 넘깁니다 — 200건을 마우스로 하면 손목이 남지 않습니다.
     O 맞음 · X 틀림 · ? 애매 */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "o" || e.key === "O") send(cur?.pred_visit ?? null, false);
      if (e.key === "x" || e.key === "X") send(!(cur?.pred_visit ?? false), false);
      if (e.key === "?" || e.key === "/") send(null, true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // cur 가 바뀔 때만 다시 답니다 — 의존성을 비우면 렌더마다 붙였다 뗍니다
  }, [cur, items.length, i, mine, busy]);

  return (
    <div className="max-w-[900px] flex flex-col gap-4">
      <section className="rounded-xl p-4 flex flex-wrap items-center gap-4"
               style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        <div>
          <h1 className="text-xs font-semibold mb-0.5">AI 결과 검수</h1>
          <p className="text-[10.5px]" style={{ color: "var(--ink-3)" }}>
            분류기 판정이 맞는지 확인합니다. 이 숫자가 발표의 정확도 근거가 됩니다.
          </p>
        </div>
        <div className="ml-auto flex gap-4 tabular-nums">
          {[["정밀도", pct(acc?.precision ?? null)], ["재현율", pct(acc?.recall ?? null)],
            ["F1", pct(acc?.f1 ?? null)], ["검수", `${acc?.n ?? 0}건`],
            ["이번 세션", `${done}건`]].map(([k, v]) => (
            <div key={k} className="text-center">
              <div className="text-[14px] font-semibold">{v}</div>
              <div className="text-[9.5px]" style={{ color: "var(--ink-3)" }}>{k}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex gap-1.5">
        {([["all", "전체"], ["visit", "방문이라 판정한 것"], ["nonvisit", "방문이 아니라 판정한 것"]] as const)
          .map(([k, label]) => (
          <button key={k} onClick={() => setOnly(k)}
                  className="text-[11px] px-3 py-1.5 rounded-lg"
                  style={{ background: only === k ? "var(--ink)" : "var(--surface)",
                           color: only === k ? "#fff" : "var(--ink-2)",
                           border: "1px solid var(--line)" }}>{label}</button>
        ))}
      </div>

      {!cur ? (
        <section className="rounded-xl p-8 text-center text-[12px]"
                 style={{ background: "var(--surface)", color: "var(--ink-2)" }}>
          검수할 댓글을 다 봤습니다. 필터를 바꾸면 다른 묶음이 나옵니다.
        </section>
      ) : (
        <section className="rounded-xl p-5"
                 style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
          <p className="text-[10.5px] mb-2" style={{ color: "var(--ink-3)" }}>
            {cur.creator} · {cur.store_name ?? "가게 미연결"} · 좋아요 {cur.likes}
            {cur.published_at ? ` · ${String(cur.published_at).slice(0, 10)}` : ""}
            <span className="ml-2">({i + 1}/{items.length})</span>
          </p>
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap mb-4">{cur.body}</p>

          <div className="rounded-lg p-3 mb-4" style={{ background: "var(--surface-2)" }}>
            <p className="text-[10.5px] mb-2" style={{ color: "var(--ink-3)" }}>분류기 판정</p>
            <p className="text-[12px] mb-2">
              방문 경험:{" "}
              <b style={{ color: cur.pred_visit ? "var(--good)" : "var(--ink-2)" }}>
                {cur.pred_visit ? "있다고 봤습니다" : "없다고 봤습니다"}
              </b>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(cur.pred_aspects ?? []).length === 0
                ? <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>찾은 항목 없음</span>
                : cur.pred_aspects.map(x => (
                  <span key={x.a} className="text-[11px] px-2 py-0.5 rounded"
                        style={{ background: "var(--surface)",
                                 color: x.p > 0 ? "var(--good)" : "var(--bad)",
                                 border: "1px solid var(--line)" }}>
                    {x.a} {x.p > 0 ? "긍정" : "부정"}
                  </span>
                ))}
            </div>
          </div>

          <p className="text-[10.5px] mb-1.5" style={{ color: "var(--ink-3)" }}>
            항목을 고칠 때만 누르세요 (안 누르면 위 판정에 동의한 것으로 저장됩니다)
          </p>
          <div className="flex flex-wrap gap-1.5 mb-5">
            {ASPECTS.map(a => {
              const v = mine[a];
              return (
                <span key={a} className="inline-flex rounded-lg overflow-hidden"
                      style={{ border: "1px solid var(--line)" }}>
                  <span className="text-[11px] px-2 py-1" style={{ background: "var(--surface-2)" }}>{a}</span>
                  <button onClick={() => setMine(m => ({ ...m, [a]: v === 1 ? 0 : 1 }))}
                          className="text-[11px] px-2 py-1"
                          style={{ background: v === 1 ? "var(--good)" : "var(--surface)",
                                   color: v === 1 ? "#fff" : "var(--ink-2)" }}>＋</button>
                  <button onClick={() => setMine(m => ({ ...m, [a]: v === -1 ? 0 : -1 }))}
                          className="text-[11px] px-2 py-1"
                          style={{ background: v === -1 ? "var(--bad)" : "var(--surface)",
                                   color: v === -1 ? "#fff" : "var(--ink-2)" }}>－</button>
                </span>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => send(cur.pred_visit, false)}
                    className="text-[12px] font-semibold px-4 py-2 rounded-lg"
                    style={{ background: "var(--accent)", color: "#fff" }}>
              맞습니다 <kbd className="opacity-60 ml-1">O</kbd>
            </button>
            <button disabled={busy} onClick={() => send(!cur.pred_visit, false)}
                    className="text-[12px] font-semibold px-4 py-2 rounded-lg"
                    style={{ background: "var(--bad)", color: "#fff" }}>
              방문 판정이 틀렸습니다 <kbd className="opacity-60 ml-1">X</kbd>
            </button>
            <button disabled={busy} onClick={() => send(null, true)}
                    className="text-[12px] px-4 py-2 rounded-lg"
                    style={{ background: "var(--surface)", color: "var(--ink-2)",
                             border: "1px solid var(--line)" }}>
              애매합니다 <kbd className="opacity-60 ml-1">?</kbd>
            </button>
          </div>
          <p className="text-[10px] mt-3" style={{ color: "var(--ink-3)" }}>
            &apos;애매합니다&apos;는 채점에서 빼고 따로 셉니다 — 정답이 없는 걸로 재면 점수가 왜곡됩니다.
          </p>
        </section>
      )}
    </div>
  );
}
