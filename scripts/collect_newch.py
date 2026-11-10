"""신규 채널에서 식당을 뽑습니다. 채널마다 상호가 적힌 자리가 달라 따로 처리합니다.

  set -a; source .env.local; set +a
  python3 scripts/collect_newch.py

  c6  김사원세끼    설명란에 naver.me 단축링크 1개 (1영상 1가게)
  c8  회사랑        설명란이 "- 식당명 : / - 식당위치 :" 로 완전히 구조화돼 있습니다
  c10 서울 사는 남자  설명란에 naver.me 가 여러 개 (한 영상에 여러 가게)

  c7 하이갱스·c9 츄릅켠은 넣지 않았습니다. 설명란에 "📍평창" 처럼 지역만 있거나
  "주소는 여기서 확인하세요" 같은 안내문만 있어 가게를 특정할 수 없습니다(각 3편·2편).

네이버 쪽은 공개 API가 없어 단축링크를 따라가 플레이스 페이지에서 읽습니다.
카카오 쪽은 로컬 API로 상호+주소를 맞춰 확인합니다. 어느 쪽이든 확인 안 되면 버립니다.
"""
import json, os, pathlib, re, sys, threading, time
import urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"
sys.path.insert(0, str(ROOT / "scripts"))
from extract_candidates import ABROAD

KKEY = os.environ.get("KAKAO_REST_API_KEY")
FOOD = ("FD6", "CE7")
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1"}

NAVER_ME = re.compile(r"naver\.me/[A-Za-z0-9]+")
PLACE_ID = re.compile(r"/(?:entry/)?place/(\d+)|[?&]pinId=(\d+)")
SHOP_NAME = re.compile(r"식당\s*명\s*[:：]\s*([^\n(（]{2,30})")
SHOP_ADDR = re.compile(r"식당\s*위치\s*[:：]\s*([^\n]{6,60})")

_lock = threading.Lock()


def kakao(ep, **p):
    if not KKEY:
        sys.exit("KAKAO_REST_API_KEY 가 없습니다.")
    u = f"https://dapi.kakao.com/v2/local/{ep}.json?" + urllib.parse.urlencode(p)
    rq = urllib.request.Request(u, headers={"Authorization": "KakaoAK " + KKEY})
    for t in range(3):
        try:
            with urllib.request.urlopen(rq, timeout=15) as r:
                return json.load(r).get("documents", [])
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(1.0 * (t + 1)); continue
            return []
        except Exception:
            time.sleep(.6)
    return []


def _get(url, tries=4):
    """네이버는 공개 API가 없어 페이지를 읽습니다. 429가 잦아 쉬면서 다시 시도합니다."""
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                return r.geturl(), r.read().decode("utf-8", "ignore")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                time.sleep(2.0 * (t + 1)); continue
            return None, None
        except Exception:
            time.sleep(1.0)
    return None, None


def naver_place(short):
    """naver.me → 플레이스 id → 상호·주소·좌표. 즐겨찾기 폴더 링크는 가게가 아니라 건너뜁니다."""
    final, _ = _get("https://" + short)
    if not final:
        return None
    m = PLACE_ID.search(final)
    if not m:
        return None                                   # sharedPlace/folder 등
    pid = m.group(1) or m.group(2)
    for kind in ("restaurant", "place"):
        _, h = _get(f"https://m.place.naver.com/{kind}/{pid}/home")
        if not h:
            continue
        nm = re.search(r'"name":"([^"]{2,30})"', h)
        xy = re.search(r'"x":"([\d.]+)","y":"([\d.]+)"', h)
        ad = re.search(r'"roadAddress":"([^"]*)"', h) or re.search(r'"address":"([^"]*)"', h)
        ct = re.search(r'"category":"([^"]{2,20})"', h)
        if nm and xy:
            return {"pid": pid, "name": nm.group(1), "addr": (ad.group(1) if ad else ""),
                    "cat": (ct.group(1) if ct else ""),
                    "lat": float(xy.group(2)), "lng": float(xy.group(1))}
    return None


def region_of(addr):
    p = addr.split()
    return " ".join(p[:2]) if len(p) >= 2 else (p[0] if p else "")


def from_naver_links(cid, videos):
    """c6·c10 — 설명란 naver.me 를 전부 따라갑니다."""
    jobs = []
    for v in videos:
        if ABROAD.search(v["t"]):
            continue
        for s in dict.fromkeys(NAVER_ME.findall(v.get("d", ""))):
            jobs.append((s, v))
    print(f"  단축링크 {len(jobs)}개를 따라갑니다...", flush=True)

    out, done = [], [0]
    def work(job):
        s, v = job
        p = naver_place(s)
        with _lock:
            done[0] += 1
            if done[0] % 50 == 0:
                print(f"    {done[0]}/{len(jobs)} · 확인 {len(out)}곳", flush=True)
        if not p or not p["addr"] or not p["addr"].startswith(("서울","부산","대구","인천","광주",
                "대전","울산","세종","경기","강원","충북","충남","전북","전남","경북","경남","제주")):
            return
        with _lock:
            out.append({"cid": cid, "q": s, "name": p["name"], "region": region_of(p["addr"]),
                        "vid": v["id"], "vt": v["t"][:90], "at": v["at"], "ok": True,
                        "place": p["name"], "addr": p["addr"], "cat": p["cat"] or "음식점",
                        "lat": p["lat"], "lng": p["lng"], "src": "naver", "nid": p["pid"]})
    with ThreadPoolExecutor(max_workers=2) as ex:
        list(ex.map(work, jobs))
    return out


def from_structured(cid, videos):
    """c8 회사랑 — 설명란의 식당명·식당위치를 카카오로 맞춰 봅니다."""
    jobs = []
    for v in videos:
        d = v.get("d", "")
        n, a = SHOP_NAME.search(d), SHOP_ADDR.search(d)
        if not (n and a):
            continue
        name, addr = n.group(1).strip(" -·,"), a.group(1).strip()
        if ABROAD.search(v["t"] + " " + addr):
            continue
        jobs.append((name, addr, v))
    print(f"  구조화된 {len(jobs)}편을 카카오로 확인합니다...", flush=True)

    out, done = [], [0]
    def work(job):
        name, addr, v = job
        got = None
        # ① 상호 + 주소 앞부분으로 검색 ② 상호만 ③ 주소로 좌표만 받아 반경 30m 음식점
        head = " ".join(addr.split()[:2])
        for q in (f"{head} {name}", name):
            for d in kakao("search/keyword", query=q, size=5):
                if d.get("category_group_code") not in FOOD:
                    continue
                pn = re.sub(r"\s", "", d["place_name"])
                if re.sub(r"\s", "", name)[:4] not in pn and pn[:4] not in re.sub(r"\s", "", name):
                    continue
                got = d; break
            if got: break
        if not got:
            ad = kakao("search/address", query=addr, size=1)
            if ad:
                near = kakao("search/category", category_group_code="FD6",
                             x=ad[0]["x"], y=ad[0]["y"], radius=30, sort="distance", size=10)
                for d in near:
                    pn = re.sub(r"\s", "", d["place_name"])
                    if re.sub(r"\s", "", name)[:3] in pn or pn[:3] in re.sub(r"\s", "", name):
                        got = d; break
        with _lock:
            done[0] += 1
            if done[0] % 60 == 0:
                print(f"    {done[0]}/{len(jobs)} · 확인 {len(out)}곳", flush=True)
            if got:
                out.append({"cid": cid, "q": name, "name": name,
                            "region": region_of(got.get("road_address_name") or got.get("address_name","")),
                            "vid": v["id"], "vt": v["t"][:90], "at": v["at"], "ok": True,
                            "place": got["place_name"],
                            "addr": got.get("road_address_name") or got.get("address_name", ""),
                            "cat": (got.get("category_name","").split(">")[-1].strip() or "음식점"),
                            "lat": float(got["y"]), "lng": float(got["x"]),
                            "src": "kakao", "kid": got.get("id")})
    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(work, jobs))
    return out


def main():
    jobs = [("c6", "김사원세끼", from_naver_links),
            ("c8", "회사랑", from_structured),
            ("c10", "서울 사는 남자", from_naver_links)]
    only = set(sys.argv[1:])
    if only:
        jobs = [j for j in jobs if j[0] in only]
    prev = []
    pf = RAW / "newch_places.json"
    if only and pf.exists():
        prev = [r for r in json.load(open(pf, encoding="utf-8")) if r["cid"] not in only]
        print(f"다른 채널에서 이미 찾은 {len(prev)}곳은 그대로 둡니다.")
    allp, t0 = list(prev), time.time()
    for cid, nm, fn in jobs:
        V = json.load(open(RAW / f"{cid}_full.json", encoding="utf-8"))["videos"]
        print(f"\n{nm} · 영상 {len(V)}편")
        got = fn(cid, V)
        uniq, seen = [], set()
        for g in sorted(got, key=lambda x: x["at"], reverse=True):
            k = (round(g["lat"], 4), round(g["lng"], 4))
            if k in seen:
                continue
            seen.add(k); uniq.append(g)
        allp += uniq
        print(f"  → 가게 {len(uniq)}곳 (중복 {len(got)-len(uniq)}곳 합침)")
        for g in uniq[:5]:
            print(f"      {g['name'][:16]:<18}{g['addr'][:34]}")
    json.dump(allp, open(RAW / "newch_places.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"\n합계 {len(allp)}곳 · {time.time()-t0:.0f}초 → data/raw/youtube/newch_places.json")


if __name__ == "__main__":
    main()
