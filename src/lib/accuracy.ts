/* 검수 정확도 — 층화 표본을 전체 크기로 보정해 냅니다.
 *
 * 검수는 분류기가 "다녀왔다"로 본 댓글(방문 쪽)과 아니라고 본 댓글(비방문 쪽)을
 * 따로 뽑아 봅니다. 비방문 쪽이 전체의 95% 이상이라 무작위로만 뽑으면 방문 쪽이
 * 거의 안 걸리기 때문입니다.
 *
 * 그렇게 모은 걸 그냥 합쳐 세면 틀립니다:
 *  - 방문 쪽만 봤는데 재현율이 100%로 나옵니다 (놓친 걸 볼 기회가 없었으니까)
 *  - 양쪽을 100건씩 봐도, 비방문 쪽에서 놓친 비율은 전체 26만 건에 걸린 것이라
 *    100건 기준으로 세면 재현율이 크게 부풀려집니다.
 *
 *   정밀도 = 방문 쪽에서 사람도 "다녀왔다"고 본 비율          (방문 쪽 표본만으로 됨)
 *   재현율 = 추정 TP / (추정 TP + 추정 FN)
 *            추정 TP = 방문 쪽 전체 수 × 정밀도
 *            추정 FN = 비방문 쪽 전체 수 × 비방문 표본에서 놓친 비율
 *            → 양쪽을 다 검수해야 나옵니다
 */
export type Counts = {
  tpV: number;      // 방문 쪽 표본 중 사람도 "다녀왔다"
  fpV: number;      // 방문 쪽 표본 중 사람은 "아니다"
  fnN: number;      // 비방문 쪽 표본 중 사람은 "다녀왔다" (놓친 것)
  tnN: number;      // 비방문 쪽 표본 중 사람도 "아니다"
  popVisit: number; // 분류기가 "다녀왔다"로 본 전체 댓글 수
  popNon: number;   // 분류기가 아니라고 본 전체 댓글 수
};

export function stratified(c: Counts) {
  const nV = c.tpV + c.fpV, nN = c.fnN + c.tnN;
  const precision = nV ? c.tpV / nV : null;

  let recall: number | null = null;
  if (nV && nN) {
    const tp = c.popVisit * (c.tpV / nV);
    const fn = c.popNon * (c.fnN / nN);
    recall = tp + fn > 0 ? tp / (tp + fn) : null;
  }

  return {
    n: nV + nN, tp: c.tpV, fp: c.fpV, fn: c.fnN, tn: c.tnN,
    reviewedVisit: nV, reviewedNon: nN,
    precision, recall,
    f1: precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall) : null,
  };
}
