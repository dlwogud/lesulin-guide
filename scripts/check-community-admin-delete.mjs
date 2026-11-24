/* 관리자 커뮤니티 삭제 SQL 검사 — 답글만 지우면 글은 남고, 글을 지우면 답글·추천까지 사라지는지.
 *
 *   node scripts/check-community-admin-delete.mjs
 *
 * 모든 쓰기는 BEGIN … ROLLBACK 안에서만 합니다. 운영 커뮤니티에 아무것도 남지 않습니다.
 * SQL 은 src/app/api/admin/community/[id]/route.ts 의 DELETE 와 같은 문장입니다.
 */
import fs from "fs";
import assert from "assert/strict";
import { createRequire } from "module";
import { INSERT_POLL } from "../src/lib/pollsSql.ts";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));

const c = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 60000,
                       ssl: { rejectUnauthorized: false } });
await c.connect();
const S = "check_admin_del_" + Date.now();
const one = async (sql, args) => (await c.query(sql, args)).rows[0];
const count = async (sql, args) => Number((await one(sql, args)).n);

await c.query("BEGIN");
try {
  const { id: pid } = await one(INSERT_POLL, ["ask", "삭제 점검 글", null, "서울특별시 성동구", null, S]);
  const { id: r1 } = await one(`INSERT INTO poll_replies (poll_id, body, session) VALUES ($1,'답글1',$2) RETURNING id`, [pid, S]);
  const { id: r2 } = await one(`INSERT INTO poll_replies (poll_id, body, session) VALUES ($1,'답글2',$2) RETURNING id`, [pid, S]);
  await c.query(`INSERT INTO reply_votes (reply_id, session, value) VALUES ($1,$2,1)`, [r2, S]);

  const before = await one(`SELECT p.body, (SELECT count(*)::int FROM poll_replies r WHERE r.poll_id = p.id) AS replies
                              FROM polls p WHERE p.id = $1`, [pid]);
  assert.equal(before.replies, 2);
  console.log("  ✓ 지우기 전 기록값(본문·답글 수)을 읽음");

  await c.query(`DELETE FROM poll_replies WHERE id = $1`, [r1]);
  assert.equal(await count(`SELECT count(*) n FROM poll_replies WHERE id = $1`, [r1]), 0);
  assert.equal(await count(`SELECT count(*) n FROM polls WHERE id = $1`, [pid]), 1);
  assert.equal(await count(`SELECT count(*) n FROM poll_replies WHERE poll_id = $1`, [pid]), 1);
  console.log("  ✓ 답글 삭제 → 그 답글만 사라지고 글·다른 답글은 남음");

  await c.query(`DELETE FROM polls WHERE id = $1`, [pid]);
  assert.equal(await count(`SELECT count(*) n FROM polls WHERE id = $1`, [pid]), 0);
  assert.equal(await count(`SELECT count(*) n FROM poll_replies WHERE poll_id = $1`, [pid]), 0);
  assert.equal(await count(`SELECT count(*) n FROM reply_votes WHERE reply_id = $1`, [r2]), 0);
  console.log("  ✓ 글 삭제 → 답글·추천까지 함께 사라짐");
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
