import { NextResponse } from "next/server";

/* 카카오 지도 JS 키를 서버가 환경변수에서 읽어 내려줍니다.
 *
 * 이 키는 설계상 숨길 수 없습니다 — 브라우저가 카카오에 직접 요청하므로
 * 개발자도구로는 늘 보입니다(네이버·구글 지도도 같습니다).
 * 보호 장치는 비밀 유지가 아니라 **카카오 콘솔의 도메인 허용목록**입니다.
 *
 * 그래도 이렇게 두는 이유:
 *   · 깃허브 저장소와 소스코드에 키가 남지 않습니다
 *   · 평가 기준의 "서버·환경변수 보관"을 충족합니다
 *   · 키를 바꿀 때 코드를 고치지 않고 Vercel 환경변수만 갈면 됩니다 */
export async function GET() {
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";
  return NextResponse.json({ key }, {
    headers: { "Cache-Control": "public, max-age=600" },
  });
}
