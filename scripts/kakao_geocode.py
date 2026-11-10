"""후보('지역 + 상호') → 카카오 로컬에서 실재 확인 → 좌표·주소·업종.

  set -a; source .env.local; set +a
  python3 scripts/kakao_geocode.py

검색해서 나왔다고 바로 쓰지 않습니다. 세 가지를 모두 넘어야 채택합니다.
  1. 업종이 음식점(FD6) 또는 카페(CE7)일 것
  2. 카카오 상호와 우리가 뽑은 상호가 실제로 겹칠 것 — "부산 돼지국밥"으로 검색해서
     아무 국밥집이나 잡히면 가짜 데이터가 됩니다
  3. 주소가 제목에서 읽은 지역과 맞을 것

셋 중 하나라도 어긋나면 버립니다. 추측해서 채우지 않습니다.
"""
import json, os, pathlib, re, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"
KEY = os.environ.get("KAKAO_REST_API_KEY")
FOOD = {"FD6", "CE7"}

# 표기 흔들림을 먼저 고릅니다. "송셰프"와 "송쉐프"는 같은 집입니다.
VARIANT = str.maketrans({"쉐": "셰", "뀨": "규", "쮸": "주", "뽀": "보"})
norm = lambda s: re.sub(r"[\s\-·,()\[\]'\"&!?~]+", "", str(s)).translate(VARIANT)

# 지점 표기. 한 번만, 보수적으로 뗍니다.
BRANCH = re.compile(r"(본점|본관|별관|직영점|분점|\d+호점|[가-힣]{1,4}점)$")
# 상호 앞에 붙는 위치 수식어. "신사역 송셰프"의 "신사역"을 떼야 맞출 수 있습니다.
PLACEWORD = re.compile(r"^[가-힣A-Za-z0-9]{1,8}(역|동|읍|면|리|로|길|가|시장|사거리|삼거리|"
                       r"네거리|로데오|타워|빌딩|센터|지하|상가|터미널|대입구|공원|해변|해수욕장)$")


def core(n):
    k = BRANCH.sub("", norm(n))
    return k if len(k) >= 2 else norm(n)


def strip_place(name, region):
    """앞에 붙은 지역 수식어를 뗍니다. 전부 지역어면 원래 이름을 돌려줍니다."""
    toks = [t for t in str(name).split() if t]
    regs = set(region.split())
    while len(toks) > 1 and (PLACEWORD.match(toks[0]) or toks[0] in regs):
        toks.pop(0)
    return " ".join(toks) if toks else name


def bigrams(k):
    return {k[i:i+2] for i in range(len(k) - 1)} or {k}


def name_ok(mine, theirs, region):
    a, b = core(strip_place(mine, region)), core(theirs)
    if len(a) < 2 or len(b) < 2:
        return False
    if a == b or a in b or b in a:
        return True
    A, B = bigrams(a), bigrams(b)          # 한 글자 차이는 허용 — "엄마순대"와 "엄마24시순대"
    return len(A & B) / len(A | B) >= .5


# 제목의 지역 힌트 → 주소에 나타날 수 있는 표기들
ALIAS = {
    "충북": ["충북", "충청북도"], "충남": ["충남", "충청남도"],
    "전북": ["전북", "전라북도"], "전남": ["전남", "전라남도"],
    "경북": ["경북", "경상북도"], "경남": ["경남", "경상남도"],
    "강원": ["강원"], "제주": ["제주"],
}


def region_ok(hint, addr):
    """지역 힌트가 주소에 실제로 들어 있는가."""
    toks = hint.split()
    head = toks[0]
    cands = ALIAS.get(head, [head])
    if not any(c in addr for c in cands):
        return False
    if len(toks) > 1:                      # "서울 남대문" 처럼 동 단위 힌트가 붙은 경우
        return True                        # 시도만 맞으면 통과시킵니다 (동 표기가 주소와 다를 수 있음)
    return True


def search(q, size=5):
    u = "https://dapi.kakao.com/v2/local/search/keyword.json?" + urllib.parse.urlencode(
        {"query": q, "size": size})
    rq = urllib.request.Request(u, headers={"Authorization": "KakaoAK " + KEY})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(rq, timeout=15) as r:
                return json.load(r).get("documents", [])
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(1.2 * (attempt + 1)); continue
            body = e.read().decode()[:160]
            if e.code == 403:
                sys.exit(f"카카오 권한 오류: {body}\n"
                         "[내 애플리케이션] > [제품 설정] > [카카오맵] 활성화를 확인하세요.")
            return []
        except Exception:
            time.sleep(.8)
    return []


def resolve(c):
    docs = search(c["q"])
    if not docs:
        return {**c, "ok": False, "why": "검색 결과 없음"}
    for d in docs:
        addr = (d.get("road_address_name") or "") + " " + (d.get("address_name") or "")
        if d.get("category_group_code") not in FOOD:
            continue
        if not name_ok(c["name"], d["place_name"], c["region"]):
            continue
        if not region_ok(c["region"], addr):
            continue
        return {**c, "ok": True,
                "place": d["place_name"],
                "addr": d.get("road_address_name") or d.get("address_name", ""),
                "cat": (d.get("category_name", "").split(">")[-1].strip() or "음식점"),
                "lat": float(d["y"]), "lng": float(d["x"]),
                "kid": d.get("id", "")}
    top = docs[0]
    why = ("업종 불일치" if top.get("category_group_code") not in FOOD else
           "상호 불일치" if not name_ok(c["name"], top["place_name"], c["region"]) else "지역 불일치")
    return {**c, "ok": False, "why": f"{why} (1순위: {top['place_name']} / {top.get('address_name','')[:18]})"}


def main():
    if not KEY:
        sys.exit("KAKAO_REST_API_KEY가 없습니다. set -a; source .env.local; set +a 후 실행하세요.")
    cands = json.load(open(RAW / "candidates.json", encoding="utf-8"))
    print(f"후보 {len(cands)}개 확인 중…\n")
    t0, out = time.time(), []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, r in enumerate(ex.map(resolve, cands), 1):
            out.append(r)
            if i % 60 == 0:
                print(f"  {i}/{len(cands)} · 채택 {sum(1 for x in out if x['ok'])} · {time.time()-t0:.0f}초", flush=True)
    json.dump(out, open(RAW / "geocoded.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    import collections
    names = {"c1": "성시경", "c2": "쯔양", "c3": "히밥"}
    per = collections.defaultdict(lambda: [0, 0])
    for r in out:
        per[r["cid"]][0 if r["ok"] else 1] += 1
    print(f"\n{'채널':<8}{'후보':>6}{'채택':>6}{'버림':>6}{'채택률':>8}")
    print("-" * 36)
    for cid, (ok, no) in sorted(per.items()):
        print(f"{names.get(cid, cid):<8}{ok+no:>6}{ok:>6}{no:>6}{100*ok/(ok+no):>7.0f}%")
    tot_ok = sum(1 for r in out if r["ok"])
    print("-" * 36)
    print(f"{'합계':<8}{len(out):>6}{tot_ok:>6}{len(out)-tot_ok:>6}{100*tot_ok/len(out):>7.0f}%")

    print("\n채택된 것:")
    for r in [x for x in out if x["ok"]][:12]:
        print(f"  {r['q'][:22]:<24}→ {r['place'][:22]:<24}{r['addr'][:26]:<28}{r['cat'][:10]}")
    print("\n버린 이유:")
    for why, n in collections.Counter(r["why"].split(" (")[0] for r in out if not r["ok"]).most_common():
        print(f"  {why:<14}{n:>4}개")


if __name__ == "__main__":
    main()
