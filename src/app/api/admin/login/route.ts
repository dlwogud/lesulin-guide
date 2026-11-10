import { NextRequest, NextResponse } from "next/server";
import { login, setSession } from "@/lib/auth";
import { dbReady } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (!(await dbReady())) {
    return NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email : "";
  const pw = typeof b.password === "string" ? b.password : "";
  if (!email || !pw) {
    return NextResponse.json({ error: "이메일과 비밀번호를 입력하세요." }, { status: 400 });
  }
  const a = await login(email, pw);
  /* 어느 쪽이 틀렸는지 알려주지 않습니다 — 계정이 있는지 떠볼 수 있게 됩니다. */
  if (!a) return NextResponse.json({ error: "이메일 또는 비밀번호가 맞지 않습니다." }, { status: 401 });
  await setSession(a.id, a.role);
  return NextResponse.json({ ok: true, role: a.role });
}
