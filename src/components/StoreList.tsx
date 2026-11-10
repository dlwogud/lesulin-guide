"use client";
import type { Store } from "@/lib/types";
import { GuideBadge } from "./GuideBadge";

export default function StoreList({ stores, loading, onSelect }: {
  stores: Store[]; loading: boolean; onSelect: (id: string) => void;
}) {
  if (loading) return <Center text="불러오는 중…" />;
  if (!stores.length) return <Center text="조건에 맞는 식당이 없습니다" />;
  return (
    <div className="h-full overflow-y-auto">
      <ul className="mx-auto w-full max-w-3xl px-4 py-2 md:px-6">
        {stores.map((s) => (
          <li key={s.storeId} style={{ borderBottom: "1px solid var(--line)" }}>
            <button onClick={() => onSelect(s.storeId)}
              className="flex w-full items-center gap-3 py-3 text-left">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate-1" style={{ fontSize: 15, fontWeight: 600 }}>
                    {s.storeName}
                  </p>
                  <GuideBadge level={s.guideLevel} />
                </div>
                <p className="truncate-1 mt-0.5" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                  {s.region}
                  {s.creators.length > 0 && ` · ${s.creators.map((c) => c.creatorName).join(", ")}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="num" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                  리뷰 {s.reviewTotal.toLocaleString("ko-KR")}
                </p>
                {!s.guideLevel && (
                  <p className="mt-0.5" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    {s.status === "NEW" ? "검증 중" : "근거 부족"}
                  </p>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Center({ text }: { text: string }) {
  return (
    <div className="grid h-full place-items-center">
      <p style={{ fontSize: 13.5, color: "var(--ink-3)" }}>{text}</p>
    </div>
  );
}
