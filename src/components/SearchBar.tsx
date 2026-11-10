"use client";
import { useEffect, useRef, useState } from "react";
import type { Creator, Store } from "@/lib/types";

type Res = { creators: Creator[]; regions: { region: string; count: number }[]; stores: Store[] };

export default function SearchBar({ value, onChange, onPickCreator, onPickRegion, onPickStore }: {
  value: string; onChange: (v: string) => void;
  onPickCreator: (id: string) => void;
  onPickRegion: (r: string) => void;
  onPickStore: (id: string) => void;
}) {
  const [res, setRes] = useState<Res | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value.trim()) { setRes(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(value.trim())}`);
        setRes(r.ok ? await r.json() : null);
      } catch { setRes(null); }
    }, 180);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const empty = res && !res.creators.length && !res.regions.length && !res.stores.length;

  return (
    <div ref={wrap} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="유튜버, 지역, 식당 이름으로 검색"
        aria-label="통합 검색"
        className="w-full rounded-xl px-4 py-3 outline-none"
        style={{
          fontSize: 14.5, background: "var(--surface-2)",
          border: "1px solid var(--line)", color: "var(--ink)",
        }}
      />
      {open && res && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl"
             style={{ background: "var(--surface)", border: "1px solid var(--line)",
                      boxShadow: "var(--shadow-lg)" }}>
          {empty ? (
            <p className="px-4 py-3.5" style={{ fontSize: 13, color: "var(--ink-3)" }}>
              검색 결과가 없습니다
            </p>
          ) : (
            <>
              <Group label="유튜버" items={res.creators.map((c) => ({
                key: c.creatorId, main: c.creatorName,
                sub: c.storeCount ? `식당 ${c.storeCount}곳` : undefined,
                on: () => { onPickCreator(c.creatorId); setOpen(false); },
              }))} />
              <Group label="지역" items={res.regions.map((r) => ({
                key: r.region, main: r.region, sub: `${r.count}곳`,
                on: () => { onPickRegion(r.region); setOpen(false); },
              }))} />
              <Group label="식당" items={res.stores.map((s) => ({
                key: s.storeId, main: s.storeName, sub: s.region,
                on: () => { onPickStore(s.storeId); setOpen(false); },
              }))} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, items }: {
  label: string;
  items: { key: string; main: string; sub?: string; on: () => void }[];
}) {
  if (!items.length) return null;
  return (
    <div style={{ borderTop: "1px solid var(--line)" }} className="first:border-t-0">
      <p className="px-4 pt-2.5 pb-1"
         style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: ".04em" }}>{label}</p>
      {items.map((i) => (
        <button key={i.key} onClick={i.on}
          className="flex w-full items-baseline gap-2 px-4 py-2 text-left hover:opacity-70">
          <span className="truncate-1" style={{ fontSize: 14 }}>{i.main}</span>
          {i.sub && <span className="num shrink-0"
            style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{i.sub}</span>}
        </button>
      ))}
    </div>
  );
}
