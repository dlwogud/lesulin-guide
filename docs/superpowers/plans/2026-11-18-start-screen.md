# 르슐랭 시작 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` 에 지도가 보이지 않는 시작 화면(핵심 문장 + 실제 식당 예시 + 유튜버 선택 + 지도 보기 버튼)을 두고, 지도(`/map.html`)와 연결한다.

**Architecture:** 예시 식당·댓글의 "선택"은 `src/lib/showcase.ts` 에 고정하고, 숫자와 본문은 새 API `/api/showcase` 가 DB에서 읽는다. 시작 화면은 정적 `public/index.html` + `public/start.js` 로 만들고 그 API를 불러 채운다. 유튜버 선택은 지도와 같은 localStorage 키를 공유한다.

**Tech Stack:** Next.js 16 route handler, `pg`(`src/lib/db.ts` 의 `q`), 정적 HTML/JS(프레임워크 없음), Playwright(검증 스크립트), Vercel.

**Spec:** `docs/superpowers/specs/2026-11-18-start-screen-design.md`

## Global Constraints

- 화면의 모든 숫자는 API 응답에서 온다. HTML/JS 에 숫자 리터럴로 적지 않는다(평가 기준 "화면 숫자 하드코딩 금지").
- 예시 고정값(이 값만 코드에 둔다): 식당 `s126`, 영상 `ZZAqSGZjiPo`, 좋았다는 이야기 댓글 `291815`, 아쉬웠다는 이야기 댓글 `291672`.
- 핵심 문장(그대로): `좋아하는 유튜버가 간 식당,` / `다녀왔다고 적은 사람들은 뭐라고 했을까?`
- 표현: "다녀왔다고 적은 댓글", "좋았다는 이야기", "아쉬웠다는 이야기", "웨이팅을 언급한 댓글". "방문 인증", 점수·순위 표현 금지.
- 유튜버 선택 저장: localStorage `lesulin.fav` = 유튜버 id 의 JSON 배열, 최대 3개. 지도(`public/app.js` 의 `loadFav/saveFav`)와 같은 형식.
- 색상은 `public/map.html` `:root` 토큰 값을 그대로 쓴다(`--coral:#FF5A2B` 등).
- 시작 화면에 르슐랭 배지·실시간 투표를 넣지 않는다. 위치 권한을 묻지 않는다.
- 모바일 기준 폭 390px, 데스크톱 1440px. 720px 이하에서 ①②③ 세로 배치.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 이제 `public/index.html` 은 시작 화면이다. 예전처럼 `map.html` 을 `index.html` 로 복사하지 않는다.

## Review Focus

1. 고정한 댓글이 DB에서 사라지거나 식당이 숨김 처리됨 → API 는 500 이 아니라 200 + 해당 항목 `null`, 시작 화면은 그 블록만 숨기고 나머지는 동작. (Task 1, Task 2 테스트)
2. 시크릿 창 등에서 localStorage 접근이 예외를 던짐 → 시작 화면은 그대로 뜨고 버튼으로 지도에 갈 수 있음. (Task 2 테스트)
3. 저장된 `lesulin.fav` 에 지금 없는 유튜버 id 나 4개 이상이 들어 있음 → 있는 id 만, 최대 3개만 미리 선택. (Task 2 테스트)
4. `/map.html?store=없는id` → 지도는 평소처럼 뜨고 오류 없음. (Task 3 테스트)
5. 폭 390px 에서 가로 스크롤이 생기거나 버튼이 화면 밖으로 나감 → 가로 넘침 0, 버튼 보임. (Task 2 테스트)

---

### Task 1: `/api/showcase` — 예시 식당 데이터

**Files:**
- Create: `src/lib/showcase.ts`
- Create: `src/app/api/showcase/route.ts`
- Test: `scripts/check-showcase.mjs`

**Interfaces:**
- Produces: `GET /api/showcase` → JSON
  ```ts
  type Quote = { id: number; text: string; likes: number; at: string /* YYYY-MM-DD */ };
  type Showcase = {
    store: { id: string; name: string; region: string; category: string; lat: number; lng: number;
             visits: number; commentsAll: number; waits: number } | null;
    video: { id: string; title: string; views: number; at: string; creatorId: string; creatorName: string } | null;
    good: Quote | null;
    bad: Quote | null;
    creators: { id: string; name: string; stores: number }[];   // 숨김 아닌 식당 수, 많은 순
    meta: { creators: number; videos: number; stores: number };
  };
  ```
  헤더: `Cache-Control: public, s-maxage=600, stale-while-revalidate=3600` (`/api/seed` 와 동일, `CDN-Cache-Control` 도).
- Produces: `src/lib/showcase.ts` 에 `export const SHOWCASE = { store: "s126", video: "ZZAqSGZjiPo", good: 291815, bad: 291672 } as const;` 와 `export async function loadShowcase(): Promise<Showcase>`.

- [ ] **Step 1: Write the failing check** — `scripts/check-showcase.mjs` (인자: 기준 주소, 기본 `http://localhost:3000`). `node:assert` 로:
  - `res.status === 200`, `res.headers.get("cache-control")` 에 `s-maxage=600` 포함
  - `d.store.id === "s126"`, `d.store.name === "복춘식당"`, `d.store.visits > 0`, `d.store.commentsAll >= d.store.visits`, `Number.isInteger(d.store.waits)`
  - `d.video.id === "ZZAqSGZjiPo"`, `d.video.views > 0`, `d.video.creatorName === "성시경의 먹을텐데"`
  - `d.good.id === 291815 && d.good.text.includes("아구탕")`, `d.bad.id === 291672 && d.bad.text.includes("재료소진")`
  - `d.creators.length === 10`, 모두 `stores > 0`, `stores` 내림차순
  - `d.meta.creators === 10`, `d.meta.videos > 0`, `d.meta.stores > 0`
  - 마지막 줄 `console.log("showcase OK")`

- [ ] **Step 2: Run to verify it fails**
  Run: `node scripts/check-showcase.mjs`
  Expected: AssertionError (status 404)

- [ ] **Step 3: Implement `loadShowcase()` and the route**
  - `stores` + `store_stats`(visits, comments_all, waits) 를 `s.id = SHOWCASE.store AND NOT s.hidden` 로 조회 → 없으면 `store: null`.
  - `videos` + `creators` 를 `v.id = SHOWCASE.video` 로 조회(`views`, `published_at`).
  - 댓글 두 건은 `comments` 에서 `id = ANY($1)` 한 번에 조회(`body`, `likes`, `published_at`). 없는 id 는 `null`.
  - `creators` 는 `store_videos → videos → stores(NOT hidden)` 로 유튜버별 `count(DISTINCT store_id)`.
  - `meta` 는 creators / videos / 숨김 아닌 stores 의 count.
  - 날짜는 `YYYY-MM-DD` 문자열로.
  - route: `dbReady()` 가 false 면 503(기존 라우트와 같은 메시지 형식), 그 외 200 + 위 헤더.

- [ ] **Step 4: Run to verify it passes**
  Run: `node scripts/check-showcase.mjs`
  Expected: `showcase OK`

- [ ] **Step 5: Review Focus 1 — 사라진 댓글**
  `loadShowcase` 가 조회 결과에 없는 id 를 `null` 로 돌려주는지 일시적으로 `SHOWCASE.good` 를 존재하지 않는 `1` 로 바꿔 `curl -s localhost:3000/api/showcase | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['good'])"` → `None`, HTTP 200 확인 후 원래 값으로 되돌린다.

- [ ] **Step 6: Commit**
  ```bash
  git add src/lib/showcase.ts src/app/api/showcase/route.ts scripts/check-showcase.mjs
  git commit -m "시작 화면용 /api/showcase — 고정한 예시 식당·댓글을 DB에서 읽기"
  ```

---

### Task 2: 시작 화면 `/`

**Files:**
- Modify (전체 교체): `public/index.html`
- Create: `public/start.js`
- Test: `scripts/e2e-start.mjs`

**Interfaces:**
- Consumes: Task 1 의 `GET /api/showcase`.
- Produces: `/` 의 DOM id — `#hero`(h1), `#ex`(예시 카드 전체), `#exVideo`, `#exCount`, `#exGood`, `#exBad`, `#exMap`(→ `/map.html?store=<store.id>`), `#exRoute`(카카오 길찾기), `#chips`(유튜버 버튼, 각 `data-id`), `#pickCnt`, `#go`(→ `/map.html`), `#skip`(선택 비우고 → `/map.html`).
- Produces: `#go` 클릭 시 `lesulin.fav` 에 선택 id 배열 저장. `#skip` 은 `[]` 저장.

시안 A(`.superpowers/brainstorm/…/content/start-screen.html` 의 `.lmA`) 구성을 따른다: 상단 로고 + "지도로 바로 가기", 핵심 문장 + 한 줄 설명(유튜버 N명·영상 N편은 `meta` 에서), "예를 들면 — 실제 식당 한 곳", ①영상 → ②다녀왔다고 적은 댓글 N건 + 좋았다/아쉬웠다 + 웨이팅 언급 N건 → ③지도에서 찾기(지도에서 보기·길찾기), 유튜버 칩(이름 + N곳), 버튼. 칩 이미지는 `img/ch/<id>.jpg`, 썸네일은 `img/vid/<videoId>.jpg`. 영상·"원문 보기"는 `https://www.youtube.com/watch?v=<video.id>` 새 탭. 길찾기 형식은 `public/app.js:327` 과 동일.

- [ ] **Step 1: Write the failing e2e** — `scripts/e2e-start.mjs` (인자: 기준 주소, 기본 `http://localhost:3000`). Playwright chromium, 실패 시 `process.exit(1)`. 각 시나리오는 새 context:
  1. **데스크톱 1440×900:** `/` 열기 → `#hero` 텍스트에 `다녀왔다고 적은 사람들` 포함, 페이지에 `#kmap` 없음. `/api/showcase` 를 직접 fetch 한 값과 비교: `#exCount` 에 `store.visits` 포함, `#exGood` 에 `good.text` 앞 10자 포함, `#exBad` 에 `bad.text` 앞 10자 포함, `#exMap` href 가 `/map.html?store=s126` 로 끝남. `#chips [data-id]` 10개.
  2. **최대 3명:** 칩 4개를 차례로 클릭 → 선택된 칩(`[aria-pressed="true"]`) 3개, `#pickCnt` 에 `3`.
  3. **저장·이동:** 2명 클릭 → `#go` 클릭 → URL 이 `/map.html` 로 끝남, `localStorage["lesulin.fav"]` 가 그 2개 id.
  4. **미리 선택(Review Focus 3):** `addInitScript` 로 `lesulin.fav = ["c1","zz9","c2","c4","c5"]` → `/` 열면 선택된 칩이 `c1,c2,c4` 3개.
  5. **API 실패(Review Focus 1):** `page.route("**/api/showcase", r => r.fulfill({status:503, body:"{}"}))` → `#ex` 숨김, `#chips` 는 비어도 `#go` 클릭 시 `/map.html` 로 이동. 또 `good:null` 만 바꾼 응답에서는 `#exGood` 만 숨김.
  6. **localStorage 차단(Review Focus 2):** `addInitScript` 로 `Object.defineProperty(window,"localStorage",{get(){throw new Error("blocked")}})` → `/` 정상 표시, `#go` 클릭 시 `/map.html` 이동, `pageerror` 0.
  7. **모바일 390×844(Review Focus 5):** `document.documentElement.scrollWidth <= 390`, `#go` 가 화면 안(boundingBox 하단 ≤ 844), ①②③ 블록의 x 좌표가 같음(세로 배치).
  - 전 시나리오 `pageerror` 0. 마지막 `console.log("start e2e OK")`.

- [ ] **Step 2: Run to verify it fails**
  Run: `node scripts/e2e-start.mjs`
  Expected: 시나리오 1 실패(`#hero` 없음)

- [ ] **Step 3: Write `public/index.html`** — 시안 A 레이아웃, 숫자 자리는 빈 요소, `<script src="start.js?v=1" defer>`. 720px 이하 미디어쿼리: ①②③ 세로, 화살표 ↓, 하단 버튼 영역 `position:sticky; bottom:0`. `<title>르슐랭 가이드</title>`.

- [ ] **Step 4: Write `public/start.js`**
  - `safeGet()/safeSet()` 로 localStorage 를 try/catch 로 감싼다.
  - `/api/showcase` 를 불러 채운다. 실패하면 `#ex.hidden = true`. `good`/`bad`/`video`/`store` 가 `null` 이면 그 블록만 숨긴다.
  - 칩: `creators` 순서대로. 저장값 중 `creators` 에 있는 id 만, 앞에서부터 최대 3개를 미리 선택. 4번째 클릭은 무시하고 `#pickCnt` 를 잠깐 강조.
  - 숫자는 `toLocaleString("ko-KR")`, 조회수는 지도와 같은 "만" 단위 표기.
  - 사용자 텍스트(댓글 본문 등)는 `textContent` 로 넣는다(innerHTML 금지).

- [ ] **Step 5: Run to verify it passes**
  Run: `node scripts/e2e-start.mjs`
  Expected: `start e2e OK`

- [ ] **Step 6: Commit**
  ```bash
  git add public/index.html public/start.js scripts/e2e-start.mjs
  git commit -m "시작 화면 — 핵심 문장 + 실제 식당 예시 + 유튜버 선택"
  ```

---

### Task 3: 지도와 연결

**Files:**
- Modify: `public/app.js` (부팅 `:657-663`, 선택 `select` `:384` 부근)
- Modify: `public/map.html` (`.brand` `:456`, `app.js?v=` 해시)
- Test: `scripts/e2e-start.mjs` 에 시나리오 추가

**Interfaces:**
- Consumes: Task 2 의 `/map.html?store=<id>` 링크, `lesulin.fav`.
- Produces: `/map.html?store=<id>` → 해당 식당 상세가 열리고 지도가 그 위치로 이동. `.brand` 는 `<a href="/">`.

- [ ] **Step 1: Add failing scenarios to `scripts/e2e-start.mjs`**
  8. `/map.html?store=s126` → 6초 안에 `.det` 존재, `.det-title` 에 `복춘식당`, `#favWrap` 숨김.
  9. `/map.html` (저장값 없음) → `#favWrap` 숨김(자동으로 안 뜸). `/map.html?pick=1` → `#favWrap` 보임.
  10. `/map.html?store=nope`(Review Focus 4) → `.rcard` 1개 이상, `pageerror` 0.
  11. `/map.html` 에서 `.brand` 클릭 → URL 이 `/` 로 끝남.
  12. 전체 흐름: `/` → 칩 2개 → `#go` → `.pinbox.mine, .kcluster.mine` 1개 이상 → `/` 로 돌아가 `#exMap` 클릭 → 복춘식당 상세 → `.det a.pri` href 가 `https://map.kakao.com/link/to/` 로 시작.

- [ ] **Step 2: Run to verify they fail**
  Run: `node scripts/e2e-start.mjs`
  Expected: 시나리오 8 실패

- [ ] **Step 3: Implement**
  - 부팅: `if (!asked || force) openFav();` → `if (force) openFav();`
  - 부팅 끝(지도 준비 이후 포함): `?store=` 가 `stores` 에 있으면 `select(id)` 를 호출하고, 지도가 준비되면 그 좌표로 이동(이미 `select` 가 하는 동작을 그대로 쓰되 `kmap` 이 늦게 생기는 경우 지도 초기화 직후 한 번 더 이동). 없으면 무시.
  - `.brand` 를 `<a class="brand" href="/" title="처음 화면으로">` 로 바꾸고 기존 스타일 유지(`text-decoration:none;color:inherit`).
  - `app.js?v=` 해시 갱신(`map.html` 만).

- [ ] **Step 4: Run to verify they pass**
  Run: `node scripts/e2e-start.mjs`
  Expected: `start e2e OK`

- [ ] **Step 5: Commit**
  ```bash
  git add public/app.js public/map.html scripts/e2e-start.mjs
  git commit -m "지도: ?store= 로 상세 열기, 자동 유튜버 창 끄기, 로고 → 시작 화면"
  ```

---

### Task 4: 배포와 실제 주소 점검

**Files:**
- Modify: `README.md` (실행·시연 주소 부분에 시작 화면 / 지도 경로 한 줄씩)

- [ ] **Step 1: 빌드**
  Run: `rm -rf .next && npx tsc --noEmit && npx next build`
  Expected: 타입 오류 0, `ƒ /api/showcase` 가 목록에 있음

- [ ] **Step 2: 배포**
  Run: `npx vercel deploy --prod --yes`
  Expected: `Aliased https://lesulin-guide.vercel.app`

- [ ] **Step 3: 배포 주소로 전체 점검**
  Run: `node scripts/check-showcase.mjs https://lesulin-guide.vercel.app && node scripts/e2e-start.mjs https://lesulin-guide.vercel.app && node scripts/probe.mjs`
  Expected: `showcase OK`, `start e2e OK`, probe `오류: 없음`

- [ ] **Step 4: 변경 전후 캡처** — 전: 커밋 `cce2773` 시점 배포가 아니라 현재 `/map.html` 첫 화면(1440·390), 후: `/` (1440·390). scratchpad 에 png 4장.

- [ ] **Step 5: Commit**
  ```bash
  git add README.md
  git commit -m "README: 시작 화면·지도 경로"
  ```
