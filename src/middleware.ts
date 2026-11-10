import { NextRequest, NextResponse } from "next/server";

/* /admin 아래는 여기서 먼저 막습니다.
 *
 * 왜 레이아웃의 redirect 만으로는 부족했나:
 * currentAdmin() 의 .catch(() => null) 가 Next 의 프리렌더 중단 신호까지 삼켜서
 * /admin 이 빌드 때 정적으로 구워졌고, 그 HTML 이 로그인 없이도 서빙됐습니다.
 * 미들웨어는 요청마다 반드시 돌고 캐시되지 않으므로 이 구멍이 생기지 않습니다.
 *
 * 쿠키 서명 검증은 src/lib/auth.ts 의 sign() 과 같은 방식(HMAC-SHA256 → base64url)
 * 입니다. 미들웨어는 Edge 런타임이라 node:crypto 대신 Web Crypto 를 씁니다. */

const COOKIE = "lesulin_admin";

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function valid(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const body = token.slice(0, i), mac = token.slice(i + 1);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  if (mac.length !== want.length) return false;
  // 길이가 같을 때만 전부 비교합니다 (한 글자씩 빠져나가지 않게)
  let diff = 0;
  for (let k = 0; k < mac.length; k++) diff |= mac.charCodeAt(k) ^ want.charCodeAt(k);
  if (diff !== 0) return false;
  const exp = Number(body.split(".")[2]);
  return Number.isFinite(exp) && exp >= Math.floor(Date.now() / 1000);
}

export async function middleware(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    // 비밀값이 없으면 통과시키지 않습니다 — 설정 누락이 곧 공개가 되면 안 됩니다
    return NextResponse.redirect(new URL("/login?e=config", req.url));
  }
  if (await valid(req.cookies.get(COOKIE)?.value, secret)) {
    return NextResponse.next();
  }
  const to = new URL("/login", req.url);
  to.searchParams.set("next", req.nextUrl.pathname);
  const res = NextResponse.redirect(to);
  res.headers.set("Cache-Control", "no-store");      // 리다이렉트도 캐시되지 않게
  return res;
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
