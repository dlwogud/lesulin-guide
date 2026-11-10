"use client";
import { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d.error ?? "로그인하지 못했습니다."); setBusy(false); return; }
    location.href = "/admin";
  }

  return (
    <main className="min-h-dvh grid place-items-center p-6"
          style={{ background: "var(--surface-2)" }}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl p-7"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-md)" }}>
        <p className="text-xs tracking-wide" style={{ color: "var(--ink-3)" }}>르슐랭 가이드</p>
        <h1 className="text-lg font-semibold mt-1 mb-1">운영자 로그인</h1>
        <p className="text-xs mb-5" style={{ color: "var(--ink-2)" }}>
          데이터 관리 · AI 결과 검수 · 사용 현황
        </p>
        <label className="block text-xs mb-1" style={{ color: "var(--ink-2)" }}>이메일</label>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" required
               autoComplete="username" className="w-full mb-3 rounded-lg px-3 py-2 text-sm"
               style={{ border: "1px solid var(--line)" }} />
        <label className="block text-xs mb-1" style={{ color: "var(--ink-2)" }}>비밀번호</label>
        <input value={pw} onChange={e => setPw(e.target.value)} type="password" required
               autoComplete="current-password" className="w-full mb-4 rounded-lg px-3 py-2 text-sm"
               style={{ border: "1px solid var(--line)" }} />
        {err && <p className="text-xs mb-3" style={{ color: "var(--bad)" }}>{err}</p>}
        <button disabled={busy} className="w-full rounded-lg py-2.5 text-sm font-semibold"
                style={{ background: busy ? "var(--line-2)" : "var(--accent)", color: "var(--on-accent)" }}>
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}
