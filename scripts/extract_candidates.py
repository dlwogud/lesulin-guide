"""지도 링크가 없는 채널에서 '지역 + 상호' 후보를 뽑습니다.

  python3 scripts/extract_candidates.py

채널마다 상호가 적힌 자리가 다릅니다.
  성시경  제목이 "먹을텐데 l 남대문 양미옥" 꼴로 고정돼 있습니다
  쯔양    제목에 지역과 상호가 섞여 들어갑니다 (가격·메뉴 노이즈가 많습니다)
  히밥    제목에 거의 없습니다
  또간집  제목에도 설명란에도 없고, 댓글에만 있습니다 (별도 스크립트)

여기서는 후보만 만듭니다. 실재 확인은 scripts/kakao_geocode.py 가 카카오 로컬로 합니다.
카카오에서 못 찾으면 버립니다 — 추측해서 채우지 않습니다.
"""
import collections, json, pathlib, re

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"

SIDO = (r"서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|"
        r"수원|성남|용인|고양|의정부|여주|이천|강릉|속초|춘천|원주|전주|여수|순천|경주|포항|안동|"
        r"천안|청주|제천|익산|정읍|구리|기장|남양주|시흥|군포|안산|목포|군산|김해|창원|진주|통영|"
        r"거제|평택|파주|김포|광명|부천|안양|과천|하남|양평|가평|홍성|서산|당진|논산|공주|상주|"
        r"구미|영주|문경|영월|태백|동해|삼척|양양|고성|인제|화천|철원|보령|부여|옥천|단양|음성|"
        r"진천|괴산|영동|남원|정읍|김제|완주|나주|담양|곡성|구례|순창")
SEOUL_DONG = (r"남대문|동대문|경리단길|면목|논현|충무로|삼각지|수색|회현|청담|신당|역삼|금호|자양|"
              r"합정|둔촌|구의|남영|보광|을지로|연남|성수|방화|약수|노량진|서촌|북촌|이태원|상수|"
              r"망원|영등포|목동|잠실|성북|혜화|종로|명동|신촌|홍대|가락|송파|강남|서초|용산|마포|"
              r"공덕|왕십리|건대|신림|사당|강서|목동|상암|후암|필동|장충|익선동|서교|연희|문래")

# 해외편은 국내 지도에 올릴 수 없습니다
ABROAD = re.compile(r"도쿄|오사카|교토|삿포로|나고야|후쿠오카|오키나와|일본|대만|타이베이|홍콩|"
                    r"상하이|베이징|방콕|태국|베트남|하노이|다낭|싱가포르|독일|프랑스|파리|뉴욕|"
                    r"미국|스페인|이탈리아|영국|런던|호주|터키|몽골")

# 가격·수량·일반명사는 상호가 아닙니다
NOISE = re.compile(r"^\d|원$|인분$|^[가-힣]?\d+|^(맛집|찐맛집|우리|저희|그|이|자기|여기|거기)")

# 업태를 가리키는 말. 이것만 남으면 상호가 아니라 분류입니다.
CATEGORY = {
  "분식", "중국", "중식", "한식", "양식", "일식", "국밥", "돼지국밥", "순대국밥", "칼국수", "냉면",
  "족발", "보쌈", "곱창", "막창", "갈비", "삼겹살", "치킨", "피자", "라면", "국수", "짬뽕", "짜장",
  "해장국", "백반", "돈까스", "돈가스", "닭강정", "초밥", "회전초밥", "샤브샤브", "딤섬", "스시",
  "라멘", "우동", "카츠", "버거", "파스타", "베이커리", "제과", "카페", "횟집", "고깃집", "포차",
  "술집", "밥집", "맛집", "찐맛집", "숨은맛집", "단골", "무한리필", "뷔페", "배달", "즉석", "전통",
  "유명", "현지", "노포", "시장", "본점", "직영", "가맥", "장인", "생고기", "숯불", "한우", "흑돼지",
}
TAIL_WORDS = re.compile(r"(집|식당|전문점|맛집)$")


def is_generic(name, region):
    """상호인지 업태인지 가립니다. 업태만 남으면 버립니다."""
    core = TAIL_WORDS.sub("", name)
    for c in sorted(CATEGORY, key=len, reverse=True):
        if core.endswith(c) and len(core) > len(c):
            core = core[: -len(c)]
            break
    if len(core) < 2 or core in CATEGORY:
        return True
    # 상호의 앞부분이 지역 힌트와 같으면 "그 동네 OO집"이라는 뜻입니다
    return any(core == part for part in region.split())
STORE_TAIL = (r"집|식당|국밥|족발|막국수|칼국수|냉면|분식|반점|옥|관|각|원|정|상회|식육|고깃집|"
              r"횟집|포차|갈비|곱창|백반|보리밥|순대|떡볶이|해장국|설렁탕|곰탕|쌈밥|한우|숯불|"
              r"스시|초밥|라멘|우동|카츠|돈까스|버거|피자|파스타|베이커리|제과|카페")


def region_hint(text):
    m = re.search(SEOUL_DONG, text)
    if m: return "서울 " + m.group(0)
    m = re.search(SIDO, text)
    return m.group(0) if m else None


def from_sungsikyung(videos):
    """제목 형식이 고정돼 있어 'l' 뒤를 그대로 씁니다."""
    out = []
    for v in videos:
        if "먹을텐데" not in v["t"]: continue
        tail = re.split(r"\s*[l|｜/]\s*", v["t"].replace("[sub]", "").replace("[SUB]", ""))[-1]
        tail = re.sub(r"\(.*?\)|with\..*|＜.*?＞|\[.*?\]", "", tail).strip()
        if not tail or "먹을텐데" in tail or ABROAD.search(tail): continue
        for part in re.split(r"\s*[,&＋+]\s*", tail):
            part = part.strip()
            if len(part) < 2: continue
            reg = region_hint(part) or "서울"
            name = re.sub(r"^(" + SEOUL_DONG + r"|" + SIDO + r")\s*(역|시장|동)?\s*", "", part).strip()
            if len(name) < 2 or NOISE.match(name) or is_generic(name, reg): continue
            out.append({"q": reg + " " + name, "name": name, "region": reg, "v": v})
    return out


def from_title_mixed(videos):
    """제목에 지역과 상호가 섞인 채널(쯔양·히밥)."""
    pat = re.compile(r"([가-힣A-Za-z]{2,10}(?:" + STORE_TAIL + r"))")
    out = []
    for v in videos:
        if ABROAD.search(v["t"]): continue
        reg = region_hint(v["t"])
        if not reg: continue
        for m in dict.fromkeys(pat.findall(v["t"])):
            if NOISE.match(m) or len(m) < 3 or is_generic(m, reg): continue
            out.append({"q": reg + " " + m, "name": m, "region": reg, "v": v})
    return out


def main():
    jobs = [("c1", "성시경의 먹을텐데", from_sungsikyung),
            ("c2", "쯔양",             from_title_mixed),
            ("c3", "히밥",             from_title_mixed)]
    allc = []
    for cid, name, fn in jobs:
        vids = json.load(open(RAW / f"{cid}_full.json", encoding="utf-8"))["videos"]
        cands = fn(vids)
        seen, uniq = set(), []
        for c in cands:
            if c["q"] in seen: continue
            seen.add(c["q"])
            uniq.append({"cid": cid, "q": c["q"], "name": c["name"], "region": c["region"],
                         "vid": c["v"]["id"], "vt": c["v"]["t"][:90], "at": c["v"]["at"]})
        allc += uniq
        print(f"{name:<14} 영상 {len(vids):>5}편 → 후보 {len(uniq):>4}개")
        for c in uniq[:5]:
            print(f"    {c['q']}")
    json.dump(allc, open(RAW / "candidates.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n후보 {len(allc)}개 저장 → data/raw/youtube/candidates.json")
    print("다음: python3 scripts/kakao_geocode.py  (카카오 로컬로 실재 확인)")


if __name__ == "__main__":
    main()
