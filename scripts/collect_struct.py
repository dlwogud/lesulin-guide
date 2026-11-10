"""설명란에 상호·주소를 적는 채널에서 식당을 뽑습니다.

  set -a; source .env.local; set +a
  python3 scripts/collect_struct.py            # c11~c14 전부
  python3 scripts/collect_struct.py c12        # 일부만

채널마다 적는 양식이 달라 따로 읽습니다.
  c11 상해기       산문 안에 '김밥사랑' 처럼 따옴표로 들어갑니다
  c12 재슐랭가이드   📍매장명 : / 📍위치 :
  c13 묵짜         [자갈치시장 부영집] 다음 줄에 📍 위치
  c14 지뉼랭가이드   제목에 [연신내 문간], 설명란에 주소:

상호와 주소를 같이 얻은 것만 카카오 로컬로 확인합니다. 확인 안 되면 버립니다.
카카오가 상호 앞에 다른 말을 붙여 돌려주면 다른 가게로 보고 버립니다.
"""
import collections, json, os, pathlib, re, sys, threading, time
import urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"
sys.path.insert(0, str(ROOT / "scripts"))
from extract_candidates import ABROAD, is_generic, SIDO, SEOUL_DONG

KKEY = os.environ.get("KAKAO_REST_API_KEY")
FOOD = ("FD6", "CE7")
SIDO_RE = re.compile(SIDO)
ADDR_LINE = re.compile(r"((?:" + SIDO + r")[^\n,|·]{4,46}?\s\d[\d\-]*)")
_lock = threading.Lock()


def kakao(ep, **p):
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


def clean(n):
    n = re.sub(r"[\[\]'‘’“”\"]", "", n).strip(" -·,.")
    n = re.sub(r"\s*\(.*?\)\s*", " ", n).strip()
    return n


# ── 채널별로 (상호, 주소) 를 읽어 냅니다 ────────────────────────────────
NAME_C12 = re.compile(r"(?:매장|식당|가게|상호)\s*명?\s*[:：]\s*([^\n(（📍🏠⏰#]{2,30})")
ADDR_C12 = re.compile(r"(?:위치|주소)\s*[:：]\s*([^\n📍🏠⏰#]{6,60})")
NAME_C13 = re.compile(r"^\s*\[([^\]\n]{2,30})\]\s*$", re.M)
ADDR_C13 = re.compile(r"위치\s*[:：]?\s*\n?\s*([^\n]{6,60})")
NAME_C14 = re.compile(r"\[([^\]\n]{2,30})\]")
QUOTED = re.compile(r"[‘'\"“]([가-힣A-Za-z0-9][가-힣A-Za-z0-9 ·&]{1,14})[’'\"”]")


def pairs_c12(v):
    d = v.get("d", "")
    n, a = NAME_C12.search(d), ADDR_C12.search(d)
    return [(n.group(1), a.group(1))] if (n and a) else []


def pairs_c13(v):
    d = v.get("d", "")
    n, a = NAME_C13.search(d), ADDR_C13.search(d)
    if not a:
        a = ADDR_LINE.search(d)
    return [(n.group(1), a.group(1))] if (n and a) else []


def pairs_c14(v):
    n = NAME_C14.search(v["t"])
    a = re.search(r"주소\s*[:：]\s*([^\n]{6,60})", v.get("d", "")) or ADDR_LINE.search(v.get("d", ""))
    return [(n.group(1), a.group(1))] if (n and a) else []


def pairs_c11(v):
    """상해기 — "🏠매장명: ○○ 📍위치: ○○" 양식이 먼저고, 없으면 산문 따옴표를 봅니다."""
    got = pairs_c12(v)
    if got:
        return got
    d = v.get("d", "")
    a = ADDR_LINE.search(d)
    reg = a.group(1) if a else None
    if not reg:
        m = re.search(r"((?:" + SIDO + r")\s?[가-힣]{1,4}(?:구|시|군))", d)
        reg = m.group(1) if m else None
    if not reg:
        return []
    out = []
    for q in dict.fromkeys(QUOTED.findall(d)):
        q = clean(q)
        if len(q) < 2 or re.search(r"\d", q):
            continue
        out.append((q, reg))
    return out[:2]                      # 따옴표가 여럿이면 앞 두 개만


JOBS = [("c11", "상해기", pairs_c11), ("c12", "재슐랭가이드", pairs_c12),
        ("c13", "묵짜", pairs_c13), ("c14", "지뉼랭가이드", pairs_c14)]


def same_store(name, place):
    n, p = re.sub(r"\s", "", name), re.sub(r"\s", "", place)
    return n == p or p.startswith(n) or n.startswith(p)


def variants(name):
    """묵짜는 "[자갈치시장 부영집]"처럼 시장 이름을 앞에 붙입니다.
    지뉼랭은 "[연신내 문간]"처럼 동네 이름을 붙입니다.
    앞 토큰을 하나씩 떼면서 상호만 남겨 봅니다."""
    t = name.split()
    out = [name]
    for i in range(1, len(t)):
        v = " ".join(t[i:])
        if len(re.sub(r"\s", "", v)) >= 2:
            out.append(v)
    return out


def verify(job):
    cid, name, addr, v = job
    name = clean(name)
    if len(name) < 2:
        return None
    head = " ".join(addr.split()[:2])
    for nm in variants(name):
        got = _try(cid, nm, addr, head, v)
        if got:
            return got
    return None


def _try(cid, name, addr, head, v):
    if is_generic(name, addr):
        return None
    for q in (f"{head} {name}", name):
        for d in kakao("search/keyword", query=q, size=5):
            if d.get("category_group_code") not in FOOD:
                continue
            if not same_store(name, d["place_name"]):
                continue
            ad = d.get("road_address_name") or d.get("address_name", "")
            if addr.split()[0][:2] not in ad:        # 다른 시·도면 다른 가게
                continue
            return {"cid": cid, "q": f"{head} {name}", "name": name,
                    "region": " ".join(ad.split()[:2]),
                    "vid": v["id"], "vt": v["t"][:90], "at": v["at"], "ok": True,
                    "place": d["place_name"], "addr": ad,
                    "cat": (d.get("category_name", "").split(">")[-1].strip() or "음식점"),
                    "lat": float(d["y"]), "lng": float(d["x"]),
                    "src": "kakao", "kid": d.get("id")}
    return None


def main():
    if not KKEY:
        sys.exit("KAKAO_REST_API_KEY 가 없습니다.")
    only = set(sys.argv[1:])
    jobs = [j for j in JOBS if not only or j[0] in only]
    pf = RAW / "struct_places.json"
    prev = []
    if only and pf.exists():
        prev = [r for r in json.load(open(pf, encoding="utf-8")) if r["cid"] not in only]
        print(f"다른 채널에서 찾은 {len(prev)}곳은 그대로 둡니다.")

    allp, t0 = list(prev), time.time()
    for cid, nm, fn in jobs:
        V = json.load(open(RAW / f"{cid}_full.json", encoding="utf-8"))["videos"]
        todo = []
        for v in V:
            if ABROAD.search(v["t"]):
                continue
            for name, addr in fn(v):
                todo.append((cid, name, addr, v))
        print(f"\n{nm} · 영상 {len(V)}편 → 상호·주소 쌍 {len(todo)}개 확인")
        got, done = [], [0]
        def work(j):
            r = verify(j)
            with _lock:
                done[0] += 1
                if r: got.append(r)
                if done[0] % 100 == 0:
                    print(f"    {done[0]}/{len(todo)} · 확인 {len(got)}곳", flush=True)
        with ThreadPoolExecutor(max_workers=4) as ex:
            list(ex.map(work, todo))
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
    json.dump(allp, open(pf, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n합계 {len(allp)}곳 · {time.time()-t0:.0f}초 → data/raw/youtube/struct_places.json")


if __name__ == "__main__":
    main()
