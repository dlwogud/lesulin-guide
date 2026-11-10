"use client";
import type { Creator } from "@/lib/types";

export default function CreatorStrip({ creators, selected, onSelect }: {
  creators: Creator[]; selected: string | null; onSelect: (id: string) => void;
}) {
  if (!creators.length) return null;
  return (
    <div className="-mx-4 flex items-start gap-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      {creators.map((c) => {
        const on = c.creatorId === selected;
        return (
          <button key={c.creatorId} onClick={() => onSelect(c.creatorId)} aria-pressed={on}
            className="flex w-[52px] shrink-0 flex-col items-center gap-1">
            <span className="grid place-items-center overflow-hidden rounded-full"
              style={{
                width: 44, height: 44,
                background: "var(--surface-2)",
                border: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                outline: on ? "none" : "1px solid var(--line)",
                outlineOffset: -1,
              }}>
              {c.profileImageUrl
                ? <img src={c.profileImageUrl} alt="" width={44} height={44}
                       style={{ objectFit: "cover", width: "100%", height: "100%" }} />
                : <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-3)" }}>
                    {c.creatorName.slice(0, 1)}
                  </span>}
            </span>
            <span className="truncate-1 w-full text-center"
              style={{ fontSize: 11.5, fontWeight: on ? 600 : 400,
                       color: on ? "var(--ink)" : "var(--ink-2)" }}>
              {c.creatorName}
            </span>
          </button>
        );
      })}
    </div>
  );
}
