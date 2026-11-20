/* 혼합 방식 — 규칙으로 명확한 댓글은 규칙 결과를 쓰고, 애매한 댓글만 LLM 에 보냅니다.
 *
 * 분기 조건은 개발용 표본(1차 196건, labeling/ai/dev.json)의 규칙 오류를 보고 정했고,
 * 평가용 표본(2차)을 보기 전에 고정합니다. 조건을 바꾸면 ROUTE_VERSION 을 올리세요.
 *
 * 1차 표본에서 규칙이 틀린 50건의 유형:
 *   방문으로 잘못 봄 44건 — 가볼 예정 · 다른 가게 · 동네에 자주 간다 · 갔는데 못 먹음 · 자기 끼니
 *   놓침 6건       — 방문 동사 없이 경험을 말함 ("여기 맛있어요", "여기서 회식 많이 함") */

import { visited } from "./classify.ts";

export const ROUTE_VERSION = "route-v1";

/* 규칙이 "방문"이라고 본 댓글 중 이런 표현이 있으면 다시 확인합니다. */
const RISK: [string, RegExp][] = [
  ["앞으로의 계획", /겠(어|네|다|습|어요|네요)|볼게|볼께|볼래|봐야|가볼|가 볼|도전|방문하겠|방문할|꼭\s*(가|들|방문)|가고\s*싶|먹고\s*싶|먹어\s*보고/],
  ["다른 가게", /다른\s*(곳|집|가게|식당)|추천|소개|(에서|집에서|식당에서)\s*(먹|시켜)|\d+\.\s*\S|이라는|라는\s*(곳|집|가게|음식점)|여기도|거기도|지점|본점|분점/],
  ["동네·지역", /(근처|쪽|동네|지역|시장|역|거리|출장)\s*(에|에서|을|를)?\s*(자주|많이|매일|맨날)|자주\s*가는\s*(곳|집|동네)|지나(가|쳐)/],
  ["못 먹음", /문\s*(을\s*)?닫|재료\s*소진|품절|헛걸음|못\s*먹|못먹|휴무|쉬는\s*날|브레이크/],
  ["자기 끼니", /(시켜|배달|포장)\s*(시켜|해)?\s*먹|집에서|제사|명절|엄마|아빠|부모님|어머니|아버지/],
  ["긴 댓글", /^[\s\S]{160,}$/],
];

/* 규칙이 "아님"이라고 본 댓글 중 이런 표현이 있으면 경험담일 수 있어 확인합니다. */
const HINT: [string, RegExp][] = [
  ["경험 말투", /(여기|저기|거기|여긴|저긴|거긴|이집|이 집|저집|저 집).{0,12}(맛있|맛나|최고|별로|많아|많음|적어|비싸|싸요|친절|불친절|좋아요|좋음)/],
  ["반복 방문", /회식|단골|자주|몇\s*번|여러\s*번|매번|항상|늘\s/],
  ["먹어 본 말투", /먹어\s*보니|먹어봤|먹었는데|먹었을\s*때|먹었던|가봤는데|가 봤는데|가보니|가 보니|갔었|다녀/],
];

export type Route = { rule: boolean; toLLM: boolean; why: string[] };

export function route(text: string): Route {
  const rule = visited(text);
  const why = (rule ? RISK : HINT).filter(([, re]) => re.test(text)).map(([k]) => k);
  return { rule, toLLM: why.length > 0, why };
}

/* 혼합 최종 판정. LLM 이 "판단 어려움"이거나 호출에 실패하면 규칙 결과로 돌아갑니다. */
export function hybridFinal(r: Route, llm: "yes" | "no" | "unsure" | null): { visit: boolean; source: "rule" | "llm" | "rule-fallback" } {
  if (!r.toLLM) return { visit: r.rule, source: "rule" };
  if (llm === "yes") return { visit: true, source: "llm" };
  if (llm === "no") return { visit: false, source: "llm" };
  return { visit: r.rule, source: "rule-fallback" };
}
