"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Creator, Store } from "@/lib/types";
import SearchBar from "./SearchBar";
import CreatorStrip from "./CreatorStrip";
import StoreSheet from "./StoreSheet";
import StoreList from "./StoreList";

const KakaoMap = dynamic(() => import("./KakaoMap"), { ssr: false });

type Props = {
  initialStores: Store[];
  creators: Creator[];
  regions: { region: string; count: number }[];
};

/** "인천광역시 서구" → "인천 서구". 시도를 떼면 '서구'가 중복돼 구분이 안 된다 */
function shortRegion(r: string) {
  const [sido, ...rest] = r.split(" ");
  const head = sido.replace(/(특별자치도|광역시|특별시|특별자치시)$/, "")
                   .replace(/도$/, "").replace(/^전라|^경상|^충청/, (m) => m[0]);
  return rest.length ? `${head} ${rest.join(" ")}` : r;
}

export default function Explorer({ initialStores, creators, regions }: Props) {
  const [stores, setStores] = useState(initialStores);
  const [q, setQ] = useState("");
  const [creator, setCreator] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const active = creator || region || q.trim();

  // 지도와 목록이 항상 같은 조건을 본다
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true); setErr(null);
      try {
        const p = new URLSearchParams();
        if (creator) p.set("creator", creator);
        if (region) p.set("region", region);
        if (q.trim()) p.set("q", q.trim());
        const r = await fetch(`/api/stores?${p}`);
        if (!r.ok) throw new Error(String(r.status));
        setStores((await r.json()).stores);
      } catch {
        setErr("검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } finally { setLoading(false); }
    }, 220);                                   // 디바운스
    return () => clearTimeout(t);
  }, [q, creator, region]);

  const selectedStore = useMemo(
    () => stores.find((s) => s.storeId === selected) ?? null, [stores, selected]);

  const reset = useCallback(() => {
    setQ(""); setCreator(null); setRegion(null); setSelected(null);
  }, []);

  return (
    <main className="flex h-dvh flex-col">
      <header
        className="z-20 shrink-0 px-4 pt-2.5 pb-2 md:px-6 md:pt-3"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)" }}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2.5 md:gap-3">
          <div className="flex items-center gap-3">
            <h1 className="whitespace-nowrap"
                style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em" }}>
              르슐랭 가이드
            </h1>
            <span className="truncate-1 hidden md:inline"
                  style={{ fontSize: 12, color: "var(--ink-3)" }}>
              유튜버가 다녀간 식당을 지도에서
            </span>
            <div className="ml-auto flex items-center gap-1 rounded-lg p-0.5"
                 style={{ background: "var(--surface-2)" }}>
              {(["map", "list"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                  className="whitespace-nowrap rounded-md px-3 py-1.5"
                  style={{
                    fontSize: 12.5, fontWeight: view === v ? 600 : 500,
                    background: view === v ? "var(--surface)" : "transparent",
                    color: view === v ? "var(--ink)" : "var(--ink-2)",
                    boxShadow: view === v ? "var(--shadow-sm)" : "none",
                  }}>
                  {v === "map" ? "지도" : "목록"}
                </button>
              ))}
            </div>
          </div>

          <SearchBar
            value={q} onChange={setQ}
            onPickCreator={(id) => { setCreator(id); setQ(""); }}
            onPickRegion={(r) => { setRegion(r); setQ(""); }}
            onPickStore={(id) => { setSelected(id); setQ(""); setView("map"); }}
          />

          <CreatorStrip
            creators={creators} selected={creator}
            onSelect={(id) => setCreator((c) => (c === id ? null : id))}
          />

          <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 md:mx-0 md:px-0">
            {regions.map((r) => (
              <button key={r.region} onClick={() => setRegion((x) => (x === r.region ? null : r.region))}
                aria-pressed={region === r.region}
                className="shrink-0 rounded-full px-3 py-1.5"
                style={{
                  fontSize: 12.5,
                  border: `1px solid ${region === r.region ? "var(--accent)" : "var(--line-2)"}`,
                  background: region === r.region ? "var(--accent)" : "transparent",
                  color: region === r.region ? "var(--on-accent)" : "var(--ink-2)",
                  fontWeight: region === r.region ? 600 : 400,
                }}>
                {shortRegion(r.region)}
                <span className="num" style={{ opacity: .6, marginLeft: 5 }}>{r.count}</span>
              </button>
            ))}
            {active && (
              <button onClick={reset} className="ml-1 shrink-0 px-2 py-1.5"
                style={{ fontSize: 12.5, color: "var(--ink-3)", textDecoration: "underline" }}>
                초기화
              </button>
            )}
          </div>

          <p className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {loading ? "불러오는 중…" : err ? err : `${stores.length}곳`}
            {!loading && !err && active && " · 조건 적용됨"}
          </p>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {view === "map" ? (
          <>
            <KakaoMap stores={stores} selectedId={selected} onSelect={setSelected} />
            {selectedStore && (
              <StoreSheet store={selectedStore} onClose={() => setSelected(null)} />
            )}
            {!loading && stores.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
                <p className="rounded-full px-4 py-2"
                   style={{ background: "var(--surface)", boxShadow: "var(--shadow-md)",
                            fontSize: 13, color: "var(--ink-2)" }}>
                  조건에 맞는 식당이 없습니다
                </p>
              </div>
            )}
          </>
        ) : (
          <StoreList stores={stores} loading={loading}
                     onSelect={(id: string) => { setSelected(id); setView("map"); }} />
        )}
      </div>
    </main>
  );
}
