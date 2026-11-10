# 르슐랭 가이드

> 낯선 동네에서 **내가 보던 맛집 유튜버가 다녀간 식당**을 지도에서 찾고,
> 원본 영상과 방문자 반응까지 확인하는 서비스.
> 순천향대 AI 빅데이터 캡스톤디자인 2026 · 4조

## 무엇을 하는가

유튜버 10명의 영상 1,541편에서 식당 **1,512곳**을 뽑아 지도에 올리고,
그 영상의 댓글 **273,863건**을 항목별 감성 분류기에 통과시켜
"영상을 보고 몇 명이 다녀왔다고 말했는가"를 보여 줍니다.

대표 지표를 긍정률이 아니라 **방문 반응 수**로 둔 이유: 유튜브 댓글의 맛 긍정률은
94.4%로 천장에 붙어 있어 가게를 가리지 못합니다. 실제로 갈린 것은 방문 언급 수이고,
변별력이 있는 항목은 **대기**(긍정률 1.7%) 하나입니다.

## 데이터

| | 수치 |
|---|---|
| 유튜버 | 10명 (쯔양 1,350만 … 묵짜 19만) |
| 식당 | 1,512곳 |
| 영상 | 1,541편 |
| 댓글 | 273,863건 |
| 방문 명시로 분류 | 12,445건 |
| 항목 집계 | 8,650건 |
| 점수 산출 | 597곳 |
| 르슐랭 배지 | 24곳 |

**채널마다 가게 정보가 적힌 자리가 다릅니다** — 이게 이 프로젝트의 핵심 제약입니다.

| 방식 | 채널 |
|---|---|
| 설명란 지도 링크 | 정육왕 279 · 김사원세끼 120 |
| `식당명:` · `📍매장명:` 양식 | 회사랑 348 · 상해기 277 · 재슐랭 239 · 묵짜 36 |
| 제목 | 성시경 147 |
| 댓글 빈도 | 또간집 43 · 쯔양 71 |

## 구조

```
public/map.html · app.js    사용자 화면 (카카오맵 + 자체 클러스터링)
src/app/api/                seed · polls · classify · track · feedback · admin
src/app/admin/              운영자 화면 (6개 중점 심사 항목)
src/lib/classify.ts         감성 분류기 (TypeScript 이식본, 실시간 호출용)
scripts/visit_lexicon.py    감성 분류기 (원본, 배치 처리용)
scripts/                    수집 → 추출 → 지오코딩 → 적재 파이프라인
db/*.sql                    PostgreSQL 스키마
```

### 분류기가 둘인 이유와 동일성 보장

배치 처리는 Python(`scripts/visit_lexicon.py`), 실시간 호출은
TypeScript(`src/lib/classify.ts`)입니다. Vercel 의 Next 런타임이 Node 라서
Python 을 바로 부를 수 없고, 별도 서비스로 띄우면 무료 티어 콜드스타트가
30~50초라 시연에서 쓸 수 없습니다.

구현이 갈라지지 않게 **동일성 테스트**로 묶었습니다:

```bash
.venv/bin/python scripts/export_golden.py          # 파이썬 판정을 기준으로 뽑기
node --experimental-strip-types scripts/check_parity.ts
#  표본 2,168건 · 방문 0 · 항목 0 · 홍보 0 불일치 → 통과
```

사전을 고칠 때 한쪽만 고치면 이 테스트가 실패합니다.

## 실행

### 1. 환경변수

```bash
cp .env.example .env.local
```

| 키 | 받는 곳 | 노출 |
|---|---|---|
| `NEXT_PUBLIC_KAKAO_MAP_KEY` | 카카오 개발자 → JavaScript 키 | 브라우저 (도메인 등록으로 보호) |
| `KAKAO_REST_API_KEY` | 카카오 개발자 → REST API 키 | **서버 전용** |
| `YOUTUBE_API_KEY` | Google Cloud → YouTube Data API v3 | **서버 전용** |
| `DATABASE_URL` | Supabase → Connect → Session pooler | **서버 전용** |
| `ADMIN_SECRET` | 직접 생성 (아래) | **서버 전용** |

```bash
python3 -c "import secrets;print(secrets.token_urlsafe(48))"   # ADMIN_SECRET
```

### 2. 설치

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install "psycopg[binary]" pypdf
```

### 3. DB 만들기

```bash
set -a; source .env.local; set +a
.venv/bin/python scripts/db_init.py                       # 기본 13개 테이블
for f in db/polls.sql db/usage.sql db/admin.sql db/manage.sql db/feedback.sql db/ailog.sql; do
  .venv/bin/python scripts/db_init.py --file "$f"
done
.venv/bin/python scripts/load_db.py                       # 적재 + 분류기 실행
.venv/bin/python scripts/make_admin.py you@example.com    # 관리자 계정
```

### 4. 띄우기

```bash
npm run dev          # http://localhost:3000/map.html
```

운영자 화면은 `/login`.

## 수집 파이프라인

처음부터 데이터를 다시 모으려면 순서대로 실행합니다. 모두 **증분 실행**이라
이미 받은 것은 건너뜁니다.

```bash
set -a; source .env.local; set +a

# ① 채널 영상 목록 (50편당 쿼터 1)
python3 scripts/collect_channel.py c6 UC-x55HF1-IilhxZOzwJm7JA "김사원세끼"

# ② 식당 뽑기 — 채널 양식에 따라 셋 중 하나
python3 scripts/extract_candidates.py && python3 scripts/kakao_geocode.py   # 제목
python3 scripts/collect_newch.py                                            # 네이버 링크·주소 양식
python3 scripts/collect_struct.py                                           # 📍매장명 양식
python3 scripts/comment_names.py c2                                         # 댓글 빈도
python3 scripts/ddogan.py                                                   # 또간집

# ③ 합치고 중복 제거 (350m 안에서 상호 핵심이 같으면 한 가게)
python3 scripts/build_stores.py

# ④ 조회수·재생시간
python3 scripts/collect_stats.py

# ⑤ 댓글 (영상당 최대 400개, 쿼터 4)
python3 scripts/collect_comments.py --max-pages 4

# ⑥ 분류기 적용 → seed_real.json
python3 scripts/build_real_seed.py

# ⑦ DB 적재
.venv/bin/python scripts/load_db.py
```

## 배포 (Vercel)

```bash
npx vercel          # 첫 배포
npx vercel --prod
```

환경변수 5개를 Vercel 프로젝트 설정에 넣어야 합니다.

### ⚠️ 카카오 지도 키

JS 키는 **설계상 숨길 수 없습니다** — 브라우저가 카카오에 직접 요청하므로
개발자도구로는 늘 보입니다. 보호 장치는 비밀 유지가 아니라
**카카오 콘솔의 도메인 허용목록**입니다.

배포 순서를 지켜야 합니다:

1. Vercel 프로젝트 이름을 먼저 정해 최종 주소를 확정
2. 카카오 개발자 콘솔 → 앱 설정 → 플랫폼 → Web 에 그 주소 등록
3. 배포

키는 `/api/mapkey` 가 환경변수에서 읽어 내려주므로 **소스코드와 저장소에는
남지 않습니다**. `localhost` 는 콘솔에 등록할 수 없어
로컬에서만 리퍼러를 끕니다(`setMapReferrer()` in `public/app.js`) —
배포 도메인에서는 끄지 않습니다. 끄면 링크를 아는 누구나 이 키를 쓸 수 있습니다.

## 측정으로 끝난 것

재시도하지 않기 위해 적어 둡니다.

**르몽 리뷰 데이터와의 연결 (0.3%)** — 유튜버 방문 식당 617곳 중 2곳만
르몽 매장 32,449곳과 겹쳤습니다. 르몽은 14,903,204건 중 98.5%가 배달 리뷰이고
유튜버가 가는 노포는 배달을 안 합니다. 두 모집단이 서로를 배제하므로
데이터가 늘어도 교집합은 커지지 않습니다. → 르몽은 **감성 사전의 출처**로만 씁니다.

**대형 먹방 채널 추가** — 구독 100만 이상 9개를 재보니 가게 추출 가능성이
거의 0입니다(입짧은햇님 1.0% · 문복희 4.0% · 홍사운드 0% · 승우아빠 0% ·
백종원 50.5%지만 전부 해외편). 인지도와 추출 가능성이 반대입니다.
가게 정보를 적는 쪽은 20~50만 규모 맛집 리뷰 채널입니다.

**히밥은 8곳이 천장** — 제목·설명란·댓글 어디에도 가게 단서가 없습니다
(댓글 표본 12편 전부 실패).

## 알려진 한계

- 서울 편중 — 1,512곳 중 907곳(60%)
- 댓글의 "다녀왔다"는 **텍스트 분류**이지 방문 인증이 아닙니다
- 분류기 정확도는 사람 검수 기준이며 `/admin` 에서 실시간 계산됩니다
- 익명 식별이 localStorage 기반이라 시크릿 창에서는 새 사용자가 됩니다
- 투표·토론에 욕설·스팸 필터가 없습니다 (운영자가 `hidden` 으로 가릴 수는 있습니다)
