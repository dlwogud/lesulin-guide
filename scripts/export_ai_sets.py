"""규칙 / LLM / 혼합 비교용 표본을 한 형식으로 뽑습니다.

  .venv/bin/python scripts/export_ai_sets.py

  labeling/ai/dev.json   1차 200건 — 규칙을 고칠 때 이미 본 표본. 혼합 분기 조건·프롬프트를 만드는 데만 씁니다.
  labeling/ai/eval.json  2차 100건 — 규칙·프롬프트 조정에 쓰지 않은 표본. 마지막 비교 전까지 열어 보지 않습니다.

각 줄: {id, comment_id?, store, video, text, human(True/False), stratum?}
사람이 애매함(?)으로 둔 방문 판정, 아직 안 채운 줄은 뺍니다.
댓글 원문이 들어 있어 labeling/ (git 제외) 아래에 둡니다.
"""
import json, os, pathlib, sys

import psycopg

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from score_labels import load_human  # noqa: E402

OUT = ROOT / "labeling" / "ai"


def video_titles(vids):
    with psycopg.connect(os.environ["DATABASE_URL"]) as c:
        rows = c.execute("SELECT id, title FROM videos WHERE id = ANY(%s)", [list(vids)]).fetchall()
    return dict(rows)


def build(lab, titles=None):
    key = json.load(open(lab / "_answer_key.json", encoding="utf-8"))
    human, _ = load_human(lab)
    out = []
    for r in key:
        h = human.get(r["id"])
        if not h:
            continue
        out.append({
            "id": r["id"],
            "comment_id": r.get("comment_id"),
            "store": r["store"],
            "video": r.get("video") or (titles or {}).get(r.get("vid"), ""),
            "text": r["text"],
            "human": h["visit"],
            **({"stratum": r["stratum"]} if "stratum" in r else {}),
        })
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    k1 = json.load(open(ROOT / "labeling" / "_answer_key.json", encoding="utf-8"))
    dev = build(ROOT / "labeling", video_titles({r["vid"] for r in k1 if r.get("vid")}))
    ev = build(ROOT / "labeling" / "round2")
    meta = json.load(open(ROOT / "labeling" / "round2" / "_meta.json", encoding="utf-8"))
    json.dump(dev, open(OUT / "dev.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump({"meta": meta, "items": ev}, open(OUT / "eval.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"dev  {len(dev)}건 (사람 방문 {sum(r['human'] for r in dev)}) · 영상 제목 있음 {sum(1 for r in dev if r['video'])}")
    print(f"eval {len(ev)}건 (방문 쪽 {sum(1 for r in ev if r.get('stratum'))} / 비방문 쪽 {sum(1 for r in ev if not r.get('stratum'))}) — 내용은 출력하지 않습니다")


if __name__ == "__main__":
    main()
