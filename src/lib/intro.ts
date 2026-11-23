import { q } from "@/lib/db";
import { siteMeta } from "@/lib/meta";
import { SHOWCASE } from "@/lib/showcase";
import excludeList from "../../data/intro_exclude.json";

/* 시작 화면 v3 — 유튜버마다 예시 식당 2곳.
 *
 * 대표 댓글은 "한 가게만 나오는 영상"(숨긴 중복 제외)에서 나온 것만 씁니다.
 * 또간집처럼 한 편에 여러 곳을 도는 영상이나 식당 여러 곳이 연결된 영상의 대표 댓글은
 * 112건을 읽어 보니 39%가 다른 가게 얘기였습니다. 좋았다는 이야기가 이 기준을 통과한
 * 식당만 고르고, 아쉬웠다는 이야기는 통과할 때만 보여 줍니다.
 *
 * 카드 옆 댓글은 그 카드 유튜버의 영상에 달린 것만 씁니다. 같은 식당이라도 다른 유튜버 영상
 * 댓글을 붙이면 "또간집 카드 옆에 쯔양 얘기"가 나옵니다(11/23 발견). 자기 영상에서 쓸 댓글이
 * 없는 유튜버(또간집 등)는 댓글 없이 영상 카드만 보여 줍니다.
 *
 * 성시경(c1)은 사람이 원문을 확인한 복춘식당(src/lib/showcase.ts)을 맨 앞에 둡니다.
 * 숫자는 전부 DB 에서 읽습니다. */

const PER_CREATOR = 2;

/* 첫 화면에 나갈 댓글이라 한 번 더 거릅니다. 위 출처 기준만으로는
   "이 영상 보고 갔다가 완전 낭패"가 좋았다는 이야기로, 같은 영상의 다른 가게("복성루는…") 얘기가
   대표로 나왔습니다. 유튜버당 2곳이면 되니 후보가 줄어도 괜찮습니다.
     - 가게 이름(첫 단어)을 직접 쓴 댓글만
     - 좋았다는 이야기엔 불만 단어가 없어야, 아쉬웠다는 이야기엔 있어야 */
const GRIPE = /안감|안 감|싼마이|아쉬웠|아쉬웟|별루|최악|낭패|실망|별로|비추|노맛|그닥|글쎄|떨어진|아쉽|아쉬운|불친절|미지근|비싸|부실|짜다|짰|싱겁|적어|적다|느끼|비린|질기|잡내|기대이하|기대 이하|안 ?가|다시는/;
const flat = (t: string) => t.replace(/\s+/g, "");
const brand = (name: string) => flat(name.replace(/\(.*?\)/g, " ").trim().split(/\s+/)[0] ?? "");
const names = (text: string, name: string) => !!brand(name) && flat(text).includes(brand(name));
/* "가보고 싶다", "기대됩니다" — 아직 안 간 사람의 댓글이 방문으로 분류된 경우 */
const WISH = /저장(했|부터|해)|가보고 ?싶|가 ?보고 ?싶|가볼게|가봐야|가 ?볼래|기대(됩|되|돼)|가고 ?싶/;
/* 가게 이름 앞뒤 30자 안에 다녀온 말이 있어야 합니다.
   "메종루블랑 갔다왔는데 … 슈코다이닝에서 먹고 싶네요"처럼 다른 가게에 간 얘기를 거릅니다. */
const VISIT = /갔|가봤|가 봤|가서|다녀|먹었|먹어봤|먹어 봤|먹고 왔|방문|단골|사먹|포장해/;
const visitNear = (text: string, name: string) => {
  const t = flat(text), b = brand(name);
  for (let i = t.indexOf(b); i >= 0; i = t.indexOf(b, i + 1)) {
    if (VISIT.test(t.slice(Math.max(0, i - 30), i + b.length + 30))) return true;
  }
  return false;
};
/* 같은 상호의 다른 지점 얘기("넙딱집 전포점 가봤는데" — 이 가게는 상암점)를 거릅니다 */
const branchOf = (name: string) => {
  const w = name.trim().split(/\s+/);
  return w.length > 1 && /점$/.test(w[w.length - 1]) ? w[w.length - 1].replace(/(직영점|본점|역점|점)$/, "") : null;
};
const otherBranch = (text: string, name: string) => {
  const mine = branchOf(name);
  if (!mine) return false;
  const re = new RegExp(brand(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(\\S{1,8}?)(직영점|본점|역점|점)", "g");
  const esc = brand(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = new RegExp("(\\S{1,8}?)(직영점|본점|역점|점)\\s*" + esc, "g");   // "대전 반석점 원조부안집"
  return [...text.matchAll(re), ...text.matchAll(before)]
    .some(m => m[1] && !m[1].includes(mine) && !mine.includes(m[1]));
};
/* 이름 바로 뒤(25자)에 "먹고 싶/가고 싶"이 오면 그 가게는 아직 안 간 것입니다
   ("메종루블랑 갔다왔는데 … 슈코다이닝에서 맛있는 음식 먹고 싶네요") */
const WISH_AFTER = /먹고싶|가보고싶|가고싶|가봐야|가볼게/;
const wishAfter = (text: string, name: string) => {
  const t = flat(text), b = brand(name);
  for (let i = t.indexOf(b); i >= 0; i = t.indexOf(b, i + 1)) {
    if (WISH_AFTER.test(t.slice(i, i + b.length + 25))) return true;
  }
  return false;
};
/* 가게가 있는 도시와 다른 도시를 말하면 다른 지점 얘기입니다
   ("부산 덕천동에 갓파스시" — 이 가게는 서울 구로점). 가게 이름 속 지명(서울곱창)은 빼고 봅니다. */
const CITIES = ["서울","부산","대구","인천","광주","대전","울산","세종","제주","수원","성남","고양","용인","강릉","속초",
  "춘천","원주","전주","군산","여수","순천","목포","경주","포항","창원","마산","통영","청주","천안","안산","평택","의정부",
  "김포","파주","해운대","광안리","서면"];
const BUSAN_SPOTS = new Set(["해운대", "광안리", "서면"]);
const otherCity = (text: string, name: string, region: string) => {
  const t = text.split(brand(name)).join(" ");
  const said = CITIES.filter(c => t.includes(c));
  return said.length > 0 && !said.some(c => region.includes(c) || (BUSAN_SPOTS.has(c) && region.includes("부산")));
};
const usable = (q: IQuote, name: string, region: string) => !otherCity(q.text, name, region) &&
  names(q.text, name) && visitNear(q.text, name) && !otherBranch(q.text, name)
  && !WISH.test(q.text) && !wishAfter(q.text, name);
const goodOk = (q: IQuote | null, name: string, region: string) => !!q && usable(q, name, region) && !GRIPE.test(q.text);
const badOk = (q: IQuote | null, name: string, region: string) => !!q && usable(q, name, region) && GRIPE.test(q.text);

/* 자동 기준을 통과했지만 사람이 읽어 보니 부적절한 곳 — data/intro_exclude.json 에서 고칩니다 */
const EXCLUDE = new Set<string>(excludeList.exclude.map((x: { id: string }) => x.id));
const MULTI_PLACE_CREATOR = "c4";   // 또간집 — scripts/quotes.py 의 MULTI_PLACE_CREATORS 와 같음

export type IQuote = { text: string; likes: number; at: string; wait: boolean; vid: string };
export type IPlace = {
  id: string; name: string; region: string; category: string; lat: number; lng: number;
  used: number; neg: number; waits: number; lvl: number | null; creatorId: string; curated: boolean;
  video: { id: string; title: string; views: number; dur: string | null; at: string };
  good: IQuote | null; bad: IQuote | null;
};
export type Intro = {
  meta: { stores: number; videos: number; comments: number };
  creators: { id: string; name: string; stores: number }[];
  places: IPlace[];
};

type Row = {
  creator_id: string; id: string; name: string; region: string; category: string; lat: number; lng: number;
  used: number; neg: number; waits: number; lvl: number | null;
  v_id: string; v_title: string; v_views: number; v_dur: string | null; v_at: string;
};
type Cand = { store_id: string; cid: string; text: string; likes: number; at: string; vid: string;
              wait: boolean; praise: number; gripes: number };

/* scripts/quotes.py 의 자기소개 인사("안녕하세요 ○○입니다") — 가게·출연자 댓글 */
const SELF_INTRO = /^\s*안녕하(세요|십니까)[\s!~.,]*\S{1,20}\s*(입니다|이에요|예요)/;

/* 한 가게만 나오는 영상(숨긴 중복 제외)이고 또간집이 아닌 영상의 "다녀왔다" 댓글 */
const SINGLE = `
  SELECT sv.video_id FROM store_videos sv JOIN stores s ON s.id = sv.store_id AND NOT s.hidden
   GROUP BY sv.video_id HAVING count(DISTINCT s.name) = 1`;

export async function loadIntro(): Promise<Intro> {
  const [meta, creators, rows, curated] = await Promise.all([
    siteMeta(),
    q<{ id: string; name: string; stores: number }>(`
      SELECT c.id, c.name, count(DISTINCT s.id)::int AS stores
        FROM creators c
        JOIN videos v ON v.creator_id = c.id
        JOIN store_videos sv ON sv.video_id = v.id
        JOIN stores s ON s.id = sv.store_id AND NOT s.hidden
       GROUP BY c.id, c.name
       ORDER BY stores DESC, c.name`),
    q<Row>(`
      WITH cand AS (
        SELECT DISTINCT v.creator_id, s.id
          FROM stores s
          JOIN store_stats st ON st.store_id = s.id AND st.status = 'RATED'
          JOIN store_videos sv ON sv.store_id = s.id
          JOIN videos v ON v.id = sv.video_id
         WHERE NOT s.hidden)
      SELECT cand.creator_id, s.id, s.name, s.region, s.category, s.lat, s.lng,
             st.comments_used AS used, st.negatives AS neg, st.waits,
             NULLIF(COALESCE(st.level_override, st.guide_level), 0) AS lvl,
             rv.id AS v_id, rv.title AS v_title, rv.views AS v_views, rv.duration AS v_dur, rv.at AS v_at
        FROM cand
        JOIN stores s ON s.id = cand.id
        JOIN store_stats st ON st.store_id = s.id
        CROSS JOIN LATERAL (           -- 그 유튜버의 그 식당 영상 중 조회수가 가장 많은 것
          SELECT v.id, v.title, v.views, v.duration, to_char(v.published_at, 'YYYY-MM-DD') AS at
            FROM store_videos sv JOIN videos v ON v.id = sv.video_id
           WHERE sv.store_id = s.id AND v.creator_id = cand.creator_id
           ORDER BY v.views DESC NULLS LAST LIMIT 1) rv
       ORDER BY cand.creator_id, st.comments_used DESC, s.id`),
    q<{ id: number; body: string; likes: number; at: string; wait: boolean; vid: string }>(`
      SELECT c.id, c.body, c.likes, to_char(c.published_at, 'YYYY-MM-DD') AS at, c.video_id AS vid,
             EXISTS (SELECT 1 FROM comment_aspects a WHERE a.comment_id = c.id AND a.aspect = '대기') AS wait
        FROM comments c
       WHERE c.id = ANY($1::bigint[]) AND c.video_id = $2 AND NOT c.is_owner`,
      [[SHOWCASE.good, SHOWCASE.bad], SHOWCASE.video]),
  ]);

  /* 후보 식당의 "다녀왔다" 댓글 전부(대표 댓글 하나만 보면 기준을 통과하는 게 너무 적습니다).
     좋았다 = 칭찬 있고 대기 뺀 불만 없음, 아쉬웠다 = 대기 뺀 불만이 칭찬보다 적지 않음 — quotes.py 와 같은 정의 */
  const ids = [...new Set(rows.map(r => r.id))];
  const cands = await q<Cand>(`
    SELECT sv.store_id, v.creator_id AS cid, left(trim(c.body), 170) AS text, c.likes, to_char(c.published_at, 'YYYY-MM-DD') AS at,
           c.video_id AS vid,
           bool_or(a.aspect = '대기') AS wait,
           count(*) FILTER (WHERE a.polarity > 0)::int AS praise,
           count(*) FILTER (WHERE a.polarity < 0 AND a.aspect <> '대기')::int AS gripes
      FROM store_videos sv
      JOIN comments c ON c.video_id = sv.video_id AND NOT c.is_owner
      JOIN comment_analysis an ON an.comment_id = c.id AND an.is_visit
      JOIN comment_aspects a ON a.comment_id = c.id
      JOIN videos v ON v.id = c.video_id AND v.creator_id <> '${MULTI_PLACE_CREATOR}'
     WHERE sv.store_id = ANY($1) AND c.video_id IN (${SINGLE})
     GROUP BY sv.store_id, v.creator_id, c.id
     ORDER BY c.likes DESC, c.id`, [ids]);
  /* 식당 + 유튜버 단위로 모읍니다 — 카드의 유튜버 영상 댓글만 그 카드 옆에 나갑니다 */
  const key = (store: string, creator: string) => `${store}|${creator}`;
  const byStore = new Map<string, Cand[]>();
  for (const c of cands) {
    if (SELF_INTRO.test(c.text)) continue;
    const k = key(c.store_id, c.cid);
    const list = byStore.get(k) ?? [];
    list.push(c); byStore.set(k, list);
  }
  const asQuote = (c: Cand): IQuote => ({ text: c.text, likes: Number(c.likes), at: c.at, wait: !!c.wait, vid: c.vid });
  const pick = (r: Row) => {
    const list = byStore.get(key(r.id, r.creator_id)) ?? [];
    const g = list.find(c => c.praise > 0 && c.gripes === 0 && goodOk(asQuote(c), r.name, r.region));
    const b = list.find(c => c.gripes > 0 && c.gripes >= c.praise && badOk(asQuote(c), r.name, r.region));
    return { good: g ? asQuote(g) : null, bad: b ? asQuote(b) : null };
  };

  const quote = (id: number): IQuote | null => {
    const c = curated.find(r => Number(r.id) === id);
    return c ? { text: c.body.trim(), likes: Number(c.likes), at: c.at, wait: !!c.wait, vid: c.vid } : null;
  };
  const toPlace = (r: Row, quotes: { good: IQuote | null; bad: IQuote | null }, curatedFlag = false): IPlace => ({
    id: r.id, name: r.name, region: r.region, category: r.category,
    lat: Number(r.lat), lng: Number(r.lng),
    used: Number(r.used), neg: Number(r.neg), waits: Number(r.waits),
    lvl: r.lvl === null ? null : Number(r.lvl), creatorId: r.creator_id, curated: curatedFlag,
    video: { id: r.v_id, title: r.v_title, views: Number(r.v_views), dur: r.v_dur, at: r.v_at },
    ...quotes,
  });

  const places: IPlace[] = [];
  for (const c of creators) {
    const mine = rows.filter(r => r.creator_id === c.id);
    const picked: IPlace[] = [];
    if (c.id === "c1") {
      const r = mine.find(x => x.id === SHOWCASE.store && x.v_id === SHOWCASE.video)
             ?? mine.find(x => x.id === SHOWCASE.store);
      const good = quote(SHOWCASE.good);
      if (r && good) picked.push(toPlace(r, { good, bad: quote(SHOWCASE.bad) }, true));
    }
    for (const r of mine) {
      if (picked.length >= PER_CREATOR) break;
      if (EXCLUDE.has(r.id) || picked.some(p => p.id === r.id)) continue;
      const qs = pick(r);
      if (qs.good) picked.push(toPlace(r, qs));
    }
    /* 자기 영상에서 쓸 댓글이 하나도 없는 유튜버 — 남의 영상 댓글을 붙이지 않고 영상 카드만 */
    for (const r of mine) {
      if (picked.length >= PER_CREATOR) break;
      if (EXCLUDE.has(r.id) || picked.some(p => p.id === r.id)) continue;
      picked.push(toPlace(r, { good: null, bad: null }));
    }
    places.push(...picked);
  }

  return {
    meta: { stores: meta.stores, videos: meta.videos, comments: meta.comments },
    creators: creators.map(c => ({ id: c.id, name: c.name, stores: Number(c.stores) })),
    places,
  };
}
