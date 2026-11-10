"use client";

export default function Logout() {
  return (
    <button
      className="text-xs underline"
      style={{ color: "var(--ink-3)" }}
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        location.href = "/login";
      }}>
      로그아웃
    </button>
  );
}
