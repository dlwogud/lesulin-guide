"""중복 가게 합치기 확인 — data/store_merges.json 이 DB 와 지도 API 에 반영됐는지.

    .venv/bin/python scripts/check_merges.py [기준 주소]     기본값: http://localhost:3000
"""
import json, os, sys, urllib.request
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parent.parent
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
M = json.load(open(ROOT / "data" / "store_merges.json", encoding="utf-8"))["merges"]
fails = []
ok = lambda c, m: c or fails.append(m)

with psycopg.connect(os.environ["DATABASE_URL"]) as cx:
    for m in M:
        dh, note = cx.execute("SELECT hidden, coalesce(hide_note,'') FROM stores WHERE id=%s", (m["dup"],)).fetchone()
        kh, = cx.execute("SELECT hidden FROM stores WHERE id=%s", (m["keep"],)).fetchone()
        ok(dh, f"{m['dup']} 가 숨겨지지 않음")
        ok(m["keep"] in note, f"{m['dup']} 숨김 메모에 {m['keep']} 가 없음")
        ok(not kh, f"남길 가게 {m['keep']} 가 숨겨져 있음")
    rated, = cx.execute("""SELECT count(*) FROM store_stats st JOIN stores s ON s.id=st.store_id
                           WHERE st.status='RATED' AND NOT s.hidden""").fetchone()

seed = json.load(urllib.request.urlopen(f"{BASE}/api/seed", timeout=60))
ids = {s["id"] for s in seed["stores"]}
for m in M:
    ok(m["dup"] not in ids, f"지도에 {m['dup']} 가 아직 나옴")
    ok(m["keep"] in ids, f"지도에 {m['keep']} 가 없음")
ok(seed["meta"]["rated"] == rated, f"meta.rated {seed['meta']['rated']} ≠ 숨김 뺀 {rated}")
ok(seed["meta"]["stores"] == len(ids), f"meta.stores {seed['meta']['stores']} ≠ 지도 식당 {len(ids)}")

for f in fails: print("  ✗", f)
print("merges OK" if not fails else f"\n실패 {len(fails)}건"); sys.exit(1 if fails else 0)
