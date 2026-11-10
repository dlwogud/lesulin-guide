/* 유튜브 댓글용 항목별 감성 — 방문형. scripts/visit_lexicon.py 를 옮긴 것입니다.
 *
 * 왜 옮겼나: 평가 필수 조건에 "AI 기능 실시간 호출 — 결과가 그 자리에서 생성"이
 * 있는데, Vercel 의 Next 런타임은 Node 라서 Python 을 바로 부를 수 없습니다.
 * 파이썬을 별도 서비스로 띄우면 무료 티어 콜드스타트가 30~50초라 시연에서 위험합니다.
 *
 * 구현이 둘이 되는 위험은 테스트로 막습니다 —
 *   scripts/export_golden.py  파이썬 판정을 data/golden.json 으로 뽑고
 *   scripts/check_parity.ts   이 파일과 한 건이라도 다르면 실패
 * 사전을 고칠 때는 양쪽을 같이 고쳐야 테스트가 통과합니다.
 *
 * 주의: 부분 문자열 매칭이라 어근을 좁게 잡아야 합니다.
 *  "대기"는 "대기업"에, "조용"은 "조용필"에 걸립니다. 원본의 좁힘을 그대로 가져왔습니다. */

export const ASPECT_NAMES = ["맛", "양", "가격", "서비스", "대기", "분위기"] as const;
export type Aspect = (typeof ASPECT_NAMES)[number];

const ASPECTS: Record<Aspect, RegExp> = {
  "맛": /맛있|맛없|맛은|맛이|맛도|맛만|맛나|맛좋|맛집|풍미|간이|간은|비리|비려|짜요|짭|싱겁|느끼하|느끼해|담백|고소|신선|바삭|촉촉|쫄깃|질겨|질김|퍽퍽|존맛|꿀맛|딱딱|육즙|잡내|누린내|안\s*익/,
  "양": /양이|양은|양도|양만|푸짐|넉넉|적어|많아|많고|많네|부족|배부|배\s*터|배터|가득|실하|두툼|든든|충분|큼직|알차|풍성|듬뿍|수북|어마어마|1인분|일인분/,
  "가격": /가격|가성비|비싸|저렴|혜자|값|돈값|합리적|할인|돈이\s*아깝|이가격|만원|착한\s*가격|가격\s*대비/,
  "서비스": /친절|불친절|응대|사장님|서비스|요청|챙겨|신경\s*써|사장|이모님|직원|반찬\s*리필|리필|들어주|맞춰주|해\s*주신|실수|무뚝뚝|퉁명/,
  // 방문형의 핵심. 배달 사전엔 아예 없던 항목입니다.
  "대기": /웨이팅|줄\s*서|줄서|줄이\s|기다리|기다렸|기다려|기다림|대기(?!업)|오픈런|예약|자리\s*없|만석|품절|솔드아웃|재료\s*소진|일찍\s*가|늦게\s*가면|번호표|헛걸음|문\s*닫|웨잇/,
  "분위기": /분위기|인테리어|시끄럽|조용하|조용해|깨끗|청결|지저분|위생|협소|좁아|좁고|넓어|넓고|쾌적|아늑|주차|화장실|냄새\s*배/,
};

const POS_SRC = String.raw`맛있|맛나|맛좋|좋아|좋았|좋네|좋습|최고|쵝고|짱|굿|만족|훌륭|깔끔|신선|담백|고소|푸짐|넉넉|많아|많고|가득|실하|배부|저렴|가성비|혜자|친절|따뜻|바삭|촉촉|쾌적|아늑|또\s*가|또\s*시|재방문|단골|추천|강추|감사|잘\s*먹|잘먹|괜찮|존맛|꿀맛|맛집|JMT|jmt|행복|감동|대만족|최애|인정|성공|극락|사랑|미쳤|지렸|깨끗|조용하|넓어|든든|실화|예쁘|이쁘|잘해놔|잘해놓|잘해주|훌륭|가성비|도\s*좋`;
const NEG_SRC = String.raw`맛없|별로|별루|최악|실망|아쉽|아쉬|눅눅|비려|비림|짜게|싱겁|느끼하|느끼해|느끼함|불친절|적어|부족|비싸|다신|다시는|구려|질겨|질김|퍽퍽|이상하|이상해|이상함|불편|비위|역겨|느글|돈이\s*아깝|환불|잡내|누린내|무뚝뚝|퉁명|시끄럽|지저분|좁아|협소|오래\s*기다|한참\s*기다|헛걸음|웨이팅\s*이\s*길|줄이\s*길|너무\s*길|맛도\s*없|맛이\s*없|태도|살벌|기분\s*나[빠쁨]|후회|불쾌|올랐|올랏`;
const POS_G = new RegExp(POS_SRC, "g");
const NEG_G = new RegExp(NEG_SRC, "g");

// 이중부정: 부정 어근 + "-지 않/못" → 중화
const DOUBLE = /(적|작|많|늦|비싸|짜|싱겁|느끼|비리|질기|눅눅|차갑|부족|이상하|나쁘|길)(지|지는|지도)\s*(않|안\s)/g;

// 가정·우려·희망은 실제 경험이 아님
const HYPO = /까\s*봐|까봐|줄\s*알았|려나|걱정|시키면|시켰더니|뻔했|뻔\s했|겠다|겠네|겠어|고\s*싶|고싶|가\s*봐야|가봐야|가\s*볼|먹어\s*볼/;

// 영상·출연자 감상. 르몽 리뷰엔 없고 유튜브 댓글엔 넘칩니다.
const MEDIA = /영상|편집|촬영|피디|PD|자막|구독|좋아요|알고리즘|채널|업로드|썸네일|화질|목소리|노래|콘서트|공연|방송|출연|형님|누님|시경|쯔양|히밥|풍자|정육왕|먹방|먹텐|또간집|보면서|보고\s*있|보는데|잘\s*보고|재밌|재미있|웃기|꿀잼/;

// 식당 쪽 단서. MEDIA와 같이 나오면 식당 얘기로 봅니다.
const PLACE = /가게|식당|집이|집은|집에|매장|사장님|이모님|메뉴|반찬|주차|웨이팅|다녀왔|가봤|먹어봤|단골|줄\s*서/;

// 채널 운영자 고정 댓글. 가게 소개·협찬 고지라서 방문자 반응이 아닙니다.
const PROMO = /고정\s*댓글|본\s*영상은|협찬\s*&?\s*광고|유료\s*광고|위치\s*정보|구매\s*정보|비즈니스\s*(메일|문의)|업체\s*문의|제휴\s*문의|쿠폰\s*코드|공식\s*홈페이지|유튜브\s*검색\s*=|스마트스토어|네이버\s*:\s*http|인스타\s*:\s*http/;

export const promo = (t: string) => PROMO.test(String(t));

// 방문 경험을 명시한 댓글만 집계합니다. 방문 인증이 아니라 텍스트 분류입니다.
const VISITED = /다녀왔|다녀옴|다녀온|가봤|갔다왔|갔었|갔는데|갔더니|먹어봤|먹고왔|먹었는데|먹었어|먹었습니|방문했|방문하|주문했|시켜먹|단골|자주\s*가|자주\s*먹|여러\s*번\s*갔|어제\s*갔|오늘\s*갔|지난주\s*갔|몇\s*번\s*갔/;
const NOT_VISITED = /(안|못|아직)\s*(먹어\s*봤|가\s*봤|가봤|먹어봤|다녀왔)/;

const SPLIT = /[.!?~\n…,]+|\s(?:근데|그런데|다만|하지만|대신|단)\s|(?<=[가-힣])(?:은데|는데|인데|지만|으나|길래|어서|아서)\s*/;

export function clauses(text: string): string[] {
  return String(text).split(SPLIT).map(c => (c ?? "").trim()).filter(c => c.length >= 2);
}

/* 방문 표현이 있어도 이 가게 얘기가 아닌 것들.
   200건 사람 라벨로 재서 고른 조건입니다 — F1 이 오르는 것만 남겼습니다.
   "미래·의향"과 "추천"도 후보였지만 "다녀왔는데 추천합니다" 같은 진짜 방문을
   같이 날려서 F1 이 떨어졌습니다(0.794 → 0.743). 그래서 뺐습니다. */
const DISQUALIFY = new RegExp(
  String.raw`(에|의)\s*있는\s*[가-힣]{2,}` +
  String.raw`|[가-힣]{2,}(동|구|시|역)\s*[가-힣]{2,}(집|식당|가든|포차)` +
  String.raw`|(밥|저녁|점심|아침|식사)\s*(을|를)?\s*(방금\s*)?먹었|밥먹었` +
  String.raw`|알려주|어딘가요|인가요\?|궁금한` +
  String.raw`|[가-힣]{2,}\s*:\s|보셨군요|영상으로만|구독자입니다`
);

/** 방문 경험을 명시했는가. 희망형("가보고 싶다")은 제외합니다. */
export function visited(text: string): boolean {
  const t = String(text);
  if (!VISITED.test(t)) return false;
  if (NOT_VISITED.test(t)) return false;      // "안 먹어봤는데", "못 가봤어요"
  if (DISQUALIFY.test(t)) return false;
  return true;
}

/* 대기는 일반 감성어로 풀면 틀립니다.
   "단골집을 줄서서 갑니다 ㅠ"에는 '단골'(긍정)이 붙어 있지만 내용은 기다렸다는 말입니다.
   그래서 대기만은 "기다렸나 / 안 기다렸나"로 직접 읽습니다. */
const WAIT_POS = /웨이팅\s*(이\s*)?(없|적|짧)|줄\s*(이\s*)?(없|안\s*서|짧)|대기\s*(가\s*)?(없|짧)|기다리지\s*않|기다림\s*없|바로\s*(들어|앉|먹|나와)|길지\s*않|안\s*기다/;
const WAIT_NEG = /줄\s*서|줄서|줄이|줄\s*섰|웨이팅|대기(?!업)|기다[렸림리려여야]|\d+\s*(분|시간)\s*기다|오픈런|번호표|만석|자리\s*없|품절|솔드아웃|재료\s*소진|헛걸음|못\s*먹|못\s*들어|돌아왔|발길\s*돌/;

function waitPolarity(cl: string): number {
  if (WAIT_POS.test(cl)) return 1;
  if (WAIT_NEG.test(cl)) return -1;
  return 0;
}

// 실제로 겪은 일을 가리키는 어미. 희망 표현과 섞였을 때 중심을 가립니다.
const PAST = /먹었|갔었|갔는데|갔다|다녀|시켰|주문했|받았|나왔|했어요|했는데|기다렸|줄\s*서서|서서\s*먹|단골|자주\s*가|가봤|먹어봤|묵었|시켜/;

const GAP = 12;   // 항목어와 감성어가 이보다 멀면 한 덩어리로 보지 않습니다
const neutral = (c: string) => c.replace(DOUBLE, "긍정표현");
const starts = (re: RegExp, s: string) => [...s.matchAll(re)].map(m => m.index ?? 0);

/** 절 하나의 전체 극성. 1=긍정, -1=부정, 0=판단 보류. */
function polarity(cl: string): number {
  if (HYPO.test(cl)) return 0;
  const c = neutral(cl);
  const p = starts(POS_G, c).length;
  const n = starts(NEG_G, c).length;
  if (p && n) return 0;         // 섞인 절은 polarityNear 가 항목별로 다시 가립니다
  if (p) return 1;
  if (n) return -1;
  return 0;
}

/** 섞인 절에서 항목어 위치에 가장 가까운 감성어를 따릅니다. */
function polarityNear(cl: string, apos: number): number {
  const c = neutral(cl);
  const ps = starts(POS_G, c), ns = starts(NEG_G, c);
  const BIG = 1e6;
  const dp = ps.length ? Math.min(...ps.map(i => Math.abs(i - apos))) : BIG;
  const dn = ns.length ? Math.min(...ns.map(i => Math.abs(i - apos))) : BIG;
  if (Math.min(dp, dn) > GAP) return 0;         // 둘 다 멀다 — 근거로 쓰기 부적합
  if (Math.abs(dp - dn) <= 2) {
    /* 거리가 같으면 항목어 뒤에 오는 쪽을 따릅니다.
       "맛있더라구요 가격이 조금 비싸긴해요" — 가격의 서술어는 뒤쪽 '비싸'입니다. */
    const after: [number, number][] = [
      ...ps.filter(i => i > apos).map(i => [i, 1] as [number, number]),
      ...ns.filter(i => i > apos).map(i => [i, -1] as [number, number]),
    ];
    if (!after.length) return 0;
    after.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return after[0][1];
  }
  return dp < dn ? 1 : -1;
}

/** 댓글 하나 → {항목: 극성}. 영상 감상 절은 버립니다. */
export function analyze(text: string): Partial<Record<Aspect, number>> {
  const acc = new Map<Aspect, number[]>();
  for (const cl of clauses(text)) {
    /* 출연자·영상 얘기는 버리되, 같은 절에 식당 항목이 있으면 살립니다.
       "정육왕형님 효과인지 1시간 기다렸어요"는 대기 근거입니다. */
    if (MEDIA.test(cl) && !PLACE.test(cl)
        && !ASPECT_NAMES.some(a => ASPECTS[a].test(cl))) continue;
    /* 희망 표현이 섞여도 과거 경험이 같이 있으면 버리지 않습니다. */
    if (HYPO.test(cl) && !PAST.test(cl)) continue;

    const pol = polarity(cl);
    for (const a of ASPECT_NAMES) {
      const m = cl.match(ASPECTS[a]);
      if (!m || m.index === undefined) continue;
      const v = a === "대기" ? waitPolarity(cl) : (pol || polarityNear(cl, m.index));
      if (v) {
        const arr = acc.get(a) ?? [];
        arr.push(v); acc.set(a, arr);
      }
    }
  }
  const out: Partial<Record<Aspect, number>> = {};
  for (const [a, vs] of acc) {
    const s = vs.reduce((x, y) => x + y, 0);
    if (s !== 0) out[a] = s > 0 ? 1 : -1;
  }
  return out;
}

export const MODEL = "rule:visit_lexicon@v2";
