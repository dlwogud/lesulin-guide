import { GUIDE_LABEL, type GuideLevel, type StoreStatus } from "@/lib/types";

/** 배지는 선정된 식당만 받는다. 0단계·기본 등급은 만들지 않는다. */
export function GuideBadge({ level }: { level: GuideLevel | null }) {
  if (!level) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-1"
      style={{ background: "var(--accent-soft)", color: "var(--accent-ink)",
               fontSize: 11.5, fontWeight: 600 }}>
      <span aria-hidden>{"◆".repeat(level)}</span>
      {GUIDE_LABEL[level]}
    </span>
  );
}

const STATUS: Partial<Record<StoreStatus, string>> = {
  NEW: "NEW · 검증 중",
  INSUFFICIENT_DATA: "평가 근거 부족",
  UNDER_REVIEW: "연결 검토 중",
  DATA_UNAVAILABLE: "데이터 미확보",
};

export function StatusChip({ status }: { status: StoreStatus }) {
  const label = STATUS[status];
  if (!label) return null;
  return (
    <span className="inline-flex rounded-md px-2 py-1"
      style={{ background: "var(--surface-2)", color: "var(--ink-3)", fontSize: 11.5 }}>
      {label}
    </span>
  );
}
