"""파이썬 분류기의 판정을 뽑아 둡니다 — TypeScript 이식본과 맞춰 보는 기준입니다.

  set -a; source .env.local; set +a
  .venv/bin/python scripts/export_golden.py

라벨 200건 + DB 댓글에서 무작위로 고른 것을 섞어 저장합니다.
짧은 것만 모이면 어려운 경우를 못 잡으니 길이대로 골고루 담습니다.
"""
import json, os, pathlib, random, sys
ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import visit_lexicon as VL

N = 2000


def main():
    texts = []
    key = ROOT / "labeling" / "_answer_key.json"
    if key.exists():
        texts += [r["text"] for r in json.load(open(key, encoding="utf-8"))]
        print(f"사람 라벨 {len(texts)}건")

    url = os.environ.get("DATABASE_URL", "")
    if url.startswith(("postgres://", "postgresql://")):
        import psycopg
        with psycopg.connect(url) as cx, cx.cursor() as cur:
            # 길이 구간별로 골고루 — 짧은 것만 모이면 어려운 경우를 못 잡습니다
            for lo, hi, n in ((2, 30, 500), (30, 80, 600), (80, 200, 500), (200, 5000, 400)):
                cur.execute("""SELECT body FROM comments
                                WHERE NOT is_owner AND char_length(body) BETWEEN %s AND %s
                                ORDER BY id LIMIT %s""", (lo, hi, n))
                texts += [r[0] for r in cur.fetchall()]
        print(f"DB 댓글까지 {len(texts)}건")
    else:
        cf = ROOT / "data" / "raw" / "youtube" / "comments2.json"
        if cf.exists():
            d = json.load(open(cf, encoding="utf-8"))
            pool = [c["t"] for b in d.values() for c in b.get("comments", [])]
            random.Random(42).shuffle(pool)
            texts += pool[:N]
            print(f"파일에서 {len(texts)}건")

    seen, uniq = set(), []
    for t in texts:
        if t and t not in seen:
            seen.add(t); uniq.append(t)

    out = [{"t": t, "v": VL.visited(t), "a": VL.analyze(t), "p": VL.promo(t)} for t in uniq]
    path = ROOT / "data" / "golden.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    nv = sum(1 for x in out if x["v"])
    na = sum(1 for x in out if x["a"])
    print(f"\n{len(out)}건 저장 → data/golden.json")
    print(f"  방문 판정 {nv}건 · 항목 검출 {na}건 · 운영자/홍보 {sum(1 for x in out if x['p'])}건")


if __name__ == "__main__":
    main()
