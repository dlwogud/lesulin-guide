"use client";
import { useCallback, useEffect, useState } from "react";

type Item = {
  id: number; at: string; kind: string; body: string | null; status: string;
  memo: string | null; handled_at: string | null;
  store_id: string | null; store_name: string | null; store_region: string | null;
  handler: string | null;
};

const KIND: Record<string, string> = {
  wrong_place: "위치가 틀림", closed: "폐업·휴업", wrong_video: "영상 연결 오류",
  wrong_score: "점수·배지 이상", other: "기타",
};
const ST: Record<string, string> = {
  open: "접수", doing: "확인 중", done: "처리 완료", rejected: "반영 안 함",
};
const STC: Record<string, string> = {
  open: "var(--bad)", doing: "var(--warn)", done: "var(--good)", rejected: "var(--ink-3)",
};

export default function Feedback() {
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [flt, setFlt] = useState("all");

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/feedback?status=${flt}`);
    const d = await r.json();
    setItems(d.items ?? []);
    const c: Record<string, number> = {};
    for (const x of d.counts ?? []) c[x.status] = x.n;
    setCounts(c);
  }, [flt]);
  useEffect(() => { load(); }, [load]);

  async function move(it: Item, status: string) {
    const memo = status === "rejected" || status === "done"
      ? prompt(status === "done" ? "어떻게 처리했나요? (이력에 남습니다)"
                                 : "왜 반영하지 않나요?", it.memo ?? "") ?? ""
      : it.memo ?? "";
    await fetch(`/api/admin/feedback/${it.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, memo }),
    });
    load();
  }

  return (
    <div className="flex flex-col gap-4 max-w-[1000px]">
      <section className="rounded-xl p-4" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        <h1 className="text-xs font-semibold mb-0.5">피드백·신고 관리</h1>
        <p className="text-[10.5px] mb-3" style={{ color: "var(--ink-3)" }}>
          사용자가 식당 상세에서 보낸 오류 신고입니다. 상태를 바꾸면 갱신 이력에 남습니다.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {["all", "open", "doing", "done", "rejected"].map(k => (
            <button key={k} onClick={() => setFlt(k)} className="text-[11px] px-3 py-1.5 rounded-lg"
                    style={{ background: flt === k ? "var(--ink)" : "var(--surface)",
                             color: flt === k ? "#fff" : "var(--ink-2)",
                             border: "1px solid var(--line)" }}>
              {k === "all" ? "전체" : ST[k]}
              {k !== "all" && counts[k] ? ` ${counts[k]}` : ""}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl overflow-hidden"
               style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        {items.length === 0 ? (
          <p className="p-7 text-[11.5px] text-center leading-relaxed" style={{ color: "var(--ink-3)" }}>
            아직 신고가 없습니다.<br />
            사용자 화면에서 식당을 열고 <b>정보가 틀렸어요</b>를 누르면 여기로 들어옵니다.
          </p>
        ) : items.map(it => (
          <div key={it.id} className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: "var(--surface-2)", color: STC[it.status] }}>
                {ST[it.status] ?? it.status}
              </span>
              <span className="text-[11.5px] font-medium">{KIND[it.kind] ?? it.kind}</span>
              {it.store_name && (
                <span className="text-[11px]" style={{ color: "var(--ink-2)" }}>
                  · {it.store_name}
                  <span style={{ color: "var(--ink-3)" }}>
                    {" "}{it.store_region?.replace(/(특별자치도|특별자치시|특별시|광역시|도)$/, "")}
                  </span>
                </span>
              )}
              <span className="ml-auto text-[10px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                {new Date(it.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul",
                  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            {it.body && (
              <p className="text-[12px] leading-relaxed mb-2 whitespace-pre-wrap">{it.body}</p>
            )}
            {it.memo && (
              <p className="text-[10.5px] mb-2 rounded px-2 py-1"
                 style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>
                처리 메모: {it.memo}{it.handler ? ` — ${it.handler}` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {it.store_id && (
                <a href={`/admin/data?q=${encodeURIComponent(it.store_name ?? "")}`}
                   className="text-[10.5px] px-2.5 py-1 rounded-lg"
                   style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                  데이터 관리에서 열기
                </a>
              )}
              {(["doing", "done", "rejected", "open"] as const)
                .filter(s => s !== it.status)
                .map(s => (
                <button key={s} onClick={() => move(it, s)}
                        className="text-[10.5px] px-2.5 py-1 rounded-lg"
                        style={{ border: "1px solid var(--line)",
                                 color: s === "done" ? "var(--accent-ink)" : "var(--ink-2)" }}>
                  {ST[s]}로
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
