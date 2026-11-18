"""사람 라벨링 시트를 새로 뽑습니다 — 방문/비방문 쪽 N건씩 층화 표본.

    .venv/bin/python scripts/make_label_round.py labeling/round2 --n 50

1차(labeling/)와 같은 형식이고, 판단하기 쉽게 식당·영상 칸을 붙였습니다.
한 사람이 한 번에 보도록 파일 하나로 만들고, 이름은 넣지 않습니다.

- 분류기가 "다녀왔다"로 본 댓글 N건 + 아니라고 본 댓글 N건. 비방문 쪽이 전체의 95%라
  무작위로만 뽑으면 방문 쪽이 거의 안 걸립니다. 채점에서 전체 크기로 보정합니다
  (score_labels.py · _meta.json).
- 1차 200건과 겹치는 댓글은 뺍니다. 분류기 사전을 1차 결과를 보며 고쳤으므로,
  처음 보는 댓글로 재야 부풀려지지 않은 점수가 나옵니다.
- 두 쪽을 섞어서 시트만 보고는 분류기 판단을 알 수 없게 합니다.
- 순서는 해시로 고정 — 다시 돌려도 같은 표본이 나옵니다.
- 라벨링 결과는 git 에 올리지 않습니다(.gitignore 의 /labeling/).
"""
import argparse
import csv
import datetime
import json
import os
import random
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
FIRST = ROOT / "labeling"
COLS = ["번호", "식당", "영상", "댓글", "방문함(O/X)",
        "맛", "양", "가격", "서비스", "대기", "분위기", "애매함(?)", "메모"]

SAMPLE = """
SELECT c.id, c.body, a.is_visit, v.title,
       (SELECT string_agg(DISTINCT s.name, ' / ') FROM store_videos sv JOIN stores s ON s.id = sv.store_id
         WHERE sv.video_id = c.video_id) AS stores
  FROM comments c
  JOIN comment_analysis a ON a.comment_id = c.id
  JOIN videos v ON v.id = c.video_id
 WHERE NOT c.is_owner AND a.is_visit = %s
 ORDER BY md5(%s || c.id::text)
 LIMIT %s
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", help="만들 폴더 (예: labeling/round2)")
    ap.add_argument("--n", type=int, default=50, help="쪽마다 몇 건")
    ap.add_argument("--seed", default="round2")
    ap.add_argument("--sheet", default="라벨링_2차.csv", help="만들 시트 파일 이름")
    args = ap.parse_args()
    out = ROOT / args.out
    if out.exists() and any(out.glob("라벨링_*.csv")):
        sys.exit(f"{args.out} 에 이미 시트가 있습니다. 채운 걸 덮어쓰지 않도록 멈춥니다.")
    out.mkdir(parents=True, exist_ok=True)

    seen = {r["text"].strip() for r in json.load(open(FIRST / "_answer_key.json", encoding="utf-8"))}

    with psycopg.connect(os.environ["DATABASE_URL"]) as cx:
        pop_v, pop_n = cx.execute("""SELECT count(*) FILTER (WHERE is_visit), count(*) FILTER (WHERE NOT is_visit)
                                       FROM comment_analysis""").fetchone()
        rows = []
        for visit in (True, False):
            got = [r for r in cx.execute(SAMPLE, (visit, args.seed + ":", args.n * 3)).fetchall()
                   if r[1].strip() not in seen][: args.n]
            if len(got) < args.n:
                sys.exit(f"{'방문' if visit else '비방문'} 쪽 표본이 {len(got)}건뿐입니다")
            rows += got

    random.Random(args.seed).shuffle(rows)                 # 두 쪽을 섞습니다
    items = []
    for i, (cid, body, visit, title, stores) in enumerate(rows, 1):
        items.append({"id": f"R{i:03d}", "comment_id": cid,
                      "store": stores or "", "video": title, "text": body.strip(), "stratum": bool(visit)})

    sheet = lambda it: {"번호": it["id"], "식당": it["store"], "영상": it["video"], "댓글": it["text"]}
    def write(path, part):
        with open(path, "w", encoding="utf-8-sig", newline="") as f:    # 엑셀에서 한글이 깨지지 않게
            w = csv.DictWriter(f, fieldnames=COLS); w.writeheader()
            for it in part:
                w.writerow(sheet(it))

    write(out / args.sheet, items)
    json.dump(items, open(out / "_answer_key.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump({"pop_visit": pop_v, "pop_non": pop_n, "n_per_stratum": args.n, "seed": args.seed,
               "created": datetime.date.today().isoformat()},
              open(out / "_meta.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    guide = (FIRST / "라벨링_지침.md").read_text(encoding="utf-8")
    for old, new in [
        ("본인 이름 파일(`라벨링_○○○.csv`)을 엑셀이나 구글시트로 열어서 채워주세요. **34건 내외, 약 30분**입니다.",
         f"`{args.sheet}`를 엑셀이나 구글시트로 열어서 채워주세요. **{len(items)}건, 약 1시간**입니다. "
         "`식당`·`영상` 칸을 보고 어느 가게 얘기인지 판단하면 됩니다."),
        ("- **본인 판단으로만** 채우세요. 다른 사람 시트를 보거나 상의하지 마세요. 그러면 측정이 무의미해집니다.",
         "- **본인 판단으로만** 채우세요. 다른 사람과 상의하면 측정이 무의미해집니다."),
        ("- 다 되면 파일 그대로 저장해서 보내주세요.", "- 다 되면 파일 그대로 저장하면 됩니다."),
    ]:
        assert old in guide, old[:30]
        guide = guide.replace(old, new)
    guide = guide.replace("그 식당에 **실제로 가봤다고 말하는** 댓글이면 `O`, 아니면 `X`.",
                          "`식당` 칸의 가게에 **실제로 가봤다고 말하는** 댓글이면 `O`, 아니면 `X`.\n"
                          "**다른 가게에 다녀온 얘기면 `X`**입니다.")
    (out / "라벨링_지침.md").write_text(guide, encoding="utf-8")

    print(f"{args.out}/{args.sheet}: {len(items)}건 (방문 쪽 {args.n} · 비방문 쪽 {args.n})")
    print(f"전체 댓글: 방문 {pop_v:,} · 비방문 {pop_n:,}")


if __name__ == "__main__":
    main()
