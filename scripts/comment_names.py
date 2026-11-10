"""제목에 지역만 있고 상호가 없는 영상 — 댓글에서 상호를 뽑습니다.

  set -a; source .env.local; set +a
  python3 scripts/comment_names.py c2

또간집에 쓴 방법(scripts/ddogan.py)을 쯔양에 옮긴 것입니다.
쯔양은 제목에 "의정부 부대찌개 거리 첫번째집"처럼 지역만 적고 상호를 안 적습니다.
대신 댓글에 "장흥식당 38회"처럼 한 가게로 쏠립니다.

표본 12편으로 먼저 재 봤습니다 — 5편(42%)에서 상호가 특정됐습니다.
히밥에도 같은 검사를 했는데 0편이었습니다(댓글이 13~51개뿐이고 상호 언급이 없음).
그래서 히밥은 넣지 않았습니다.

빈도만 믿지 않습니다. 2위와 차이가 없으면 버리고, 카카오에서 실재가 확인돼야 채택합니다.
"""
import collections, json, os, pathlib, re, sys, time
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"
sys.path.insert(0, str(ROOT / "scripts"))
import ddogan as D
from extract_candidates import ABROAD
from kakao_geocode import name_ok, region_ok, FOOD
from extract_candidates import is_generic

MIN_HITS, MIN_LEAD = 4, 1.5
# 가격·수량이 상호로 잡히는 걸 막습니다 ("1900원", "30만원", "10개정")
NUM = re.compile(r"\d")
REG, DONG = re.compile(D.REGION), re.compile(D.DONG)


def region_of(title):
    m = DONG.search(title)
    if m:
        return "서울 " + m.group(0)
    m = REG.search(title)
    return m.group(0) if m else None


def same_store(name, place, region):
    """댓글에 적힌 말이 상호인지, 업태인지 가립니다.

    댓글이 "닭강정"이라 했는데 카카오가 "신포찬누리닭강정"을 돌려주면
    그 가게인지 알 수 없습니다. 카카오가 앞에 다른 말을 붙였으면 버립니다.
    "성수족발"처럼 이름이 정확히 같으면 그게 상호입니다.
    """
    n, p = re.sub(r"\s", "", name), re.sub(r"\s", "", place)
    if n == p:
        return True
    if not p.startswith(n):
        return False                      # 앞에 다른 상호가 붙음 → 다른 가게
    return not is_generic(name, region)   # "단골집 수유재래시장점" 류


def handle(v):
    reg = region_of(v["t"])
    cs = D.comments(v["id"], pages=4)
    base = {"cid": CID, "vid": v["id"], "vt": v["t"][:90], "at": v["at"], "region": reg}
    if len(cs) < 60:
        return {**base, "ok": False, "why": f"댓글 부족 ({len(cs)})"}
    cnt = collections.Counter()
    for c in cs:
        for m in set(D.NAME.findall(c)):
            if NUM.search(m) or D.GENERIC.search(m):
                continue
            cnt[m] += 1
    top = cnt.most_common(3)
    base["cands"] = [[k, n] for k, n in top]
    if not top or top[0][1] < MIN_HITS:
        return {**base, "ok": False, "why": f"언급 부족 ({top[0][1] if top else 0}회)"}
    if len(top) > 1 and top[0][1] < top[1][1] * MIN_LEAD:
        return {**base, "ok": False, "why": f"1·2위 접전 ({top[0][0]} vs {top[1][0]})"}

    name = top[0][0]
    for d in D.ksearch(f"{reg} {name}"):
        addr = (d.get("road_address_name") or "") + " " + (d.get("address_name") or "")
        if d.get("category_group_code") not in FOOD:
            continue
        if not name_ok(name, d["place_name"], reg) or not region_ok(reg, addr):
            continue
        if not same_store(name, d["place_name"], reg):
            continue
        return {**base, "ok": True, "name": name, "q": f"{reg} {name}",
                "place": d["place_name"],
                "addr": d.get("road_address_name") or d.get("address_name", ""),
                "cat": (d.get("category_name", "").split(">")[-1].strip() or "음식점"),
                "lat": float(d["y"]), "lng": float(d["x"]), "src": "kakao", "kid": d.get("id")}
    return {**base, "ok": False, "why": f"카카오 미확인 ({name})"}


def main():
    global CID
    CID = sys.argv[1] if len(sys.argv) > 1 else "c2"
    if not (os.environ.get("YOUTUBE_API_KEY") and os.environ.get("KAKAO_REST_API_KEY")):
        sys.exit("YOUTUBE_API_KEY / KAKAO_REST_API_KEY 둘 다 필요합니다.")

    V = json.load(open(RAW / f"{CID}_full.json", encoding="utf-8"))["videos"]
    have = {x["vid"] for x in json.load(open(RAW / "geocoded.json", encoding="utf-8")) if x.get("ok")}
    pf = RAW / f"cmtnames_{CID}.json"
    prev, seen = [], set()
    if pf.exists():
        prev = json.load(open(pf, encoding="utf-8"))
        seen = {r["vid"] for r in prev}
        print(f"이미 검사한 {len(seen)}편은 건너뜁니다.")

    todo = [v for v in V
            if region_of(v["t"]) and not ABROAD.search(v["t"])
            and v["id"] not in have and v["id"] not in seen]
    print(f"검사 대상 {len(todo)}편 (쿼터 약 {len(todo)*4})\n")

    out, t0 = list(prev), time.time()
    with ThreadPoolExecutor(max_workers=3) as ex:
        for i, r in enumerate(ex.map(handle, todo), 1):
            out.append(r)
            if i % 25 == 0:
                ok = sum(1 for x in out if x.get("ok"))
                print(f"  {i}/{len(todo)} · 채택 {ok}곳 · {time.time()-t0:.0f}초", flush=True)
                json.dump(out, open(pf, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(out, open(pf, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    ok = [r for r in out if r.get("ok")]
    print(f"\n{len(out)}편 → 가게 {len(ok)}곳 ({100*len(ok)/len(out):.0f}%) · {time.time()-t0:.0f}초")
    for r in ok[:15]:
        print(f"   {r['region']:<6}{r['name'][:14]:<16}({r['cands'][0][1]:>2}회) → {r['place'][:20]:<22}{r['addr'][:24]}")
    print("\n버린 이유:")
    for why, n in collections.Counter(r["why"].split(" (")[0] for r in out if not r.get("ok")).most_common():
        print(f"   {why:<16}{n:>4}편")


if __name__ == "__main__":
    main()
