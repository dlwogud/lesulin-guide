"""펼친 지도 링크 + 영상 → data/stores_real.json.

  python3 scripts/build_stores.py

좌표 주의: 구글 지도 공유 URL의 `/@위도,경도,17z` 는 핀이 아니라 **지도 중심**입니다.
같은 가게가 네이버 좌표와 200m쯤 어긋나서, 그냥 두면 한 가게가 둘로 들어옵니다.
그래서 (1) 네이버 좌표를 우선하고 (2) 350m 안에서 상호의 핵심이 같으면 합칩니다.

시군구는 통계청 2013 경계 폴리곤에 좌표를 찍어서 정합니다. 지도 API를 쓰지 않습니다.
"""
import collections, json, math, pathlib, re

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"
DUP_M = 350

norm = lambda s: re.sub(r"[\s\-·,()\[\]'\"]+", "", str(s))

# 상호 뒤에 붙는 업태·지점 표기. 떼고 핵심만 비교합니다.
TAIL = re.compile(
    r"(정육점식당|정육식당|정육점|정육상회|정육|식육식당|식육점|식육|농장|목장|상회|"
    r"생고기|숯불구이|숯불갈비|참숯구이|소금구이|고깃집|구이|갈비|한우|흑돼지|막창|곱창|"
    r"본점|본관|별관|직영점|분점|지점|식당)+$")


def core(name):
    k = norm(name)
    for _ in range(3):
        k2 = TAIL.sub("", k)
        if k2 == k or len(k2) < 2:
            break
        k = k2
    return k


def same_place(a, b):
    ka, kb = core(a), core(b)
    if len(ka) < 2 or len(kb) < 2:
        ka, kb = norm(a), norm(b)
    return ka == kb or ka.startswith(kb) or kb.startswith(ka)


def load_regions():
    K = json.load(open(ROOT / "data" / "korea.json", encoding="utf-8"))
    KX, SC = K["k"] * K["scale"], K["scale"]
    out = []
    for f in K["sgg"]:
        polys = []
        for seg in f["d"].split("M")[1:]:
            pts = [tuple(map(float, p.split(","))) for p in seg.rstrip("Z").split("L") if "," in p]
            if len(pts) >= 3:
                polys.append(pts)
        out.append((f["p"], f["n"], polys))
    return out, KX, SC


def inside(poly, x, y):
    c, n = False, len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def main():
    R = json.load(open(RAW / "resolved.json", encoding="utf-8"))
    LV = json.load(open(RAW / "links_v.json", encoding="utf-8"))
    byLink = collections.defaultdict(list)
    for r in LV:
        byLink[r["link"]].append(r)

    # 1. 링크 하나 = 장소 하나
    places = []
    for p in R:
        lat, lng = p.get("lat"), p.get("lng")
        if not lat or not (33 < lat < 39 and 124 < lng < 132):
            continue                                    # 해외·좌표 없음 제외
        places.append({"n": p["n"], "lat": lat, "lng": lng, "src": p["src"],
                       "addr": p.get("addr", ""), "cat": p.get("cat", ""),
                       "vids": byLink.get(p["link"], [])})

    # 2. 설명란에 링크가 없는 채널 — 제목에서 뽑아 카카오 로컬로 실재 확인한 것들
    gpath = RAW / "geocoded.json"
    if gpath.exists():
        for g in json.load(open(gpath, encoding="utf-8")):
            if not g.get("ok"):
                continue
            places.append({"n": g["place"], "lat": g["lat"], "lng": g["lng"], "src": "kakao",
                           "addr": g["addr"], "cat": g["cat"],
                           "vids": [{"vid": g["vid"], "vt": g["vt"], "at": g["at"], "cid": g["cid"]}]})

    # 3. 또간집 — 제목·설명란에 상호가 없어 댓글에서 뽑고 카카오로 확인한 것들
    dpath = RAW / "ddogan.json"
    if dpath.exists():
        for g in json.load(open(dpath, encoding="utf-8")):
            if not g.get("ok"):
                continue
            places.append({"n": g["place"], "lat": g["lat"], "lng": g["lng"], "src": "kakao",
                           "addr": g["addr"], "cat": g["cat"],
                           "vids": [{"vid": g["vid"], "vt": g["vt"], "at": g["at"], "cid": "c4"}]})

    # 4. 신규 채널 — 설명란 양식·네이버 플레이스·댓글에서 뽑아 확인한 것들
    #    서울 사는 남자(c10)와 지뉼랭가이드(c14)는 각각 2곳·5곳뿐이어서 넣지 않았습니다.
    #    채널로 고를 만한 양이 안 됩니다.
    SKIP_CH = {"c10", "c14"}
    for f in ("newch_places.json", "struct_places.json", "cmtnames_c2.json"):
        fp = RAW / f
        if not fp.exists():
            continue
        n0 = len(places)
        for g in json.load(open(fp, encoding="utf-8")):
            if not g.get("ok") or g["cid"] in SKIP_CH:
                continue
            places.append({"n": g["place"], "lat": g["lat"], "lng": g["lng"],
                           "src": g.get("src", "kakao"), "addr": g["addr"], "cat": g["cat"],
                           "vids": [{"vid": g["vid"], "vt": g["vt"], "at": g["at"], "cid": g["cid"]}]})
        print(f"  {f:<22}{len(places)-n0:>5}건")

    # 5. 네이버(정확) 먼저 놓고, 구글(지도 중심)을 거기에 붙입니다
    places.sort(key=lambda p: (p["src"] not in ("naver", "kakao"), -len(p["addr"])))
    kept = []
    for p in places:
        hit = None
        for k in kept:
            d = math.hypot((p["lat"] - k["lat"]) * 111_000, (p["lng"] - k["lng"]) * 89_000)
            if d <= DUP_M and same_place(p["n"], k["n"]):
                hit = k; break
        if not hit:
            kept.append({**p, "vids": list(p["vids"])}); continue
        hit["addr"] = hit["addr"] or p["addr"]
        hit["cat"] = hit["cat"] or p["cat"]
        if len(p["n"]) > len(hit["n"]) and p["src"] in ("naver", "kakao"):
            hit["n"] = p["n"]
        hit["vids"] += p["vids"]

    # 3. 좌표 → 시군구
    SGG, KX, SC = load_regions()
    out, lost = [], 0
    for i, s in enumerate(kept, 1):
        x, y = s["lng"] * KX, -s["lat"] * SC
        reg = next((p + " " + n for p, n, polys in SGG
                    if any(inside(poly, x, y) for poly in polys)), None)
        if not reg:
            lost += 1; continue
        vids, seen = [], set()
        for v in sorted(s["vids"], key=lambda v: v["at"], reverse=True):
            if v["vid"] in seen: continue
            seen.add(v["vid"])
            vids.append({"id": v["vid"], "t": v["vt"], "at": v["at"], "c": v["cid"]})
        out.append({"id": "s%d" % i, "n": s["n"], "r": reg, "addr": s["addr"], "cat": s["cat"],
                    "lat": s["lat"], "lng": s["lng"], "src": s["src"],
                    "cs": sorted({v["c"] for v in vids}), "vids": vids})

    json.dump(out, open(ROOT / "data" / "stores_real.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    src = collections.Counter(s["src"] for s in out)
    print(f"장소 {len(places)}건 → 식당 {len(out)}곳 (중복 {len(places)-len(kept)}건 병합, 시군구 밖 {lost}곳 제외)")
    print(f"좌표 출처: " + " · ".join(f"{k} {v}" for k, v in src.most_common()))
    print(f"영상 {sum(len(s['vids']) for s in out)}편 · 복수 영상 {sum(1 for s in out if len(s['vids'])>1)}곳")
    print(f"주소 확보 {sum(1 for s in out if s['addr'])}곳 · 업종 확보 {sum(1 for s in out if s['cat'])}곳")

    # 남은 중복 점검
    dup = [(a["n"], b["n"], round(math.hypot((a["lat"]-b["lat"])*111_000, (a["lng"]-b["lng"])*89_000)))
           for i, a in enumerate(out) for b in out[i+1:]
           if math.hypot((a["lat"]-b["lat"])*111_000, (a["lng"]-b["lng"])*89_000) <= DUP_M
           and same_place(a["n"], b["n"])]
    print(f"남은 중복 의심 {len(dup)}쌍" + ("" if not dup else ": " + str(dup[:5])))


if __name__ == "__main__":
    main()
