import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { q } from "./db";

/* 비밀번호는 scrypt 로 해시해 저장합니다. 평문은 어디에도 남기지 않습니다.
   bcrypt 패키지를 더 깔지 않고 Node 표준 crypto 만 씁니다. */
const N = 16384, KEY = 32;

export function hashPw(pw: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(pw, salt, KEY, { N });
  return `scrypt$${N}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

export function checkPw(pw: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const dk = scryptSync(pw, Buffer.from(salt, "base64"), KEY, { N: Number(n) });
  const want = Buffer.from(hash, "base64");
  return dk.length === want.length && timingSafeEqual(dk, want);
}

/* 세션은 서버가 서명한 쿠키 하나입니다. DB 조회 없이 매 요청 확인됩니다.
   서명 비밀값이 바뀌면 모든 세션이 한꺼번에 무효가 됩니다. */
const COOKIE = "lesulin_admin";
const TTL = 60 * 60 * 12;                    // 12시간

function secret(): string {
  const s = process.env.ADMIN_SECRET;
  if (!s) throw new Error("ADMIN_SECRET이 없습니다.");
  return s;
}
function sign(v: string) {
  return createHmac("sha256", secret()).update(v).digest("base64url");
}

export function makeToken(id: number, role: string) {
  const body = `${id}.${role}.${Math.floor(Date.now() / 1000) + TTL}`;
  return `${body}.${sign(body)}`;
}

export type Admin = { id: number; role: string };

export function readToken(tok: string | undefined): Admin | null {
  if (!tok) return null;
  const i = tok.lastIndexOf(".");
  if (i < 0) return null;
  const body = tok.slice(0, i), mac = tok.slice(i + 1);
  const want = sign(body);
  if (mac.length !== want.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  const [id, role, exp] = body.split(".");
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;   // 만료
  return { id: Number(id), role };
}

export async function currentAdmin(): Promise<Admin | null> {
  /* 토큰 만료 확인에 Date.now() 를 씁니다. Next 16 의 cacheComponents 는
     프리렌더 중 "값이 바뀌는 것"을 금지하므로, 요청 시점에 실행된다고
     먼저 알려야 합니다. 이걸 빼면 /admin 이 프리렌더에서 터지고
     로그인해도 매번 /login 으로 튕깁니다. */
  await connection();
  const c = await cookies();
  return readToken(c.get(COOKIE)?.value);
}

export async function setSession(id: number, role: string) {
  const c = await cookies();
  c.set(COOKIE, makeToken(id, role), {
    httpOnly: true,                          // 자바스크립트가 못 읽습니다
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL,
  });
}

export async function clearSession() {
  const c = await cookies();
  c.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function login(email: string, pw: string): Promise<Admin | null> {
  const [u] = await q<{ id: string; role: string; pw_hash: string }>(
    `SELECT id, role, pw_hash FROM admin_users WHERE email = $1`, [email.trim().toLowerCase()]);
  if (!u || !u.pw_hash || !checkPw(pw, u.pw_hash)) return null;
  await q(`UPDATE admin_users SET last_login = now() WHERE id = $1`, [u.id]);
  return { id: Number(u.id), role: u.role };
}
