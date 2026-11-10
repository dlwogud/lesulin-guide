"""르몽 실데이터에서 시드 매장을 뽑습니다.

매장명·주소·리뷰수는 실제 데이터입니다.
유튜버 연결과 좌표는 개발용(seed)이며 화면에 그렇게 표시됩니다.
카카오 REST 키가 있으면 scripts/geocode.py로 실제 좌표를 채우세요.
"""
import duckdb, json, pathlib, re

SRC = "/Users/ijaehyeong/Downloads/순천향대_제공_리뷰_데이터/*.csv"
OUT = pathlib.Path(__file__).parent.parent / "data" / "seed.json"

# 시군구 대략 중심 좌표 (개발용 — 실제 좌표는 지오코딩으로 교체)
CENTER = {
  "서울특별시 강남구": (37.4979, 127.0276), "서울특별시 중구": (37.5636, 126.9976),
  "서울특별시 마포구": (37.5663, 126.9019), "서울특별시 종로구": (37.5729, 126.9794),
  "서울특별시 강북구": (37.6396, 127.0257), "서울특별시 구로구": (37.4954, 126.8874),
  "서울특별시 동대문구": (37.5744, 127.0396), "서울특별시 송파구": (37.5145, 127.1060),
  "부산광역시 해운대구": (35.1631, 129.1635), "부산광역시 사상구": (35.1525, 128.9915),
  "부산광역시 중구": (35.1061, 129.0324), "대구광역시 중구": (35.8694, 128.6014),
  "대구광역시 북구": (35.8858, 128.5828), "인천광역시 서구": (37.5455, 126.6760),
  "광주광역시 광산구": (35.1395, 126.7939), "대전광역시 유성구": (36.3622, 127.3561),
  "경기도 하남시": (37.5393, 127.2149), "경기도 수원시": (37.2636, 127.0286),
  "강원특별자치도 원주시": (37.3422, 127.9202), "전북특별자치도 군산시": (35.9676, 126.7370),
  "제주특별자치도 제주시": (33.4996, 126.5312),
}

con = duckdb.connect(); con.execute("SET preserve_insertion_order=false")
con.execute(f"""CREATE TABLE a AS SELECT platform, shop_address addr, platform_shop_name nm,
  business_number bn, content, created_at FROM read_csv('{SRC}', union_by_name=true,
  ignore_errors=true, strict_mode=false, all_varchar=true, header=true)""")

rows = con.sql("""
SELECT bn, any_value(nm) nm, any_value(addr) addr,
       count(*) rv, count(*) FILTER (WHERE platform='NAVER') nav,
       count(*) FILTER (WHERE content IS NOT NULL AND length(trim(content))>=1) txt,
       regexp_extract(any_value(addr), '^(\\S+\\s+\\S+)', 1) region
FROM a GROUP BY bn
HAVING count(*) FILTER (WHERE platform='NAVER') >= 50 AND count(*) >= 300
""").df()
rows = rows[rows.region.isin(CENTER)]
rows = rows.sort_values("nav", ascending=False).groupby("region").head(3).head(30)

CREATORS = [
  {"creatorId":"c1","creatorName":"먹탐정","channelId":None,"channelUrl":None,
   "profileImageUrl":None,"subscriberCount":None,"isFeatured":True,"sourceType":"seed"},
  {"creatorId":"c2","creatorName":"로컬식탁","channelId":None,"channelUrl":None,
   "profileImageUrl":None,"subscriberCount":None,"isFeatured":True,"sourceType":"seed"},
  {"creatorId":"c3","creatorName":"한그릇기행","channelId":None,"channelUrl":None,
   "profileImageUrl":None,"subscriberCount":None,"isFeatured":True,"sourceType":"seed"},
]

stores = []
for i, r in enumerate(rows.itertuples()):
    lat, lng = CENTER[r.region]
    stores.append({
      "storeId": f"s{i+1}",
      "storeName": re.sub(r"\s+", " ", str(r.nm)).strip(),
      "address": str(r.addr).strip(),
      "roadAddress": None,
      "lat": round(lat + (i % 7 - 3) * 0.004, 6),   # 개발용 분산
      "lng": round(lng + (i % 5 - 2) * 0.005, 6),
      "coordSource": "seed-approx",                  # 실좌표 아님을 명시
      "category": None,
      "region": r.region,
      "phone": None,
      "placeProvider": None, "placeProviderId": None,
      "reviewTotal": int(r.rv), "reviewNaver": int(r.nav), "reviewText": int(r.txt),
      "creatorIds": [CREATORS[i % 3]["creatorId"]],
      "videos": [],
      "guideLevel": None,            # 분석 전에는 배지 없음
      "status": "NEW",
      "sourceType": "seed",
      "storeNameSource": "real",     # 매장명·주소·리뷰수는 르몽 실데이터
    })

OUT.write_text(json.dumps({"creators": CREATORS, "stores": stores},
                          ensure_ascii=False, indent=1))
print(f"시드 생성: 매장 {len(stores)}곳 · 지역 {rows.region.nunique()}개 → {OUT.name}")
for s in stores[:6]:
    print(f"  {s['region']:<16} {s['storeName'][:22]:<24} 리뷰 {s['reviewTotal']:>5} (네이버 {s['reviewNaver']})")
