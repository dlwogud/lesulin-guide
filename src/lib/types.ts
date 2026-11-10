/** 르슐랭 가이드 도메인 타입 */

export type SourceType = "real" | "seed";

/** 평가 상태 — NEW와 INSUFFICIENT_DATA는 다른 의미다 */
export type StoreStatus =
  | "RATED"              // 최소 근거 조건 통과, 평가 완료
  | "NEW"                // 최근 영상에서 발견, 분석 전
  | "INSUFFICIENT_DATA"  // 근거 부족
  | "UNDER_REVIEW"       // 영상-식당 연결 검토 중
  | "DATA_UNAVAILABLE";  // 데이터 접근 불가

/** 배지는 선정된 식당만 가진다. 0단계나 기본 등급은 없다 */
export type GuideLevel = 1 | 2 | 3;

export const GUIDE_LABEL: Record<GuideLevel, string> = {
  1: "근처라면 들러볼 곳",
  2: "우회해서라도 갈 곳",
  3: "이곳을 위해 떠날 곳",
};

export interface Creator {
  creatorId: string;
  creatorName: string;
  channelId: string | null;
  channelUrl: string | null;
  profileImageUrl: string | null;
  subscriberCount: number | null;   // API가 공개할 때만
  isFeatured: boolean;
  storeCount?: number;
  sourceType: SourceType;
}

export interface Video {
  videoId: string;
  youtubeVideoId: string;
  creatorId: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  menuText: string | null;          // 영상에서 확인된 메뉴
  matchConfidence: number;          // 0~1
  verificationStatus: "auto" | "verified" | "pending";
}

export interface Store {
  storeId: string;
  storeName: string;
  address: string;
  roadAddress: string | null;
  lat: number;
  lng: number;
  category: string | null;
  region: string;                   // "부산광역시 해운대구"
  phone: string | null;
  placeProvider: string | null;
  placeProviderId: string | null;
  creators: Pick<Creator, "creatorId" | "creatorName" | "profileImageUrl">[];
  videos: Video[];
  guideLevel: GuideLevel | null;    // null = 배지 없음
  status: StoreStatus;
  sourceType: SourceType;
  reviewTotal: number;      // 르몽 실데이터
  reviewNaver: number;
  reviewText: number;
}

/** 분석 근거 — 숫자만 주지 않고 원문과 표본 수를 함께 */
export interface Evidence {
  storeId: string;
  reviewScore: number | null;
  commentScore: number | null;
  finalScore: number | null;
  reviewValidCount: number;         // 영상 공개 이후 유효 리뷰
  commentVisitCount: number;        // 방문 경험을 명시한 댓글
  aspects: { name: string; positive: number; negative: number }[];
  positiveQuotes: Quote[];
  negativeQuotes: Quote[];
  calculatedAt: string | null;
  scoreVersion: string;
}

export interface Quote {
  text: string;
  source: "review" | "comment";
  publishedAt: string | null;
  platform: string | null;
  /** 방문 여부는 텍스트 기반 분류 결과지 인증이 아니다 */
  visitClaim: "visited" | "uncertain" | null;
}

export interface SearchFilters {
  creator?: string;
  region?: string;
  category?: string;
  level?: GuideLevel;
  status?: StoreStatus;
  bounds?: { sw: [number, number]; ne: [number, number] };
  q?: string;
}
