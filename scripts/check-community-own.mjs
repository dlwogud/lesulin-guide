/* 커뮤니티 SQL 검사 — 쓴 사람만 고치고 지우는지, 목록·인기글 기간, 좌표를 남기지 않는지.
 * 운영 DB 에서 직접 돌려 봅니다.
 *
 *   node scripts/check-community-own.mjs
 *
 * 모든 쓰기는 BEGIN … ROLLBACK 안에서만 합니다. 운영 커뮤니티에 글이 남지 않고,
 * 다른 사람 화면에도 뜨지 않습니다(커밋 전이라 다른 연결에서는 보이지 않음).
 * 실제 API 가 쓰는 SQL 그대로(src/lib/pollsSql.ts)를 불러와 씁니다.
 */
import fs from "fs";
import assert from "assert/strict";
import { createRequire } from "module";
import { OWN_SQL, feedSql, INSERT_POLL } from "../src/lib/pollsSql.ts";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));

const c = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 60000,
                       ssl: { rejectUnauthorized: false } });
await c.connect();
const A = "check_own_author_" + Date.now(), B = "check_own_other_" + Date.now();
const fails = [];
const t = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { fails.push(name); console.log(`  ✗ ${name}\n    ${e.message}`); }
};
const n = r => r.rowCount;

await c.query("BEGIN");
try {
  const [{ id: pid }] = (await c.query(
    `INSERT INTO polls (kind, body, session) VALUES ('ask', '점검용 글', $1) RETURNING id`, [A])).rows;
  const [{ id: rA }] = (await c.query(
    `INSERT INTO poll_replies (poll_id, body, session) VALUES ($1, '내 답글', $2) RETURNING id`, [pid, A])).rows;
  const [{ id: rB }] = (await c.query(
    `INSERT INTO poll_replies (poll_id, body, session) VALUES ($1, '남의 답글', $2) RETURNING id`, [pid, B])).rows;

  await t("남의 글은 고칠 수 없다", async () => {
    assert.equal(n(await c.query(OWN_SQL.editPoll, [pid, B, "바꿈"])), 0);
  });
  await t("내 글은 고치고, 수정 시각이 남는다", async () => {
    assert.equal(n(await c.query(OWN_SQL.editPoll, [pid, A, "고친 글"])), 1);
    const r = (await c.query(`SELECT body, edited_at FROM polls WHERE id = $1`, [pid])).rows[0];
    assert.equal(r.body, "고친 글"); assert.ok(r.edited_at, "edited_at 이 비어 있음");
  });
  await t("남의 답글은 고칠 수 없다 (같은 글 안이어도)", async () => {
    assert.equal(n(await c.query(OWN_SQL.editReply, [rB, pid, A, "바꿈"])), 0);
  });
  await t("내 답글은 고친다", async () => {
    assert.equal(n(await c.query(OWN_SQL.editReply, [rA, pid, A, "고친 답글"])), 1);
  });
  await t("답글은 다른 글 번호로는 고치지 못한다", async () => {
    assert.equal(n(await c.query(OWN_SQL.editReply, [rA, Number(pid) + 1e9, A, "x"])), 0);
  });
  await t("남의 답글은 지울 수 없다", async () => {
    assert.equal(n(await c.query(OWN_SQL.deleteReply, [rB, pid, A])), 0);
  });
  await t("내 답글은 지운다", async () => {
    assert.equal(n(await c.query(OWN_SQL.deleteReply, [rA, pid, A])), 1);
  });
  await t("남의 글은 지울 수 없다", async () => {
    assert.equal(n(await c.query(OWN_SQL.deletePoll, [pid, B])), 0);
  });
  await t("내 글을 지우면 남의 답글까지 함께 지워진다", async () => {
    assert.equal(n(await c.query(OWN_SQL.deletePoll, [pid, A])), 1);
    assert.equal((await c.query(`SELECT 1 FROM poll_replies WHERE poll_id = $1`, [pid])).rowCount, 0);
  });
  await t("어제 글도 고칠 수 있다 (밤 12시 초기화 없음)", async () => {
    const [{ id: old }] = (await c.query(
      `INSERT INTO polls (kind, body, session, day, created_at) VALUES ('ask', '어제 글', $1,
         (now() AT TIME ZONE 'Asia/Seoul')::date - 1, now() - interval '1 day') RETURNING id`, [A])).rows;
    assert.equal(n(await c.query(OWN_SQL.editPoll, [old, A, "고침"])), 1);
  });
  await t("관리자가 가린 글은 쓴 사람도 고칠 수 없다", async () => {
    const [{ id: h }] = (await c.query(
      `INSERT INTO polls (kind, body, session, hidden) VALUES ('ask', '가린 글', $1, true) RETURNING id`, [A])).rows;
    assert.equal(n(await c.query(OWN_SQL.editPoll, [h, A, "고침"])), 0);
  });
  await t("1년 된 글도 최신순·인기순 모두에 남는다", async () => {
    const [{ id: old8 }] = (await c.query(
      `INSERT INTO polls (kind, body, session, day, created_at) VALUES ('ask', '1년 전 글', $1,
         (now() AT TIME ZONE 'Asia/Seoul')::date - 365, now() - interval '365 days') RETURNING id`, [A])).rows;
    const newIds = (await c.query(feedSql("new"), [A])).rows.map(r => String(r.id));
    const hotIds = (await c.query(feedSql("hot"), [A])).rows.map(r => String(r.id));
    assert.ok(newIds.includes(String(old8)), "최신순에 1년 된 글이 없음");
    assert.ok(hotIds.includes(String(old8)), "인기순에 1년 된 글이 없음");
    const mine = (await c.query(feedSql("new"), [A])).rows.find(r => String(r.id) === String(old8));
    assert.equal(mine.mine, true, "내 글 표시가 안 됨");
    assert.ok(!("session" in mine), "목록에 세션 값이 나감");
  });
  await t("글 개수 제한이 없다 — 숨기지 않은 글은 전부 목록에 나온다", async () => {
    for (let i = 0; i < 45; i++) await c.query(
      `INSERT INTO polls (kind, body, session) VALUES ('ask', $1, $2)`, ["개수 점검 " + i, A]);
    const total = Number((await c.query(`SELECT count(*) n FROM polls WHERE NOT hidden`)).rows[0].n);
    for (const s of ["new", "hot"]) {
      const rows = (await c.query(feedSql(s), [A])).rowCount;
      assert.equal(rows, total, `${s} 목록 ${rows}개 / 전체 ${total}개`);
    }
  });
  await t("가린 글은 목록 어디에도 나오지 않는다", async () => {
    const [{ id: h2 }] = (await c.query(
      `INSERT INTO polls (kind, body, session, hidden) VALUES ('ask', '가린 글 2', $1, true) RETURNING id`, [A])).rows;
    for (const s of ["new", "hot"]) {
      const ids = (await c.query(feedSql(s), [A])).rows.map(r => String(r.id));
      assert.ok(!ids.includes(String(h2)), `${s} 목록에 가린 글이 나옴`);
    }
  });
  await t("새 글에는 위치 좌표가 남지 않고 시군구만 남는다", async () => {
    const [{ id: np }] = (await c.query(INSERT_POLL, ["ask", "좌표 점검", null, "서울특별시 성동구", null, A])).rows;
    const r = (await c.query(`SELECT lat, lng, place FROM polls WHERE id = $1`, [np])).rows[0];
    assert.equal(r.lat, null); assert.equal(r.lng, null); assert.equal(r.place, "서울특별시 성동구");
  });
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
console.log(fails.length ? `\n실패 ${fails.length}건` : "\n모두 통과");
process.exit(fails.length ? 1 : 0);
