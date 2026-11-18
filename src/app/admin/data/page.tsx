"use client";
import { useCallback, useEffect, useState } from "react";

type Store = {
  id: string; name: string; address: string | null; region: string; category: string | null;
  hidden: boolean; hide_note: string | null; comments_used: number | null; visits: number | null;
  guide_level: number | null; level_override: number | null; videos: number;
  creators: string | null; coord_source: string | null; updated_at: string;
};
type Log = {
  id: number; at: string; action: string; entity: string; entity_id: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  admin_email: string | null;
};
type Video = { id: string; title: string; published_at: string | null; creator: string };

const LVL: Record<number, string> = { 1: "들러볼 곳", 2: "우회해도 갈 곳", 3: "이곳을 위해" };
const ACT: Record<string, string> = {
  update: "수정", hide: "가림", restore: "복구", unlink: "영상 연결 해제", merge: "중복 합침",
};

export default function DataManage() {
  const [rows, setRows] = useState<Store[]>([]);
  const [log, setLog] = useState<Log[]>([]);
  const [regs, setRegs] = useState<{ region: string; n: number }[]>([]);
  const [term, setTerm] = useState("");
  const [region, setRegion] = useState("");
  const [flt, setFlt] = useState<"all" | "hidden" | "badged">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [vids, setVids] = useState<Video[]>([]);
  const [form, setForm] = useState<Partial<Store> & { hideNote?: string }>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (term.trim()) p.set("q", term.trim());
    if (region) p.set("region", region);
    if (flt === "hidden") p.set("hidden", "1");
    if (flt === "badged") p.set("badged", "1");
    const r = await fetch(`/api/admin/stores?${p}`);
    const d = await r.json();
    setRows(d.stores ?? []); setLog(d.log ?? []); setRegs(d.regions ?? []);
  }, [term, region, flt]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function openRow(s: Store) {
    if (open === s.id) { setOpen(null); return; }
    setOpen(s.id);
    setForm({ name: s.name, address: s.address, category: s.category,
              level_override: s.level_override, hidden: s.hidden,
              hideNote: s.hide_note ?? "" });
    const r = await fetch(`/api/admin/stores/${s.id}`);
    setVids((await r.json()).videos ?? []);
  }

  async function save(id: string, patch: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/admin/stores/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "저장하지 못했습니다."); return; }
    setMsg(d.changed ? "저장했습니다. 아래 이력에 남았습니다." : "바뀐 내용이 없습니다.");
    load();
  }

  async function unlink(id: string, vid: string) {
    if (!confirm("이 영상 연결을 끊습니까? 영상 자체는 지우지 않습니다.")) return;
    await fetch(`/api/admin/stores/${id}?video=${vid}`, { method: "DELETE" });
    setVids(v => v.filter(x => x.id !== vid));
    load();
  }

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      <section className="rounded-xl p-4" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        <h1 className="text-xs font-semibold mb-0.5">데이터·콘텐츠 관리</h1>
        <p className="text-[10.5px] mb-3" style={{ color: "var(--ink-3)" }}>
          식당 정보 수정 · 배지 조정 · 지도에서 가리기 · 잘못 붙은 영상 연결 해제.
          모든 변경은 아래 <b>갱신 이력</b>에 남습니다.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={term} onChange={e => setTerm(e.target.value)}
                 placeholder="식당명 · 주소로 검색"
                 className="rounded-lg px-3 py-1.5 text-xs w-56"
                 style={{ border: "1px solid var(--line)" }} />
          <select value={region} onChange={e => setRegion(e.target.value)}
                  className="rounded-lg px-2 py-1.5 text-xs"
                  style={{ border: "1px solid var(--line)" }}>
            <option value="">지역 전체</option>
            {regs.map(r => <option key={r.region} value={r.region}>{r.region} ({r.n})</option>)}
          </select>
          {([["all", "전체"], ["badged", "배지 있는 곳"], ["hidden", "가려둔 곳"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFlt(k)} className="text-[11px] px-3 py-1.5 rounded-lg"
                    style={{ background: flt === k ? "var(--ink)" : "var(--surface)",
                             color: flt === k ? "#fff" : "var(--ink-2)",
                             border: "1px solid var(--line)" }}>{l}</button>
          ))}
          <span className="ml-auto text-[10.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>
            {rows.length}곳 표시
          </span>
        </div>
        {msg && <p className="text-[11px] mt-2" style={{ color: "var(--accent-ink)" }}>{msg}</p>}
      </section>

      <section className="rounded-xl overflow-hidden"
               style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        {rows.length === 0 && (
          <p className="p-6 text-[11.5px] text-center" style={{ color: "var(--ink-3)" }}>
            조건에 맞는 식당이 없습니다.
          </p>
        )}
        {rows.map(s => {
          const lv = s.level_override ?? s.guide_level;
          return (
            <div key={s.id} style={{ borderBottom: "1px solid var(--line)" }}>
              <button onClick={() => openRow(s)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-black/[.02]">
                <span className="text-[12px] font-medium truncate"
                      style={{ opacity: s.hidden ? .45 : 1,
                               textDecoration: s.hidden ? "line-through" : "none" }}>
                  {s.name}
                </span>
                {lv && <span className="text-[9.5px] px-1.5 py-0.5 rounded shrink-0"
                              style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
                  {"◆".repeat(lv)}{s.level_override ? " 수동" : ""}
                </span>}
                {s.hidden && <span className="text-[9.5px] px-1.5 py-0.5 rounded shrink-0"
                                   style={{ background: "#F6E7E4", color: "var(--bad)" }}>가림</span>}
                <span className="text-[10.5px] truncate shrink-0" style={{ color: "var(--ink-3)" }}>
                  {s.region.replace(/(특별자치도|특별자치시|특별시|광역시|도)$/, "")}
                </span>
                <span className="ml-auto text-[10.5px] tabular-nums shrink-0" style={{ color: "var(--ink-3)" }}>
                  {s.creators ?? "—"} · 영상 {s.videos} · 반응 {s.comments_used ?? 0}
                </span>
              </button>

              {open === s.id && (
                <div className="px-4 pb-4 pt-1" style={{ background: "var(--surface-2)" }}>
                  <div className="grid md:grid-cols-3 gap-2 mb-2">
                    {([["name", "식당명"], ["address", "주소"], ["category", "업종"]] as const).map(([k, label]) => (
                      <label key={k} className="text-[10px]" style={{ color: "var(--ink-3)" }}>
                        {label}
                        <input value={(form[k] as string) ?? ""}
                               onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                               className="w-full mt-0.5 rounded-lg px-2 py-1.5 text-[12px]"
                               style={{ border: "1px solid var(--line)", background: "var(--surface)" }} />
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] mb-2" style={{ color: "var(--ink-3)" }}>
                    좌표·지역은 수집 파이프라인이 정합니다({s.coord_source ?? "—"}). 여기서 고치면 다음 적재에 덮어써집니다.
                  </p>

                  <div className="flex flex-wrap items-end gap-2 mb-3">
                    <label className="text-[10px]" style={{ color: "var(--ink-3)" }}>
                      배지 수동 조정
                      <select value={String(form.level_override ?? "")}
                              onChange={e => setForm(f => ({ ...f,
                                level_override: e.target.value === "" ? null : Number(e.target.value) }))}
                              className="block mt-0.5 rounded-lg px-2 py-1.5 text-[12px]"
                              style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
                        <option value="">자동 ({s.guide_level ? `${"◆".repeat(s.guide_level)} ${LVL[s.guide_level]}` : "배지 없음"})</option>
                        <option value="0">배지 없음으로 고정</option>
                        {[1, 2, 3].map(n => <option key={n} value={n}>{"◆".repeat(n)} {LVL[n]}</option>)}
                      </select>
                    </label>
                    <button disabled={busy}
                            onClick={() => save(s.id, {
                              name: form.name, address: form.address, category: form.category,
                              levelOverride: form.level_override ?? null,
                            })}
                            className="text-[12px] font-semibold px-4 py-2 rounded-lg"
                            style={{ background: "var(--accent)", color: "#fff" }}>저장</button>
                    <button disabled={busy}
                            onClick={() => {
                              const note = s.hidden ? "" :
                                prompt("왜 가립니까? (폐업 · 중복 · 잘못된 연결 등)") ?? "";
                              if (!s.hidden && !note) return;
                              save(s.id, { hidden: !s.hidden, hideNote: note });
                            }}
                            className="text-[12px] px-4 py-2 rounded-lg"
                            style={{ background: "var(--surface)",
                                     color: s.hidden ? "var(--accent-ink)" : "var(--bad)",
                                     border: "1px solid var(--line)" }}>
                      {s.hidden ? "지도에 다시 보이기" : "지도에서 가리기"}
                    </button>
                    {s.hidden && s.hide_note && (
                      <span className="text-[10.5px]" style={{ color: "var(--ink-3)" }}>사유: {s.hide_note}</span>
                    )}
                  </div>

                  <p className="text-[10px] mb-1" style={{ color: "var(--ink-3)" }}>
                    연결된 영상 {vids.length}편 — 잘못 붙은 것만 끊으세요
                  </p>
                  <ul className="flex flex-col gap-1">
                    {vids.map(v => (
                      <li key={v.id} className="flex items-center gap-2 text-[11px]">
                        <span className="shrink-0" style={{ color: "var(--ink-3)" }}>{v.creator}</span>
                        <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank"
                           rel="noreferrer" className="truncate hover:underline">{v.title}</a>
                        <button onClick={() => unlink(s.id, v.id)}
                                className="ml-auto shrink-0 text-[10.5px] underline"
                                style={{ color: "var(--bad)" }}>연결 해제</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="rounded-xl p-4" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-xs font-semibold mb-2">갱신 이력</h2>
        {log.length === 0 ? (
          <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
            아직 변경 기록이 없습니다. 위에서 무엇이든 고치면 여기 남습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {log.map(l => (
              <li key={l.id} className="text-[11px] flex flex-wrap gap-x-2">
                <span className="tabular-nums shrink-0" style={{ color: "var(--ink-3)" }}>
                  {new Date(l.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul",
                    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="shrink-0" style={{ color: "var(--accent-ink)" }}>
                  {ACT[l.action] ?? l.action}
                </span>
                <span className="shrink-0" style={{ color: "var(--ink-3)" }}>{l.entity_id}</span>
                <span style={{ color: "var(--ink-2)" }}>
                  {Object.keys(l.after ?? {}).map(k =>
                    `${k}: ${JSON.stringify(l.before?.[k]) ?? "—"} → ${JSON.stringify(l.after?.[k])}`
                  ).join(", ") || (l.before ? JSON.stringify(l.before) : "")}
                </span>
                <span className="ml-auto shrink-0" style={{ color: "var(--ink-3)" }}>{l.admin_email}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
