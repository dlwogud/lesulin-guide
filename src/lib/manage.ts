import { q } from "./db";

export type StoreRow = {
  id: string; name: string; address: string | null; region: string;
  category: string | null; lat: number; lng: number; coord_source: string | null;
  hidden: boolean; hide_note: string | null;
  comments_used: number | null; visits: number | null;
  guide_level: number | null; score: number | null; level_override: number | null;
  videos: number; creators: string | null; updated_at: string;
};

export async function listStores(opts: {
  q?: string; region?: string; onlyHidden?: boolean; onlyBadged?: boolean; limit?: number;
}) {
  const w: string[] = [];
  const p: unknown[] = [];
  if (opts.q) { p.push(`%${opts.q}%`); w.push(`(s.name ILIKE $${p.length} OR s.address ILIKE $${p.length})`); }
  if (opts.region) { p.push(opts.region); w.push(`s.region = $${p.length}`); }
  if (opts.onlyHidden) w.push("s.hidden");
  if (opts.onlyBadged) w.push("COALESCE(st.level_override, st.score_level) > 0");
  const where = w.length ? "WHERE " + w.join(" AND ") : "";
  return q<StoreRow>(`
    SELECT s.id, s.name, s.address, s.region, s.category, s.lat, s.lng, s.coord_source,
           s.hidden, s.hide_note, s.updated_at,
           st.comments_used, st.visits, st.score_level AS guide_level, st.score, st.level_override,
           (SELECT count(*)::int FROM store_videos sv WHERE sv.store_id = s.id) AS videos,
           (SELECT string_agg(DISTINCT c.short_name, ' · ')
              FROM store_videos sv JOIN videos v ON v.id = sv.video_id
              JOIN creators c ON c.id = v.creator_id
             WHERE sv.store_id = s.id) AS creators
      FROM stores s LEFT JOIN store_stats st ON st.store_id = s.id
      ${where}
     ORDER BY COALESCE(st.comments_used, 0) DESC, s.name
     LIMIT ${Math.min(opts.limit ?? 50, 200)}`, p);
}

export async function storeVideos(id: string) {
  return q(`SELECT v.id, v.title, v.published_at, v.views, c.short_name AS creator
              FROM store_videos sv JOIN videos v ON v.id = sv.video_id
              JOIN creators c ON c.id = v.creator_id
             WHERE sv.store_id = $1 ORDER BY v.published_at DESC`, [id]);
}

/** 바꾼 것만 기록합니다. before/after 를 같이 남겨 되돌릴 수 있게 둡니다. */
export async function audit(adminId: number, action: string, entity: string,
                            entityId: string, before: unknown, after: unknown) {
  await q(`INSERT INTO audit_log (admin_id, action, entity, entity_id, before, after)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [adminId, action, entity, entityId,
           before === null ? null : JSON.stringify(before),
           after === null ? null : JSON.stringify(after)]);
}

export async function auditLog(limit = 40, entityId?: string) {
  return q(`
    SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.before, a.after,
           u.email AS admin_email
      FROM audit_log a LEFT JOIN admin_users u ON u.id = a.admin_id
     ${entityId ? "WHERE a.entity_id = $1" : ""}
     ORDER BY a.id DESC LIMIT ${Math.min(limit, 200)}`, entityId ? [entityId] : []);
}

export async function regions() {
  return q<{ region: string; n: number }>(`
    SELECT region, count(*)::int AS n FROM stores GROUP BY region ORDER BY n DESC, region`);
}
