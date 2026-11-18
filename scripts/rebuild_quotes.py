"""DB 의 대표 댓글(store_stats.quotes)만 scripts/quotes.py 규칙으로 다시 계산합니다.

    .venv/bin/python scripts/rebuild_quotes.py            미리보기 (쓰지 않음)
    .venv/bin/python scripts/rebuild_quotes.py --write    저장

전체 재적재(load_db.py) 대신 이걸 쓰는 이유: 재적재는 관리자가 고친 식당 정보나
댓글 번호(시작 화면 예시가 쓰는)를 건드릴 수 있습니다. 여기서는 quotes 열만 바꿉니다.

후보는 build_real_seed.py 와 같습니다 — 그 식당 영상들의 댓글 중 채널 주인 댓글·홍보 댓글을 빼고,
"다녀왔다"로 분류되고 항목이 하나 이상 잡힌 것. 분류 결과는 DB 의 comment_analysis /
comment_aspects(전체 원문 기준)를 씁니다.

미리보기는 이름 확인을 뺀 같은 규칙을 돌려 지금 저장된 값과 얼마나 같은지도 보여 줍니다.
이름 확인만 새로 넣는 경우라면 전부 같아야 후보를 제대로 모은 것입니다.
"""
import argparse
import collections
import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import visit_lexicon as VL  # noqa: E402
from quotes import pick_quotes, MULTI_PLACE_CREATORS  # noqa: E402

CANDS = """
SELECT sv.store_id, c.id, c.body, c.likes, to_char(c.published_at, 'YYYY-MM-DD') AS at,
       json_object_agg(ca.aspect, ca.polarity) AS asp, c.video_id, v.creator_id
  FROM store_stats st
  JOIN store_videos sv ON sv.store_id = st.store_id
  JOIN comments c ON c.video_id = sv.video_id AND NOT c.is_owner
  JOIN videos v ON v.id = c.video_id
  JOIN comment_analysis an ON an.comment_id = c.id AND an.is_visit
  JOIN comment_aspects ca ON ca.comment_id = c.id
 WHERE st.status = 'RATED'
 GROUP BY sv.store_id, c.id, v.creator_id
"""

# 영상마다 연결된 식당 — 2곳 이상이면 "여러 가게가 나오는 영상"
# 숨긴 가게(중복 합침 등)는 빼고 셉니다 — 두루미×2 처럼 같은 가게가 두 번 있으면 여러 가게 영상이 아닙니다
LINKS = "SELECT sv.video_id, s.id, s.name FROM store_videos sv JOIN stores s ON s.id = sv.store_id AND NOT s.hidden"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="계산한 값을 store_stats.quotes 에 저장")
    args = ap.parse_args()

    with psycopg.connect(os.environ["DATABASE_URL"]) as cx:
        stored = dict(cx.execute("SELECT store_id, quotes FROM store_stats WHERE status='RATED'").fetchall())
        names = dict(cx.execute("SELECT id, name FROM stores").fetchall())
        on_video = collections.defaultdict(dict)
        for vid, sid, nm in cx.execute(LINKS):
            on_video[vid][sid] = nm
        siblings = collections.defaultdict(set)          # 같은 영상에 함께 연결된 다른 식당 이름
        for stores_on in on_video.values():
            for sid in stores_on:
                siblings[sid] |= {n for s2, n in stores_on.items() if s2 != sid}

        by_store = collections.defaultdict(list)
        seen = set()
        for sid, cid, body, likes, at, asp, vid, cre in cx.execute(CANDS):
            if (sid, cid) in seen or VL.promo(body):     # 한 댓글이 같은 식당 영상 둘에 걸려도 한 번만
                continue
            seen.add((sid, cid))
            # 이름으로 셉니다 — 같은 가게가 두 번 등록된 경우(두루미×2)는 한 곳입니다
            multi = len(set(on_video[vid].values())) > 1 or cre in MULTI_PLACE_CREATORS
            by_store[sid].append({"t": body, "like": int(likes or 0), "at": at, "asp": asp, "multi": multi})

        tally = collections.Counter()
        new = {}
        for sid in stored:
            cands = by_store.get(sid, [])
            new[sid] = pick_quotes(cands, name=names[sid], siblings=sorted(siblings[sid]))
            base = pick_quotes(cands)                    # 이름 확인만 뺀 같은 규칙
            cur = stored[sid] or {}
            for k in ("pos", "neg"):
                same = (base[k] or {}).get("x") == (cur.get(k) or {}).get("x")
                tally[f"검증: 이름 확인 없이 = 저장값 ({k})"] += same
                if (new[sid][k] or {}).get("x") != (cur.get(k) or {}).get("x"):
                    tally[f"바뀜 ({k})"] += 1
                if cur.get(k) and not new[sid][k]:
                    tally[f"없어짐 ({k}) — 근거 없어 비움"] += 1

        n = len(stored)
        print(f"RATED 식당 {n}곳 · 후보 댓글 {sum(map(len, by_store.values())):,}건")
        for k, v in sorted(tally.items()):
            print(f"  {k:<36}{v:>5}" + (f"  / {n}" if k.startswith("검증") else ""))

        if not args.write:
            print("\n미리보기입니다. 저장하려면 --write")
            return
        with cx.cursor() as cur:
            cur.executemany("UPDATE store_stats SET quotes = %s, updated_at = now() WHERE store_id = %s",
                            [(Jsonb(q), sid) for sid, q in new.items()])
        cx.commit()
        print(f"\n저장: {len(new)}곳")


if __name__ == "__main__":
    main()
