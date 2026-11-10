import { NextResponse } from "next/server";
import { storeDetail } from "@/lib/queries";
import { dbReady } from "@/lib/db";

/** 식당 하나를 열 때 대표 인용문까지 받습니다. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  if (!(await dbReady())) {
    return NextResponse.json({ error: "DB에 연결할 수 없습니다." }, { status: 503 });
  }
  const { storeId } = await params;
  const s = await storeDetail(storeId);
  if (!s) return NextResponse.json({ error: "없는 식당입니다." }, { status: 404 });
  return NextResponse.json(s);
}
