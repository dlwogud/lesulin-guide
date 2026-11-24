"""수집·분석 결과를 PostgreSQL에 적재합니다.

  set -a; source .env.local; set +a
  .venv/bin/python scripts/load_db.py            # 전부
  .venv/bin/python scripts/load_db.py --stats    # 집계만 다시

읽는 것
  data/seed_real.json              식당·영상·집계·배지 (build_real_seed.py 산출)
  data/raw/youtube/comments2.json  영상별 원문 댓글

여러 번 돌려도 같은 결과가 되게 만들었습니다(upsert). 댓글은 (영상, 본문, 날짜)로
중복을 막습니다 — 같은 영상을 다시 받아도 쌓이지 않습니다.

사람 검수(admin_reviews)는 건드리지 않습니다. 분류기를 다시 돌려도 남아야 합니다.
"""
import argparse, json, os, pathlib, sys, time
import psycopg
from psycopg.types.json import Jsonb

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"
sys.path.insert(0, str(ROOT / "scripts"))
import visit_lexicon as VL
from build_real_seed import CREATORS, OWNERS

MODEL = "rule:visit_lexicon@v2"
BATCH = 2000


def connect():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url.startswith(("postgres://", "postgresql://")):
        # 값을 찍지 않습니다 — 비밀번호가 기록에 남습니다.
        sys.exit("DATABASE_URL 이 비었거나 postgresql:// 형식이 아닙니다.\n"
                 "  .env.local 을 채우고 set -a; source .env.local; set +a 후 다시 실행하세요.")
    return psycopg.connect(url, autocommit=False)


def log_run(cur, step, **kw):
    cur.execute("""INSERT INTO pipeline_runs (step, model, finished_at, ok, counts, message)
                   VALUES (%s,%s,now(),%s,%s,%s) RETURNING id""",
                (step, MODEL, kw.get("ok", True), Jsonb(kw.get("counts") or {}), kw.get("message")))
    return cur.fetchone()[0]


def load_base(cur, seed):
    cur.executemany("""INSERT INTO creators (id,name,handle,short_name,color,channel_id,subscribers)
        VALUES (%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, handle=EXCLUDED.handle,
          short_name=EXCLUDED.short_name, color=EXCLUDED.color, subscribers=EXCLUDED.subscribers""",
        [(c["id"], c["n"], c.get("handle"), c["h"], c["col"],
          CREATORS[c["id"]]["yt"], c.get("subs")) for c in seed["creators"]])

    S = seed["stores"]
    cur.executemany("""INSERT INTO stores (id,name,address,region,category,lat,lng,coord_source)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, address=EXCLUDED.address,
          region=EXCLUDED.region, category=EXCLUDED.category, lat=EXCLUDED.lat,
          lng=EXCLUDED.lng, coord_source=EXCLUDED.coord_source, updated_at=now()""",
        [(s["id"], s["n"], s.get("addr"), s["r"], s.get("cat"),
          s["lat"], s["lng"], s.get("src")) for s in S])

    vids = {}
    for s in S:
        for v in s["vids"]:
            vids[v["id"]] = v
    cur.executemany("""INSERT INTO videos (id,creator_id,title,published_at,views,duration)
        VALUES (%s,%s,%s,%s,%s,%s)
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, views=EXCLUDED.views,
          duration=EXCLUDED.duration""",
        [(v["id"], v["c"], v["t"], v.get("at"), v.get("vw"), v.get("dur")) for v in vids.values()])

    cur.executemany("""INSERT INTO store_videos (store_id,video_id) VALUES (%s,%s)
                       ON CONFLICT DO NOTHING""",
        [(s["id"], v["id"]) for s in S for v in s["vids"]])
    return len(seed["creators"]), len(S), len(vids)


def clean(t):
    """Postgres text 는 NUL(0x00)을 못 받습니다. 유튜브 댓글에 실제로 섞여 있습니다."""
    return str(t).replace("\x00", "") if t else t


def load_comments(cur, known_videos):
    path = RAW / "comments2.json"
    if not path.exists():
        print("  comments2.json 이 없어 댓글은 건너뜁니다.")
        return 0
    data = json.load(open(path, encoding="utf-8"))
    rows, n = [], 0
    for vid, blk in data.items():
        if vid not in known_videos:
            continue                                   # 식당에 연결 안 된 영상은 넣지 않습니다
        for c in blk.get("comments", []):
            au = c.get("au", "")
            owner = au in OWNERS or VL.promo(c["t"])   # 운영자 고정 댓글·협찬 고지는 방문자 반응이 아닙니다
            rows.append((vid, clean(c["t"]), c.get("at"), c.get("like", 0), clean(au), owner))
            if len(rows) >= BATCH:
                n += flush_comments(cur, rows); rows = []
    if rows:
        n += flush_comments(cur, rows)
    return n


def flush_comments(cur, rows):
    cur.executemany("""INSERT INTO comments (video_id,body,published_at,likes,author_id,is_owner)
        VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""", rows)
    return len(rows)


def analyze(cur, run_id):
    """DB에 있는 댓글을 분류기에 통과시켜 결과를 남깁니다. 이미 같은 모델로 본 것은 건너뜁니다."""
    cur.execute("""SELECT c.id, c.body FROM comments c
                   LEFT JOIN comment_analysis a ON a.comment_id = c.id AND a.model = %s
                   WHERE NOT c.is_owner AND a.comment_id IS NULL""", (MODEL,))
    todo = cur.fetchall()
    print(f"  분석할 댓글 {len(todo):,}개")
    an, asp, t0 = [], [], time.time()
    for i, (cid, body) in enumerate(todo, 1):
        v = VL.visited(body)
        an.append((cid, v, MODEL, run_id))
        if v:
            for a, pol in VL.analyze(body).items():
                asp.append((cid, a, pol))
        if i % 50000 == 0:
            print(f"    {i:,}/{len(todo):,} · {time.time()-t0:.0f}초", flush=True)
    cur.executemany("""INSERT INTO comment_analysis (comment_id,is_visit,model,run_id)
        VALUES (%s,%s,%s,%s) ON CONFLICT (comment_id) DO UPDATE
        SET is_visit=EXCLUDED.is_visit, model=EXCLUDED.model, run_id=EXCLUDED.run_id,
            analyzed_at=now()""", an)
    cur.executemany("""INSERT INTO comment_aspects (comment_id,aspect,polarity)
        VALUES (%s,%s,%s) ON CONFLICT (comment_id,aspect) DO UPDATE
        SET polarity=EXCLUDED.polarity""", asp)
    return len(an), len(asp)


def load_stats(cur, seed):
    """집계는 build_real_seed.py 가 이미 낸 값을 그대로 옮깁니다.

    같은 수치를 SQL로 다시 계산하면 두 곳에서 규칙이 갈라집니다
    (배지 기준·운영자 제외·대기 분리 모두 그 스크립트에 있습니다).
    산출은 한 곳에서만 합니다.
    """
    rows = [(s["id"], s.get("cTotal", 0), s.get("cUsed", 0), s.get("cVisit", 0),
             s.get("negN", 0), s.get("waitN", 0),
             Jsonb(s.get("aspects") or []), Jsonb(s.get("quotes") or {}),
             s.get("lvl"), s.get("status", "NEW")) for s in seed["stores"]]
    cur.executemany("""INSERT INTO store_stats
        (store_id,comments_all,comments_used,visits,negatives,waits,aspects,quotes,guide_level,status)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (store_id) DO UPDATE SET
          comments_all=EXCLUDED.comments_all, comments_used=EXCLUDED.comments_used,
          visits=EXCLUDED.visits, negatives=EXCLUDED.negatives, waits=EXCLUDED.waits,
          aspects=EXCLUDED.aspects, quotes=EXCLUDED.quotes,
          guide_level=EXCLUDED.guide_level, status=EXCLUDED.status, updated_at=now()""", rows)
    # 100점 점수와 점수 기반 배지 — 공식은 db/score.sql 한 곳에만 둡니다(그 파일을 먼저 적용해야 합니다)
    cur.execute("SELECT lesulin_refresh_scores()")
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stats", action="store_true", help="집계만 다시 넣습니다")
    ap.add_argument("--no-analyze", action="store_true", help="분류기는 돌리지 않습니다")
    a = ap.parse_args()

    seed = json.load(open(ROOT / "data" / "seed_real.json", encoding="utf-8"))
    t0 = time.time()
    with connect() as cx, cx.cursor() as cur:
        if a.stats:
            n = load_stats(cur, seed); cx.commit()
            print(f"집계 {n}곳 갱신 · {time.time()-t0:.0f}초"); return

        run_id = log_run(cur, "load_db", counts={"stores": len(seed["stores"])})
        nc, ns, nv = load_base(cur, seed)
        cx.commit()
        print(f"  채널 {nc} · 식당 {ns:,} · 영상 {nv:,}")

        known = {v["id"] for s in seed["stores"] for v in s["vids"]}
        ncm = load_comments(cur, known); cx.commit()
        cur.execute("SELECT count(*) FROM comments")
        print(f"  댓글 {ncm:,}건 넣기 시도 → 테이블 {cur.fetchone()[0]:,}건")

        if not a.no_analyze:
            na, nasp = analyze(cur, run_id); cx.commit()
            print(f"  분석 {na:,}건 · 항목 {nasp:,}건")

        nst = load_stats(cur, seed); cx.commit()
        print(f"  집계 {nst:,}곳")

        cur.execute("""SELECT count(*) FILTER (WHERE is_visit) FROM comment_analysis""")
        visits = cur.fetchone()[0]
        cur.execute("UPDATE pipeline_runs SET ok=true, counts=%s WHERE id=%s",
                    (Jsonb({"stores": ns, "videos": nv, "comments": ncm, "visits": visits}), run_id))
        cx.commit()
        print(f"\n완료 · {time.time()-t0:.0f}초 · 방문 명시 {visits:,}건")


if __name__ == "__main__":
    main()
