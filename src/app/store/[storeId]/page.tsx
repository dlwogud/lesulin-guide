import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/data";
import { GuideBadge, StatusChip } from "@/components/GuideBadge";
import { getStores } from "@/lib/data";

/** 시드는 고정이라 미리 생성한다. 수집이 늘면 dynamicParams가 받아준다. */
export function generateStaticParams() {
  return getStores().map((s) => ({ storeId: s.storeId }));
}

export default function StorePage({ params }: { params: Promise<{ storeId: string }> }) {
  return (
    <Suspense fallback={<StoreSkeleton />}>
      <StoreBody params={params} />
    </Suspense>
  );
}

function StoreSkeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 md:px-6">
      <nav className="py-3">
        <Link href="/" style={{ fontSize: 13, color: "var(--ink-3)" }}>← 탐색으로</Link>
      </nav>
      <div className="animate-pulse" style={{ paddingTop: 8 }}>
        <div style={{ height: 14, width: 120, background: "var(--surface-2)", borderRadius: 4 }} />
        <div style={{ height: 30, width: 260, background: "var(--surface-2)",
                      borderRadius: 6, marginTop: 12 }} />
        <div style={{ height: 14, width: 200, background: "var(--surface-2)",
                      borderRadius: 4, marginTop: 10 }} />
      </div>
    </main>
  );
}

async function StoreBody({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const s = getStore(storeId);
  if (!s) notFound();

  const naver = `https://map.naver.com/p/search/${encodeURIComponent(`${s.storeName} ${s.region}`)}`;
  const kakao = `https://map.kakao.com/?q=${encodeURIComponent(`${s.storeName} ${s.region}`)}`;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 md:px-6">
      <nav className="py-3">
        <Link href="/" style={{ fontSize: 13, color: "var(--ink-3)" }}>← 탐색으로</Link>
      </nav>

      <header style={{ borderBottom: "1px solid var(--line)", paddingBottom: 18 }}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <GuideBadge level={s.guideLevel} />
          {!s.guideLevel && <StatusChip status={s.status} />}
          {s.sourceType === "seed" && (
            <span className="rounded-md px-2 py-1"
              style={{ background: "var(--surface-2)", color: "var(--warn)", fontSize: 11 }}>
              유튜버 연결은 개발용
            </span>
          )}
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>{s.storeName}</h1>
        <p className="mt-1" style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{s.address}</p>
        <div className="mt-4 flex gap-2">
          <a href={naver} target="_blank" rel="noreferrer"
             className="rounded-lg px-4 py-2.5"
             style={{ background: "var(--accent)", color: "var(--on-accent)",
                      fontSize: 14, fontWeight: 600 }}>
            네이버 지도로 길찾기
          </a>
          <a href={kakao} target="_blank" rel="noreferrer"
             className="rounded-lg px-4 py-2.5"
             style={{ border: "1px solid var(--line-2)", fontSize: 14, color: "var(--ink-2)" }}>
            카카오맵
          </a>
        </div>
      </header>

      <Section title="소개한 유튜버">
        {s.creators.length ? (
          <ul className="flex flex-col gap-2">
            {s.creators.map((c) => (
              <li key={c.creatorId} style={{ fontSize: 14 }}>{c.creatorName}</li>
            ))}
          </ul>
        ) : <Empty>연결된 유튜버가 없습니다.</Empty>}
        {s.videos.length === 0 && (
          <Empty>
            원본 영상은 YouTube Data API 연동 후 표시됩니다.
            현재는 영상–식당 연결이 수집되지 않았습니다.
          </Empty>
        )}
      </Section>

      <Section title="수집된 리뷰">
        <dl className="grid grid-cols-3 gap-4">
          <Stat label="전체 리뷰" value={s.reviewTotal} />
          <Stat label="방문형(네이버)" value={s.reviewNaver} />
          <Stat label="텍스트 보유" value={s.reviewText} />
        </dl>
        <p className="mt-3" style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>
          르몽 제공 데이터에서 집계한 실제 수치입니다. 영상 공개일 기준 필터링과 감성 분석은
          아직 수행하지 않았으므로 항목별 점수와 배지는 표시하지 않습니다.
        </p>
      </Section>

      <Section title="방문자 반응">
        <Empty>
          분석 전입니다. 영상 공개 이후 리뷰와 실제 방문 경험을 명시한 댓글이
          최소 근거 조건을 충족하면 항목별 반응과 대표 근거가 여기에 표시됩니다.
        </Empty>
        <Link href="/methodology"
          className="mt-3 inline-block" style={{ fontSize: 13, color: "var(--accent-ink)" }}>
          분석 방법과 한계 보기 →
        </Link>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-5" style={{ borderBottom: "1px solid var(--line)" }}>
      <h2 className="mb-3" style={{ fontSize: 14, fontWeight: 600 }}>{title}</h2>
      {children}
    </section>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{label}</dt>
      <dd className="num mt-0.5" style={{ fontSize: 19, fontWeight: 600 }}>
        {value.toLocaleString("ko-KR")}
      </dd>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg px-3.5 py-3"
       style={{ background: "var(--surface-2)", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
      {children}
    </p>
  );
}
