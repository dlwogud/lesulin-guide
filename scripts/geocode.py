"""카카오 로컬 API로 시드 매장의 실제 좌표를 채웁니다.

  export KAKAO_REST_API_KEY=...
  python3 scripts/geocode.py
"""
import json, os, pathlib, sys, time, urllib.parse, urllib.request

KEY = os.environ.get("KAKAO_REST_API_KEY")
SEED = pathlib.Path(__file__).parent.parent / "data" / "seed.json"


def search(q):
    url = "https://dapi.kakao.com/v2/local/search/keyword.json?" + urllib.parse.urlencode({"query": q, "size": 1})
    req = urllib.request.Request(url, headers={"Authorization": f"KakaoAK {KEY}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        d = json.load(r).get("documents") or []
    return d[0] if d else None


if __name__ == "__main__":
    if not KEY: sys.exit("KAKAO_REST_API_KEY가 없습니다.")
    data = json.loads(SEED.read_text())
    hit = 0
    for s in data["stores"]:
        try:
            d = search(f"{s['storeName']} {s['region']}")
        except Exception as e:
            print(f"  실패 {s['storeName']}: {e}"); continue
        if not d:
            print(f"  미발견 {s['storeName']}"); continue
        s.update(lat=float(d["y"]), lng=float(d["x"]),
                 roadAddress=d.get("road_address_name") or None,
                 category=d.get("category_group_name") or None,
                 phone=d.get("phone") or None,
                 placeProvider="kakao", placeProviderId=d["id"],
                 coordSource="kakao-local")       # 실좌표로 승격
        hit += 1
        time.sleep(0.12)
    SEED.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f"좌표 확보 {hit}/{len(data['stores'])}곳")
