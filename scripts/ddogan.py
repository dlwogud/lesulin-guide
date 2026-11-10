"""또간집 — 댓글에서 상호를 뽑습니다.

  set -a; source .env.local; set +a
  python3 scripts/ddogan.py

또간집은 제목에도 설명란에도 가게 이름이 없습니다(1,427편 중 위치 단서 1편).
대신 1편에 한 지역·한 가게를 다루는 포맷이라 댓글 400개가 그 가게 하나로 쏠립니다.
  익산편 → 부광족발 39회 · 정읍편 → 청면옥 18회 · 구리편 → 잉꼬칼국수 20회

그래서 (1) 해시태그에서 지역을 읽고 (2) 댓글에서 상호 후보를 세고
(3) 1위 후보를 카카오 로컬에서 찾아 실재를 확인합니다. 못 찾으면 버립니다.

빈도만 믿지 않습니다. 2위와 차이가 없으면 애매한 것으로 보고 버립니다.
"""
import collections, json, os, pathlib, re, sys, time
import urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"
sys.path.insert(0, str(ROOT / "scripts"))
from kakao_geocode import name_ok, region_ok, FOOD           # 같은 검증 규칙을 씁니다

YKEY = os.environ.get("YOUTUBE_API_KEY")
KKEY = os.environ.get("KAKAO_REST_API_KEY")
API = "https://www.googleapis.com/youtube/v3/"

MIN_HITS = 4        # 이보다 적게 언급되면 근거가 약합니다
MIN_LEAD = 1.5      # 1위가 2위보다 이 배수 이상이어야 채택합니다

REGION = (r"서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|"
          r"수원|성남|용인|고양|의정부|여주|이천|강릉|속초|춘천|원주|전주|여수|순천|경주|포항|안동|"
          r"천안|청주|제천|익산|정읍|구리|기장|남양주|시흥|군포|안산|목포|군산|김해|창원|진주|통영|"
          r"거제|평택|파주|김포|광명|부천|안양|과천|하남|양평|가평|홍성|서산|당진|논산|공주|상주|"
          r"구미|영주|문경|영월|태백|동해|삼척|양양|고성|인제|화천|철원|보령|부여|옥천|단양|음성|"
          r"진천|괴산|영동|남원|김제|완주|나주|담양|곡성|구례|순창|영광|고창|부안|무주|장수|임실|"
          r"화성|오산|의왕|구리|포천|양주|동두천|여주|광주시|용인|성남|수지|분당|일산|동탄|송도|청라|"
          r"진해|마산|사천|밀양|양산|거창|합천|의령|함안|창녕|고성|남해|하동|산청|함양|칠곡|성주|고령|"
          r"청도|영천|경산|의성|예천|봉화|울진|영덕|청송|군위|태안|예산|청양|금산|계룡|증평|괴산|"
          r"홍천|횡성|평창|정선|양구|양양|속초|고성|화천|인제|철원|강화|옹진|제천|단양|보은|옥천")
# 서울·수도권은 동 이름으로 더 자주 적습니다
DONG = (r"상암|망원|합정|연남|연희|성수|왕십리|을지로|종로|익선|북촌|서촌|신당|약수|이태원|한남|해방촌|"
        r"후암|남영|삼각지|용산|공덕|마포|홍대|신촌|노량진|영등포|목동|여의도|당산|구로|신림|사당|방배|"
        r"서초|강남|신사|압구정|청담|논현|역삼|삼성동|잠실|석촌|송리단|가락|문정|천호|강동|건대|군자|"
        r"자양|광장동|장안|답십리|청량리|회기|미아|수유|쌍문|창동|노원|상계|불광|연신내|은평|수색|"
        r"응암|신촌동|면목|상봉|중화|묵동|구의|화양|옥수|금호|성북|길음|정릉|혜화|대학로|동묘|황학|"
        r"신설동|제기동|경동시장|동대문|명동|남대문|회현|충무로|필동|장충|신금호")

# 상호처럼 보이는 덩어리
NAME = re.compile(r"([가-힣A-Za-z0-9]{2,10}(?:집|식당|국밥|족발|막국수|칼국수|냉면|분식|반점|옥|관|각|"
                  r"원|정|상회|식육|고깃집|횟집|포차|갈비|곱창|백반|보리밥|순대|떡볶이|해장국|설렁탕|"
                  r"곰탕|쌈밥|회관|수산|어시장|빵집|제과|다방))")
# 업태·방송용어는 상호가 아닙니다
GENERIC = re.compile(r"^(또살|또간|찐맛|맛|우리|저희|그|이|자기|옆|윗|아랫|남의|자취|친정|시댁|본|"
                     r"술|밥|전|가정|풍자|피디|제작)|"
                     r"(칼국수집|곱창집|국밥집|족발집|분식집|백반집|만두집|고깃집|횟집|중국집|술집|"
                     r"밥집|빵집|떡볶이집|순대집|라면집|국수집|갈비집|냉면집)$")


def ycall(ep, **p):
    p["key"] = YKEY
    try:
        with urllib.request.urlopen(API + ep + "?" + urllib.parse.urlencode(p), timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        if e.code == 403 and "quota" in body.lower():
            sys.exit("유튜브 쿼터 초과. 내일 다시 실행하면 이어서 받습니다.")
        return {"_err": f"{e.code}"}
    except Exception:
        return {"_err": "net"}


def ksearch(q, size=5):
    u = "https://dapi.kakao.com/v2/local/search/keyword.json?" + urllib.parse.urlencode(
        {"query": q, "size": size})
    rq = urllib.request.Request(u, headers={"Authorization": "KakaoAK " + KKEY})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(rq, timeout=15) as r:
                return json.load(r).get("documents", [])
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(1.2 * (attempt + 1)); continue
            return []
        except Exception:
            time.sleep(.7)
    return []


def comments(vid, pages=4):
    out, tok = [], None
    for _ in range(pages):
        d = ycall("commentThreads", part="snippet", videoId=vid, maxResults=100,
                  order="relevance", textFormat="plainText", **({"pageToken": tok} if tok else {}))
        if "_err" in d:
            break
        out += [i["snippet"]["topLevelComment"]["snippet"]["textOriginal"] for i in d.get("items", [])]
        tok = d.get("nextPageToken")
        if not tok:
            break
    return out


SEOUL = re.compile(DONG)


def handle(v):
    txt = v["t"] + " " + v["d"]
    m = SEOUL.search(txt)
    region = ("서울 " + m.group(0)) if m else None
    if not region:
        m = re.search(REGION, txt)
        region = m.group(0) if m else None
    if not region:
        return {"vid": v["id"], "ok": False, "why": "지역 식별 실패", "vt": v["t"][:90], "at": v["at"]}
    cs = comments(v["id"])
    if len(cs) < 60:
        return {"vid": v["id"], "ok": False, "why": f"댓글 부족 ({len(cs)})", "vt": v["t"][:90], "at": v["at"]}

    cnt = collections.Counter()
    for c in cs:
        for m in set(NAME.findall(c)):                 # 한 댓글에서 같은 이름은 한 번만
            if not GENERIC.search(m):
                cnt[m] += 1
    top = cnt.most_common(3)
    base = {"vid": v["id"], "vt": v["t"][:90], "at": v["at"], "region": region,
            "cands": [[k, n] for k, n in top], "nComments": len(cs)}
    if not top or top[0][1] < MIN_HITS:
        return {**base, "ok": False, "why": f"언급 부족 ({top[0][1] if top else 0}회)"}
    if len(top) > 1 and top[0][1] < top[1][1] * MIN_LEAD:
        return {**base, "ok": False, "why": f"1·2위 접전 ({top[0][0]} {top[0][1]} vs {top[1][0]} {top[1][1]})"}

    name = top[0][0]
    for d in ksearch(f"{region} {name}"):
        addr = (d.get("road_address_name") or "") + " " + (d.get("address_name") or "")
        if d.get("category_group_code") not in FOOD:
            continue
        if not name_ok(name, d["place_name"], region):
            continue
        if not region_ok(region, addr):
            continue
        return {**base, "ok": True, "name": name, "place": d["place_name"],
                "addr": d.get("road_address_name") or d.get("address_name", ""),
                "cat": (d.get("category_name", "").split(">")[-1].strip() or "음식점"),
                "lat": float(d["y"]), "lng": float(d["x"])}
    return {**base, "ok": False, "why": f"카카오 미확인 ({name})"}


def main():
    if not (YKEY and KKEY):
        sys.exit("YOUTUBE_API_KEY / KAKAO_REST_API_KEY 둘 다 필요합니다.")
    V = json.load(open(RAW / "c4_full.json", encoding="utf-8"))["videos"]
    eps = [v for v in V if re.search(r"EP\.?\s*\d", v["t"])
           and ("또간집" in v["t"] or "#또간집" in v["d"])
           and not re.search(r"간절한입|더쎈놈|오사카|도쿄|일본|대만|태국|베트남", v["t"] + v["d"])]
    prev = {}
    pf = RAW / "ddogan.json"
    if pf.exists():
        prev = {r["vid"]: r for r in json.load(open(pf, encoding="utf-8")) if r.get("ok")}
        eps = [v for v in eps if v["id"] not in prev]
        print(f"이미 확정된 {len(prev)}곳은 건너뜁니다.")
    print(f"또간집 본편 {len(eps)}편에서 상호를 뽑습니다 (쿼터 약 {len(eps)*4})\n")

    out, t0 = [], time.time()
    with ThreadPoolExecutor(max_workers=3) as ex:
        for i, r in enumerate(ex.map(handle, eps), 1):
            out.append(r)
            if i % 20 == 0:
                print(f"  {i}/{len(eps)} · 채택 {sum(1 for x in out if x['ok'])} · {time.time()-t0:.0f}초", flush=True)
    out = list(prev.values()) + out
    json.dump(out, open(RAW / "ddogan.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    ok = [r for r in out if r["ok"]]
    print(f"\n본편 {len(out)}편 → 식당 {len(ok)}곳 ({100*len(ok)/len(out):.0f}%) · {time.time()-t0:.0f}초")
    print("\n채택된 것:")
    for r in ok[:16]:
        print(f"  {r['region']:<5}{r['name'][:12]:<14}({r['cands'][0][1]:>2}회) → {r['place'][:20]:<22}{r['addr'][:26]}")
    print("\n버린 이유:")
    for why, n in collections.Counter(r["why"].split(" (")[0] for r in out if not r["ok"]).most_common():
        print(f"  {why:<16}{n:>4}편")


if __name__ == "__main__":
    main()
