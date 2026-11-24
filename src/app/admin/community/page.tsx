"use client";
import { useCallback, useEffect, useState } from "react";

type Post = {
  id: string; body: string; place: string | null; created_at: string; edited_at: string | null;
  hidden: boolean; store_name: string | null;
};
type Reply = { id: string; poll_id: string; body: string; created_at: string; edited_at: string | null; hidden: boolean };

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", {
  timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function Community() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);   // 삭제를 한 번 누른 버튼 — 한 번 더 눌러야 지웁니다

  const load = useCallback(async () => {
    const d = await (await fetch("/api/admin/community")).json();
    setPosts(d.polls ?? []); setReplies(d.replies ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(target: "poll" | "reply", id: string, hidden: boolean) {
    setBusy(`${target}${id}`);
    await fetch(`/api/admin/community/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, hidden }),
    });
    setBusy(null); load();
  }

  async function remove(target: "poll" | "reply", id: string) {
    setBusy(`${target}${id}`);
    await fetch(`/api/admin/community/${id}?target=${target}`, { method: "DELETE" });
    setBusy(null); setArmed(null); load();
  }

  const btn = (target: "poll" | "reply", id: string, hidden: boolean) => {
    const key = `${target}${id}`;
    const on = armed === key;
    return (
      <div className="flex gap-1.5 shrink-0">
        <button onClick={() => toggle(target, id, !hidden)} disabled={busy === key}
                className="text-[10.5px] px-2.5 py-1 rounded-lg"
                style={{ border: "1px solid var(--line)", color: hidden ? "var(--accent-ink)" : "var(--ink-2)" }}>
          {hidden ? "다시 보이기" : "숨기기"}
        </button>
        <button onClick={() => (on ? remove(target, id) : setArmed(key))} onBlur={() => on && setArmed(null)}
                disabled={busy === key}
                className="text-[10.5px] px-2.5 py-1 rounded-lg"
                style={on ? { background: "var(--bad)", color: "#fff", border: "1px solid var(--bad)" }
                          : { border: "1px solid var(--line)", color: "var(--bad)" }}>
          {on ? (target === "poll" ? "답글까지 삭제" : "정말 삭제") : "삭제"}
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 max-w-[1000px]">
      <section className="rounded-xl p-4" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        <h1 className="text-xs font-semibold">커뮤니티 관리</h1>
      </section>

      <section className="rounded-xl overflow-hidden" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        {posts.length === 0 ? (
          <p className="p-7 text-[11.5px] text-center" style={{ color: "var(--ink-3)" }}>아직 올라온 글이 없습니다.</p>
        ) : posts.map(p => (
          <div key={p.id} className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)", opacity: p.hidden ? 0.55 : 1 }}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[10.5px] mb-1" style={{ color: "var(--ink-3)" }}>
                  <span className="tabular-nums">#{p.id} · {when(p.created_at)}{p.edited_at ? " · 수정됨" : ""}</span>
                  {p.store_name && <span>· {p.store_name}</span>}
                  {p.place && <span>· {p.place}</span>}
                  {p.hidden && <span style={{ color: "var(--bad)" }}>· 숨김</span>}
                </div>
                <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{p.body}</p>
              </div>
              {btn("poll", p.id, p.hidden)}
            </div>
            {replies.filter(r => r.poll_id === p.id).map(r => (
              <div key={r.id} className="flex items-start gap-3 mt-2 ml-4 pl-3"
                   style={{ borderLeft: "2px solid var(--line)", opacity: r.hidden ? 0.55 : 1 }}>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                    답글 #{r.id} · {when(r.created_at)}{r.edited_at ? " · 수정됨" : ""}{r.hidden ? " · 숨김" : ""}
                  </span>
                  <p className="text-[11.5px] leading-relaxed whitespace-pre-wrap">{r.body}</p>
                </div>
                {btn("reply", r.id, r.hidden)}
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
