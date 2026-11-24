/* 이 화면은 로그인 쿠키를 봐야 하니 미리 렌더할 수 없습니다.
   Next 16 의 cacheComponents 는 프리렌더를 기본으로 하므로
   "요청마다 서버에서 그린다"고 명시합니다. */
export const instant = false;

import { redirect } from "next/navigation";
import Link from "next/link";
import { currentAdmin } from "@/lib/auth";
import Logout from "./Logout";

/* 로그인하지 않으면 /admin 아래 어떤 화면도 열리지 않습니다.
   (중점 심사 04: 일반 사용자 접근 불가)

   로그인 화면은 /login 에 따로 뒀습니다 — /admin 안에 두면 이 레이아웃이
   로그인 화면에도 걸려서 자기 자신으로 무한히 돌아갑니다. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await currentAdmin();
  if (!me) redirect("/login");

  const tabs = [
    ["/admin", "사용 현황"],
    ["/admin/data", "데이터 관리"],
    ["/admin/review", "AI 결과 검수"],
    ["/admin/compare", "AI 비교(규칙·LLM)"],
    ["/admin/feedback", "피드백·신고"],
    ["/admin/community", "커뮤니티"],
    ["/admin/ai", "AI 실시간·운영 로그"],
  ] as const;

  return (
    <div className="min-h-dvh" style={{ background: "var(--surface-2)" }}>
      <header className="flex items-center gap-4 px-5 h-14"
              style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)" }}>
        <b className="text-sm flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/brand/logo-64.png?v=4" alt="" width={24} height={24} style={{ borderRadius: 6 }} />
          르슐랭 운영
        </b>
        <nav className="flex gap-1">
          {tabs.map(([href, label]) => (
            <Link key={href} href={href} className="text-xs px-3 py-1.5 rounded-lg hover:underline"
                  style={{ color: "var(--ink-2)" }}>{label}</Link>
          ))}
        </nav>
        <Link href="/map.html" className="text-xs ml-2" style={{ color: "var(--ink-3)" }}>
          사용자 화면 →
        </Link>
        <span className="ml-auto text-xs" style={{ color: "var(--ink-3)" }}>
          #{me.id} · {me.role}
        </span>
        <Logout />
      </header>
      <main className="p-5">{children}</main>
    </div>
  );
}
