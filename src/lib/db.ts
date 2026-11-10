import { Pool } from "pg";

/* 서버리스에서는 요청마다 모듈이 다시 평가될 수 있습니다.
   전역에 담아 두어 연결이 계속 새로 열리지 않게 합니다. */
const g = globalThis as unknown as { _pool?: Pool };

export function pool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다. .env.local을 확인하세요.");
  }
  if (!g._pool) {
    g._pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,                                   // 무료 티어는 동시 연결이 적습니다
      idleTimeoutMillis: 30_000,
      // 호스팅 Postgres(Neon·Supabase)는 TLS를 쓰는데 중간 인증서를 안 줄 때가 있습니다
      ssl: process.env.DATABASE_URL.includes("localhost") ? undefined
         : { rejectUnauthorized: false },
    });
  }
  return g._pool;
}

export async function q<T = Record<string, unknown>>(
  sql: string, params: unknown[] = []
): Promise<T[]> {
  const r = await pool().query(sql, params);
  return r.rows as T[];
}

/** DB가 아직 없어도 화면이 죽지 않게 합니다 — 셋업 전에도 개발이 가능해야 합니다. */
export async function dbReady(): Promise<boolean> {
  try {
    await q("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
