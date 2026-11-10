import Link from "next/link";

export const metadata = { title: "분석 방법 — 르슐랭 가이드" };

export default function Methodology() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 md:px-6">
      <nav className="py-3">
        <Link href="/" style={{ fontSize: 13, color: "var(--ink-3)" }}>← 탐색으로</Link>
      </nav>
      <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>
        분석 방법과 한계
      </h1>
      <p className="mt-2" style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.65 }}>
        르슐랭 배지는 모든 식당에 주는 평점이 아닙니다. 충분한 근거가 확인된
        극소수 식당에만 부여합니다.
      </p>

      <Block title="데이터 출처">
        <li>음식점 리뷰 — 르몽 제공 멀티플랫폼 리뷰 데이터</li>
        <li>유튜브 댓글 — YouTube Data API v3 공개 댓글</li>
        <li>장소 정보 — 카카오 로컬 API</li>
      </Block>

      <Block title="영상 공개 이후 리뷰만 쓰는 이유">
        <li>영상의 영향을 받은 방문인지 구분하기 위해서입니다.</li>
        <li>영상 공개일을 확인할 수 없으면 분석에서 제외하고 상태를 기록합니다.</li>
      </Block>

      <Block title="실제 방문 댓글을 구분하는 기준">
        <li>“다녀왔다”, “먹어봤다”처럼 방문·취식 경험을 명시한 댓글만 집계합니다.</li>
        <li>“맛있겠다”, “가보고 싶다” 같은 감상은 제외합니다.</li>
        <li>
          다만 이는 <strong>텍스트에 근거한 분류</strong>이지 방문 인증이 아닙니다.
          화면에서도 “방문 경험을 명시한 댓글”로만 표기합니다.
        </li>
      </Block>

      <Block title="리뷰와 댓글을 50:50으로 보는 이유">
        <li>음식점 리뷰는 표본이 많고, 유튜브 댓글은 영상 맥락을 반영합니다.</li>
        <li>초기 실험 기준선이며 검수 결과에 따라 조정합니다.</li>
        <li>한쪽 데이터만 있으면 비율을 임의로 재분배하지 않고 점수를 내지 않습니다.</li>
      </Block>

      <Block title="최소 근거 조건 (초기 가설)">
        <li>영상 공개 이후 유효 리뷰 30건 이상</li>
        <li>방문 경험을 명시한 댓글 5건 이상</li>
        <li>만족도 판단이 가능한 원문 근거 확보</li>
      </Block>

      <Block title="배지 단계">
        <li><strong>1단계</strong> 근처라면 들러볼 곳</li>
        <li><strong>2단계</strong> 우회해서라도 갈 곳</li>
        <li><strong>3단계</strong> 이곳을 위해 떠날 곳</li>
        <li>조건을 만족하는 식당이 없으면 해당 단계는 비워 둡니다.</li>
      </Block>

      <Block title="현재 한계">
        <li>YouTube·카카오 API 키 미설정 상태로, 영상–식당 연결이 수집되지 않았습니다.</li>
        <li>감성 분석과 점수 계산을 수행하지 않아 배지가 부여된 식당이 없습니다.</li>
        <li>화면의 유튜버 연결과 좌표는 개발용이며, 매장명·주소·리뷰 수만 실제 데이터입니다.</li>
        <li>AI 분류는 오류가 있을 수 있어 원문 근거를 함께 보여줍니다.</li>
      </Block>
    </main>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-5" style={{ borderBottom: "1px solid var(--line)" }}>
      <h2 className="mb-2" style={{ fontSize: 14, fontWeight: 600 }}>{title}</h2>
      <ul className="flex flex-col gap-1.5"
          style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, paddingLeft: 16,
                   listStyle: "disc" }}>
        {children}
      </ul>
    </section>
  );
}
