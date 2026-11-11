import { Pool } from "pg";

/* 서버리스에서 Postgres 에 붙는 방법.
 *
 * Supabase 의 세션 풀러(5432)는 동시 연결이 15개뿐입니다. Vercel 은 요청이
 * 몰리면 인스턴스를 여러 개 띄우고 각자 연결을 열어서 금방 찹니다 —
 * 실제로 터졌습니다:
 *   (EMAXCONNSESSION) max clients reached in session mode
 * 그래서 앱은 **트랜잭션 풀러(6543)** 를 씁니다. 매 쿼리마다 연결을
 * 돌려주는 방식이라 서버리스에 맞습니다.
 *
 * 파이썬 스크립트(scripts/*.py)는 psycopg 가 prepared statement 를 쓰므로
 * 세션 풀러(5432)가 필요합니다. 그래서 .env.local 의 DATABASE_URL 은
 * 5432 로 두고, 여기서 앱용으로만 포트를 바꿔 씁니다. */

function appUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL이 설정되지 않았습니다. .env.local을 확인하세요.");
  // 트랜잭션 풀러로 돌립니다. 이미 6543 이면 그대로 둡니다.
  return raw.replace("pooler.supabase.com:5432", "pooler.supabase.com:6543");
}

const g = globalThis as unknown as { _pool?: Pool };

export function pool(): Pool {
  if (!g._pool) {
    const url = appUrl();
    g._pool = new Pool({
      connectionString: url,
      /* 인스턴스마다 1개만 엽니다. 서버리스는 한 인스턴스가 한 요청을
         처리하므로 더 열 이유가 없고, 많이 열면 풀러 한도를 깹니다. */
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      // 호스팅 Postgres 는 TLS 를 쓰는데 중간 인증서를 안 줄 때가 있습니다
      ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
    /* 유휴 연결이 끊겨도 프로세스가 죽지 않게 합니다 */
    g._pool.on("error", () => {});
  }
  return g._pool;
}

export async function q<T = Record<string, unknown>>(
  sql: string, params: unknown[] = []
): Promise<T[]> {
  const r = await pool().query(sql, params);
  return r.rows as T[];
}

/** DB 가 아직 없어도 화면이 죽지 않게 합니다 — 셋업 전에도 개발이 가능해야 합니다. */
export async function dbReady(): Promise<boolean> {
  try {
    await q("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
