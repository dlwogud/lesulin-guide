"use client";
import type { Store } from "@/lib/types";
import { GuideBadge, StatusChip } from "./GuideBadge";

/** 모바일은 하단 시트, 데스크톱은 우측 패널 — 지도 탐색 흐름을 끊지 않는다 */
export default function StoreSheet({ store, onClose }: { store: Store; onClose: () => void }) {
  const naver = `https://map.naver.com/p/search/${encodeURIComponent(store.storeName + " " + store.region)}`;
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 md:bottom-auto md:left-auto md:right-4 md:top-4 md:w-[360px]"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)",
               borderTop: "1px solid var(--line)", borderRadius: 16 }}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <GuideBadge level={store.guideLevel} />
            {!store.guideLevel && <StatusChip status={store.status} />}
            {store.sourceType === "seed" && (
              <span className="rounded-md px-2 py-1"
                style={{ background: "var(--surface-2)", color: "var(--warn)", fontSize: 11 }}>
                개발용 연결
              </span>
            )}
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.01em" }}>
            {store.storeName}
          </h2>
          <p className="mt-0.5" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {store.region}
          </p>
        </div>
        <button onClick={onClose} aria-label="닫기"
          className="shrink-0 rounded-md px-2 py-1"
          style={{ color: "var(--ink-3)", fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div className="px-4 pb-2">
        {store.creators.length > 0 && (
          <p style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {store.creators.map((c) => c.creatorName).join(" · ")} 소개
          </p>
        )}
        {store.videos.length === 0 && (
          <p className="mt-1" style={{ fontSize: 12, color: "var(--ink-3)" }}>
            연결된 영상이 아직 없습니다. YouTube API 연동 후 채워집니다.
          </p>
        )}
      </div>

      <div className="flex gap-2 p-4 pt-2">
        <a href={`/store/${store.storeId}`}
           className="flex-1 rounded-lg py-2.5 text-center"
           style={{ background: "var(--accent)", color: "var(--on-accent)",
                    fontSize: 14, fontWeight: 600 }}>
          상세 보기
        </a>
        <a href={naver} target="_blank" rel="noreferrer"
           className="rounded-lg px-4 py-2.5 text-center"
           style={{ border: "1px solid var(--line-2)", fontSize: 14, color: "var(--ink-2)" }}>
          길찾기
        </a>
      </div>
    </div>
  );
}
