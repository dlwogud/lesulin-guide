"""같은 가게 중복 등록을 합칩니다 — data/store_merges.json 을 DB 에 적용.

    .venv/bin/python scripts/merge_stores.py            미리보기
    .venv/bin/python scripts/merge_stores.py --write    적용

지우지 않고 숨깁니다(stores.hidden). 관리자 화면의 '가림'과 같은 장치라 거기서 되돌릴 수 있고,
데이터를 다시 적재해도(load_db.py) 숨김은 유지됩니다. 두 기록은 같은 영상의 댓글로 집계돼 있어
한쪽을 숨겨도 잃는 데이터가 없습니다. 바꾼 내용은 관리자 화면 '갱신 이력'에 남깁니다.
여러 번 돌려도 같은 결과입니다.
"""
import argparse, json, os
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    merges = json.load(open(ROOT / "data" / "store_merges.json", encoding="utf-8"))["merges"]

    with psycopg.connect(os.environ["DATABASE_URL"]) as cx, cx.cursor() as cur:
        todo = []
        for m in merges:
            cur.execute("SELECT name, hidden, hide_note FROM stores WHERE id = %s", (m["dup"],))
            d = cur.fetchone()
            cur.execute("SELECT name, hidden FROM stores WHERE id = %s", (m["keep"],))
            k = cur.fetchone()
            if not d or not k:
                raise SystemExit(f"없는 가게: {m}")
            if k[1]:
                raise SystemExit(f"남길 가게 {m['keep']} {k[0]} 가 숨겨져 있습니다 — 확인이 필요합니다")
            note = f"중복 — {m['keep']} {k[0]} 과 같은 가게 ({m['why']})"
            state = "이미 반영" if d[1] and d[2] == note else "합침"
            print(f"  {state:<6} {m['dup']:<6}{d[0][:20]:<21} → {m['keep']:<6}{k[0][:20]}")
            if state == "합침":
                todo.append((m, d, note))

        if not args.write:
            print(f"\n미리보기 — {len(todo)}건을 합칩니다. 적용하려면 --write")
            return
        for m, d, note in todo:
            cur.execute("UPDATE stores SET hidden = true, hide_note = %s, updated_at = now() WHERE id = %s",
                        (note, m["dup"]))
            cur.execute("""INSERT INTO audit_log (admin_id, action, entity, entity_id, before, after)
                           VALUES (NULL, 'merge', 'store', %s, %s, %s)""",
                        (m["dup"], Jsonb({"hidden": d[1], "hide_note": d[2]}),
                         Jsonb({"hidden": True, "hide_note": note, "merged_into": m["keep"]})))
        cx.commit()
        print(f"\n적용: {len(todo)}건")


if __name__ == "__main__":
    main()
