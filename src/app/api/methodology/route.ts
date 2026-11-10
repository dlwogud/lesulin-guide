import { NextResponse } from "next/server";
import { getGuideCounts } from "@/lib/data";

export function GET() {
  return NextResponse.json({
    scoreVersion: "v0-draft",
    weights: { review: 0.5, comment: 0.5 },
    minEvidence: { reviewsAfterVideo: 30, visitComments: 5 },
    priorStrength: 10,
    guideCounts: getGuideCounts(),
    note: "분석 파이프라인 미실행. 배지가 부여된 식당은 없습니다.",
  });
}
