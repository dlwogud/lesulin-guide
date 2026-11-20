"use client";
import { useCallback, useEffect, useState } from "react";

type M = { tp: number; fp: number; fn: number; tn: number; P: number | null; R: number | null; F: number | null;
  weighted?: { P: number | null; R: number | null; F: number | null } | null; llm_ratio: number;
  usage: { calls: number; input_tokens: number; output_tokens: number; cost_usd: number; llm_ms_sum: number; llm_ms_avg: number };
  time_ms?: number; unsure?: number; rule_fallback?: number };
type EvalRes = { set: string; n: number; sample: string; versions: Record<string, string>; run_at: string;
  methods: { rule: M; llm: M; hybrid: M }; llm_wall_ms: number; evidence_not_in_comment: number };
type Llm = { id: number; label: string | null; evidence: string | null; evidence_ok: boolean | null; reason: string | null; model: string;
  prompt_version: string; input_tokens: number | null; output_tokens: number | null; cost_usd: string | null; ms: number | null; purpose: string; created_at: string; error: string | null };
type Case = { comment_id: number; body: string; likes: number; store_id: string | null; store: string | null; video: string | null;
  rule_visit: boolean; routed: boolean; why: string[]; llm: Llm | null; hybrid: { visit: boolean; source: string }; applied: boolean;
  human: { is_visit: boolean; reason: string | null; created_at: string; reviewer: string | null } | null;
  demo?: { kind: string; note: string; truth?: string } };
type Live = { id: number; at: string; error: string | null; rule: boolean; routed: boolean; why: string[]; hybrid: { visit: boolean; source: string };
  judgment: { label: string; evidence: string; evidenceOk: boolean; reason: string; model: string; promptVersion: string;
    inputTokens: number; outputTokens: number; costUsd: number | null; ms: number; requestId?: string } | null };
type Applied = { visit: Record<string, number>; llm: Record<string, string>; summaries: Record<string, string> };

const pct = (x: number | null | undefined) => (x == null ? "—" : (100 * x).toFixed(1) + "%");
const yn = (v: boolean | null | undefined) => (v == null ? "—" : v ? "방문" : "아님");
const LBL: Record<string, string> = { yes: "방문", no: "아님", unsure: "판단 어려움" };
const card = { background: "var(--surface)", boxShadow: "var(--shadow-sm)" } as const;
const muted = { color: "var(--ink-3)" } as const;

function Mark({ text, ev }: { text: string; ev?: string | null }) {
  if (!ev) return <>{text}</>;
  const i = text.indexOf(ev);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark style={{ background: "#FFE7A3", padding: "0 1px" }}>{ev}</mark>{text.slice(i + ev.length)}</>;
}

function Table({ r, title }: { r: EvalRes; title: string }) {
  const rows: [string, M][] = [["규칙", r.methods.rule], ["LLM", r.methods.llm], ["혼합", r.methods.hybrid]];
  const w = !!r.methods.rule.weighted;
  return (
    <div className="overflow-x-auto">
      <p className="text-[11px] font-semibold mb-1">{title}</p>
      <p className="text-[10.5px] mb-2" style={muted}>{r.sample} · {r.versions.llm} · 프롬프트 {r.versions.prompt} · 분기 {r.versions.route} · {new Date(r.run_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
      <table className="text-[11.5px] tabular-nums w-full" style={{ borderCollapse: "collapse" }}>
        <thead><tr style={muted}>
          {["방식", "n", "TP/FP/FN/TN", "정밀도", "재현율", "F1", ...(w ? ["가중 정밀도", "가중 재현율", "가중 F1"] : []), "LLM 전송", "입력/출력 토큰", "비용", "LLM 평균"].map((h) =>
            <th key={h} className="text-left font-normal py-1 pr-3" style={{ borderBottom: "1px solid var(--line)" }}>{h}</th>)}
        </tr></thead>
        <tbody>{rows.map(([n, m]) => (
          <tr key={n} style={{ fontWeight: n === "혼합" ? 600 : 400 }}>
            <td className="py-1 pr-3">{n}</td><td className="pr-3">{r.n}</td><td className="pr-3">{m.tp}/{m.fp}/{m.fn}/{m.tn}</td>
            <td className="pr-3">{pct(m.P)}</td><td className="pr-3">{pct(m.R)}</td><td className="pr-3">{pct(m.F)}</td>
            {w && <><td className="pr-3">{pct(m.weighted?.P)}</td><td className="pr-3">{pct(m.weighted?.R)}</td><td className="pr-3">{pct(m.weighted?.F)}</td></>}
            <td className="pr-3">{pct(m.llm_ratio)} ({m.usage.calls})</td><td className="pr-3">{m.usage.input_tokens.toLocaleString()}/{m.usage.output_tokens.toLocaleString()}</td>
            <td className="pr-3">${m.usage.cost_usd.toFixed(4)}</td><td className="pr-3">{m.usage.llm_ms_avg ? `${m.usage.llm_ms_avg}ms` : `${(m.time_ms ?? 0).toFixed(1)}ms 전체`}</td>
          </tr>))}</tbody>
      </table>
      <p className="text-[10.5px] mt-1.5" style={muted}>
        LLM 판단 어려움 {r.methods.llm.unsure ?? 0}건(아니오로 셈) · 혼합에서 규칙으로 돌아감 {r.methods.hybrid.rule_fallback ?? 0}건 · 근거 구절이 원문에 없음 {r.evidence_not_in_comment}건
        {w && " · 가중값은 방문/비방문 쪽 모집단 크기로 보정한 추정치(비방문 쪽 1건 ≈ 댓글 6천 건이라 오차 큼)"}
      </p>
    </div>
  );
}

type SumItem = { store_id: string; name: string; status: string; lines: { kind: string; text: string; commentIds: number[] }[]; n_evidence: number;
  model: string | null; cost_usd: string | null; created_at: string; reviewed_at: string | null; review: { line: number; ok: boolean; note: string }[] | null; reviewer: string | null };
const KIND: Record<string, string> = { good: "좋았다는 점", bad: "아쉬웠다는 점", tip: "가기 전에" };

function SummaryReview() {
  const [d, setD] = useState<{ items: SumItem[]; comments: Record<number, string> } | null>(null);
  const [draft, setDraft] = useState<Record<string, { ok: boolean; note: string }[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await fetch("/api/admin/compare/summary"); if (r.ok) setD(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const get = (s: SumItem) => draft[s.store_id] ?? s.lines.map((_, i) => ({ ok: s.review?.[i]?.ok ?? true, note: s.review?.[i]?.note ?? "" }));
  async function save(s: SumItem) {
    await fetch("/api/admin/compare/summary", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId: s.store_id, review: get(s).map((r, i) => ({ line: i, ...r })) }) });
    load();
  }
  return (
    <section className="rounded-xl p-4" style={card}>
      <h2 className="text-xs font-semibold mb-1">근거 요약 검수 — 요약 줄과 근거 댓글 원문 대조</h2>
      <p className="text-[10.5px] mb-3" style={muted}>{d.items.filter((s) => s.reviewed_at).length}/{d.items.length}곳 검수</p>
      <ul className="flex flex-col gap-2">
        {d.items.map((s) => (
          <li key={s.store_id} className="rounded-lg" style={{ border: "1px solid var(--line)" }}>
            <button onClick={() => setOpen(open === s.store_id ? null : s.store_id)} className="w-full text-left px-3 py-2 text-[12px] flex gap-2">
              <b>{s.name}</b><span style={muted}>{s.status === "ok" ? `${s.lines.length}줄 · 근거 후보 ${s.n_evidence}개` : "방문 언급 댓글 부족"}</span>
              <span className="ml-auto text-[10.5px]" style={{ color: s.reviewed_at ? "var(--good)" : "var(--ink-3)" }}>
                {s.reviewed_at ? `검수함 · ${s.reviewer} · ${s.review?.filter((r) => !r.ok).length ? `고칠 것 ${s.review?.filter((r) => !r.ok).length}` : "모두 맞음"}` : "미검수"}</span>
            </button>
            {open === s.store_id && (
              <div className="px-3 pb-3 flex flex-col gap-2">
                {s.lines.map((l, i) => (
                  <div key={i} className="rounded p-2" style={{ background: "var(--surface-2)" }}>
                    <p className="text-[12px]"><b>{KIND[l.kind]}</b> — {l.text}</p>
                    <ul className="mt-1 flex flex-col gap-1">{l.commentIds.map((id) => <li key={id} className="text-[11px] leading-relaxed" style={{ color: "var(--ink-2)" }}>#{id} {d.comments[id]}</li>)}</ul>
                    <div className="flex gap-2 mt-1.5 items-center">
                      {[true, false].map((ok) => (
                        <button key={String(ok)} onClick={() => setDraft((x) => ({ ...x, [s.store_id]: get(s).map((r, k) => (k === i ? { ...r, ok } : r)) }))}
                          className="text-[11px] px-2.5 py-1 rounded" style={{ border: "1px solid var(--line)", background: get(s)[i]?.ok === ok ? (ok ? "#E3F4EC" : "#FDECEA") : undefined }}>
                          {ok ? "원문과 맞음" : "고칠 것"}</button>))}
                      <input value={get(s)[i]?.note ?? ""} onChange={(e) => setDraft((x) => ({ ...x, [s.store_id]: get(s).map((r, k) => (k === i ? { ...r, note: e.target.value } : r)) }))}
                        placeholder="메모" className="flex-1 rounded px-2 py-1 text-[11px]" style={{ border: "1px solid var(--line)" }} />
                    </div>
                  </div>))}
                <button onClick={() => save(s)} className="self-end text-[11.5px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: "var(--accent)", color: "#fff" }}>검수 저장</button>
                <p className="text-[10px]" style={muted}>{s.model} · {new Date(s.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 생성 · ${Number(s.cost_usd ?? 0).toFixed(4)}</p>
              </div>)}
          </li>))}
      </ul>
    </section>
  );
}

export default function Compare() {
  const [data, setData] = useState<{ eval: EvalRes; dev: EvalRes; cases: Case[]; applied: Applied } | null>(null);
  const [err, setErr] = useState("");
  const [live, setLive] = useState<Record<number, Live | { error: string }>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const [free, setFree] = useState({ text: "", store: "" });
  const [freeRes, setFreeRes] = useState<Live | { error: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/compare");
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || "불러오지 못했습니다"); return; }
    setData(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runLive(body: Record<string, unknown>, key: number) {
    setBusy(key);
    const r = await fetch("/api/admin/compare/llm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({ error: "응답을 읽지 못했습니다" }));
    if (key === -1) setFreeRes(d); else setLive((s) => ({ ...s, [key]: d }));
    setBusy(null);
  }
  async function review(cid: number, isVisit: boolean) {
    const reason = (note[cid] || "").trim();
    if (!reason) { setLive((s) => ({ ...s, [cid]: { error: "판정 이유를 적어 주세요" } })); return; }
    const r = await fetch("/api/admin/compare/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commentId: cid, isVisit, reason }) });
    if (r.ok) { setNote((n) => ({ ...n, [cid]: "" })); load(); }
  }

  if (err) return <p className="text-sm" style={{ color: "var(--bad)" }}>{err}</p>;
  if (!data) return <p className="text-sm" style={muted}>불러오는 중…</p>;
  const a = data.applied;

  const LiveBox = ({ l }: { l: Live | { error: string } }) => "judgment" in l && l.judgment ? (
    <div className="rounded-lg p-2.5 mt-2 text-[11.5px]" style={{ background: "#EEF4FF", border: "1px solid #C9DAFB" }}>
      <p className="text-[10.5px] mb-1 tabular-nums" style={muted}>
        방금 실제 호출 · {l.judgment.model} · {l.judgment.promptVersion} · {l.judgment.ms}ms · 토큰 {l.judgment.inputTokens}/{l.judgment.outputTokens} · ${l.judgment.costUsd?.toFixed(5)}
        {l.judgment.requestId ? ` · ${l.judgment.requestId}` : ""} · 기록 #{l.id}
      </p>
      <p><b>LLM {LBL[l.judgment.label]}</b> — {l.judgment.reason} {!l.judgment.evidenceOk && <span style={{ color: "var(--bad)" }}>(근거 구절이 원문에 없음)</span>}</p>
      {l.judgment.evidence && <p style={muted}>근거: “{l.judgment.evidence}”</p>}
      <p className="mt-1" style={muted}>혼합 최종: {yn(l.hybrid.visit)} ({l.hybrid.source === "llm" ? "LLM 판정" : l.hybrid.source === "rule" ? "규칙(LLM 보낼 조건 아님)" : "규칙으로 돌아감"})</p>
    </div>
  ) : <p className="text-[11.5px] mt-2" style={{ color: "var(--bad)" }}>호출 실패: {"error" in l ? l.error : ""} — 규칙 판정({yn("rule" in l ? (l as Live).rule : null)})은 그대로 씁니다</p>;

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      <section className="rounded-xl p-4" style={card}>
        <h1 className="text-xs font-semibold mb-3">규칙 · LLM · 혼합 — 방문 경험 언급 분류 비교</h1>
        <Table r={data.eval} title="평가용 표본 (2차 · 조정에 쓰지 않음)" />
        <details className="mt-3"><summary className="text-[11px] cursor-pointer" style={muted}>개발용 표본 (1차 · 프롬프트·분기 조건을 만든 표본)</summary>
          <div className="mt-2"><Table r={data.dev} title="개발용 표본" /></div></details>
      </section>

      <section className="rounded-xl p-4" style={card}>
        <h2 className="text-xs font-semibold mb-2">서비스 적용 범위</h2>
        <dl className="grid grid-cols-2 md:grid-cols-6 gap-3 tabular-nums">
          {[["AI 적용 식당", `${a.visit.stores}곳`], ["판정한 댓글", a.visit.comments?.toLocaleString()], ["LLM 으로 보냄", `${a.visit.routed} (${a.visit.comments ? ((100 * a.visit.routed) / a.visit.comments).toFixed(1) : 0}%)`],
            ["규칙 방문 → 혼합 방문", `${a.visit.rule_visit} → ${a.visit.final_visit}`], ["LLM 비용", `$${a.llm.cost_usd}`], ["근거 요약", `${a.summaries.ok}/${a.summaries.n}곳 · 검수 ${a.summaries.reviewed}`]].map(([k, v]) => (
            <div key={k as string}><dd className="text-[14px] font-semibold">{v}</dd><dt className="text-[10px]" style={muted}>{k}</dt></div>))}
        </dl>
        <p className="text-[10.5px] mt-2" style={muted}>나머지 식당은 규칙 판정만 있습니다.</p>
      </section>

      <SummaryReview />

      <section className="rounded-xl p-4" style={card}>
        <h2 className="text-xs font-semibold mb-2">직접 넣어 보기</h2>
        <div className="flex flex-col md:flex-row gap-2">
          <input value={free.store} onChange={(e) => setFree({ ...free, store: e.target.value })} placeholder="식당 이름" className="rounded-lg px-3 py-2 text-[12.5px] md:w-48" style={{ border: "1px solid var(--line)" }} />
          <input value={free.text} onChange={(e) => setFree({ ...free, text: e.target.value })} placeholder="댓글" className="rounded-lg px-3 py-2 text-[12.5px] flex-1" style={{ border: "1px solid var(--line)" }} />
          <button onClick={() => runLive(free, -1)} disabled={busy === -1 || !free.text || !free.store} className="text-[12px] font-semibold px-4 py-2 rounded-lg" style={{ background: "var(--accent)", color: "#fff", opacity: busy === -1 ? 0.6 : 1 }}>
            {busy === -1 ? "호출 중…" : "LLM으로 분석"}</button>
        </div>
        {freeRes && <LiveBox l={freeRes} />}
      </section>

      <section className="rounded-xl p-4" style={card}>
        <h2 className="text-xs font-semibold mb-3">댓글별 판정 — 시연 사례 · 시연 식당에서 규칙과 LLM 이 엇갈린 댓글</h2>
        <ul className="flex flex-col gap-3">
          {data.cases.map((c) => {
            const l = live[c.comment_id];
            return (
              <li key={c.comment_id} className="rounded-lg p-3" style={{ border: "1px solid var(--line)", background: c.demo ? "#FFFBF2" : undefined }}>
                <p className="text-[10.5px] mb-1" style={muted}>
                  {c.demo && <b style={{ color: "var(--accent)" }}>{c.demo.kind} · 1차 표본(성능 측정 제외) · </b>}
                  #{c.comment_id} · {c.store} · {c.video?.slice(0, 50)} {c.applied && "· AI 적용 식당"}
                </p>
                <p className="text-[12.5px] leading-relaxed mb-2"><Mark text={c.body} ev={c.llm?.evidence} /></p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11.5px]">
                  <div className="rounded p-2" style={{ background: "var(--surface-2)" }}><p style={muted}>규칙</p><b>{yn(c.rule_visit)}</b>
                    <p className="text-[10.5px]" style={muted}>{c.routed ? `LLM 보냄: ${c.why.join(", ")}` : "명확 — LLM 안 보냄"}</p></div>
                  <div className="rounded p-2" style={{ background: "var(--surface-2)" }}><p style={muted}>LLM (저장된 판정)</p>
                    <b>{c.llm?.label ? LBL[c.llm.label] : "—"}</b>
                    {c.llm && <p className="text-[10.5px]" style={muted}>{c.llm.reason} · {c.llm.purpose === "admin_live" ? "실시간 호출" : "적용 실행"} {c.llm.ms}ms</p>}</div>
                  <div className="rounded p-2" style={{ background: "var(--surface-2)" }}><p style={muted}>혼합 최종</p><b>{yn(c.hybrid.visit)}</b>
                    <p className="text-[10.5px]" style={muted}>{c.hybrid.source === "llm" ? "LLM 판정 사용" : c.hybrid.source === "rule" ? "규칙 판정 사용" : "규칙으로 돌아감"}</p></div>
                  <div className="rounded p-2" style={{ background: "var(--surface-2)" }}><p style={muted}>사람</p>
                    <b>{c.human ? yn(c.human.is_visit) : c.demo?.truth ? `${c.demo.truth === "O" ? "방문" : "아님"} (1차 라벨)` : "미검수"}</b>
                    {c.human && <p className="text-[10.5px]" style={muted}>{c.human.reason} · {c.human.reviewer} · {new Date(c.human.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>}</div>
                </div>
                {c.demo && <p className="text-[10.5px] mt-1.5" style={muted}>{c.demo.note}</p>}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <button onClick={() => runLive({ commentId: c.comment_id }, c.comment_id)} disabled={busy === c.comment_id}
                    className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: "var(--accent)", color: "#fff", opacity: busy === c.comment_id ? 0.6 : 1 }}>
                    {busy === c.comment_id ? "호출 중…" : "LLM으로 다시 분석"}</button>
                  <input value={note[c.comment_id] || ""} onChange={(e) => setNote((n) => ({ ...n, [c.comment_id]: e.target.value }))} placeholder="사람 판정 이유"
                    className="rounded-lg px-2.5 py-1.5 text-[11.5px] flex-1 min-w-[160px]" style={{ border: "1px solid var(--line)" }} />
                  <button onClick={() => review(c.comment_id, true)} className="text-[11.5px] px-3 py-1.5 rounded-lg" style={{ border: "1px solid var(--line)" }}>방문 맞음</button>
                  <button onClick={() => review(c.comment_id, false)} className="text-[11.5px] px-3 py-1.5 rounded-lg" style={{ border: "1px solid var(--line)" }}>방문 아님</button>
                </div>
                {l && <LiveBox l={l} />}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
