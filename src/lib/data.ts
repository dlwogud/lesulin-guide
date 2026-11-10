import fs from "node:fs";
import path from "node:path";
import type { Creator, SearchFilters, Store } from "./types";

type SeedStore = Omit<Store, "creators" | "videos"> & {
  creatorIds: string[];
  reviewTotal: number; reviewNaver: number; reviewText: number;
  coordSource: string; storeNameSource: string;
};
type Seed = { creators: Creator[]; stores: SeedStore[] };

let cache: Seed | null = null;

/** 시드는 개발용이다. 실제 수집 데이터가 들어오면 이 함수만 교체한다. */
function load(): Seed {
  if (cache) return cache;
  const p = path.join(process.cwd(), "data", "seed.json");
  cache = fs.existsSync(p)
    ? (JSON.parse(fs.readFileSync(p, "utf8")) as Seed)
    : { creators: [], stores: [] };
  return cache;
}

export function getCreators(): Creator[] {
  const { creators, stores } = load();
  return creators.map((c) => ({
    ...c,
    storeCount: stores.filter((s) => s.creatorIds.includes(c.creatorId)).length,
  }));
}

export function getRegions(): { region: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of load().stores) m.set(s.region, (m.get(s.region) ?? 0) + 1);
  return [...m].map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);
}

function toStore(s: SeedStore, creators: Creator[]): Store {
  return {
    ...s,
    creators: creators
      .filter((c) => s.creatorIds.includes(c.creatorId))
      .map(({ creatorId, creatorName, profileImageUrl }) =>
        ({ creatorId, creatorName, profileImageUrl })),
    videos: [],
  };
}

export function getStores(f: SearchFilters = {}): Store[] {
  const { creators, stores } = load();
  const q = f.q?.trim().toLowerCase();
  return stores
    .filter((s) => {
      if (f.creator && !s.creatorIds.includes(f.creator)) return false;
      if (f.region && !s.region.includes(f.region)) return false;
      if (f.category && s.category !== f.category) return false;
      if (f.level && s.guideLevel !== f.level) return false;
      if (f.status && s.status !== f.status) return false;
      if (f.bounds) {
        const { sw, ne } = f.bounds;
        if (s.lat < sw[0] || s.lat > ne[0] || s.lng < sw[1] || s.lng > ne[1]) return false;
      }
      if (q) {
        const hay = [s.storeName, s.address, s.region,
          ...creators.filter((c) => s.creatorIds.includes(c.creatorId)).map((c) => c.creatorName),
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .map((s) => toStore(s, creators));
}

export function getStore(storeId: string): Store | null {
  const { creators, stores } = load();
  const s = stores.find((x) => x.storeId === storeId);
  return s ? toStore(s, creators) : null;
}

/** 배지는 분석을 통과한 식당만 가진다. 아직 분석 파이프라인 전이므로 비어 있다. */
export function getGuideCounts(): Record<string, number> {
  const out: Record<string, number> = { "1": 0, "2": 0, "3": 0 };
  for (const s of load().stores) if (s.guideLevel) out[String(s.guideLevel)]++;
  return out;
}
