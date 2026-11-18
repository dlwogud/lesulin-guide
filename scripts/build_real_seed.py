"""식당 + 영상 + 댓글 → 프로토타입이 읽는 seed_real.json.

  python3 scripts/build_real_seed.py

르몽 리뷰로 만든 사전을 방문형으로 옮긴 scripts/visit_lexicon.py 를 유튜브 댓글에 적용합니다.
식당과 르몽 데이터를 직접 잇지 않습니다 — 617곳을 맞춰 보니 2곳(0.3%)만 겹쳤고,
르몽은 98.5%가 배달 리뷰라 유튜버가 가는 노포와는 모집단이 다릅니다.

대표 지표를 "긍정률"이 아니라 "방문 반응 수"로 둡니다.
유튜브 댓글의 맛 긍정률은 95%로 천장에 붙어 있어 가게를 가릴 수 없습니다.
캡스톤에서 별점이 변별력을 못 낸 것과 같은 현상입니다. 실제로 갈린 것은
"영상을 보고 몇 명이 다녀왔다고 말했는가"입니다.

근거가 모자라면 점수를 내지 않습니다. 비워 두는 쪽이 지어내는 쪽보다 낫습니다.
"""
import json, math, pathlib, re, sys, collections

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import visit_lexicon as VL
from quotes import pick_quotes, MULTI_PLACE_CREATORS

# 조회수·재생시간은 scripts/collect_stats.py 가 받아 둡니다.
# 예전엔 이 단계를 손으로 돌려서, 시드를 다시 만들 때 조회수가 전부 사라졌습니다.
_vs = ROOT / "data" / "raw" / "youtube" / "video_stats.json"
VSTAT = json.load(open(_vs, encoding="utf-8")) if _vs.exists() else {}

MIN_COMMENTS = 40     # 영상 댓글이 이보다 적으면 항목 점수를 내지 않습니다
MIN_VISIT    = 5      # 방문 경험 명시 댓글 최소치
MIN_ASPECT   = 3      # 한 항목이 이만큼 언급돼야 그 항목을 표시합니다
DUP_M        = 70     # 이 거리(m) 안에 이름이 닮은 곳은 같은 가게로 봅니다

CREATORS = {
    "c1":  {"n": "성시경의 먹을텐데", "h": "먹을텐데",    "col": "#C0453E", "yt": "UCl23-Cci_SMqyGXE1T_LYUg", "subs": 2350000},
    "c2":  {"n": "쯔양",             "h": "쯔양",       "col": "#2E6FA8", "yt": "UCfpaSruWW3S4dibonKXENjA", "subs": 13500000},
    "c3":  {"n": "히밥",             "h": "히밥",       "col": "#CC8211", "yt": "UCA6KBBX8cLwYZNepxlE_7SA", "subs": 1730000},
    "c4":  {"n": "또간집",           "h": "또간집",      "col": "#7A569E", "yt": "UC4ZA57iJrf73bJlApKFeLRw", "subs": 1260000},
    "c5":  {"n": "정육왕",           "h": "정육왕",      "col": "#16857A", "yt": "UC1oXmhvYHVI2bApphh3IzuQ", "subs": 828000},
    "c6":  {"n": "김사원세끼",         "h": "김사원세끼",   "col": "#6F9B22", "yt": "UC-x55HF1-IilhxZOzwJm7JA", "subs": 434000},
    "c8":  {"n": "회사랑",           "h": "회사랑",      "col": "#1E8A5F", "yt": "UCoLPofyAZuuq6v4EWrWRguw", "subs": 278000},
    "c11": {"n": "상해기",           "h": "상해기",      "col": "#9B3B9B", "yt": "UCPVENfTGbgD-CUuvrN7rRGQ", "subs": 1570000},
    "c12": {"n": "재슐랭가이드",       "h": "재슐랭",      "col": "#B8365E", "yt": "UCzgpOnor-MzT-1iflZil2GQ", "subs": 336000},
    "c13": {"n": "묵짜",             "h": "묵짜",       "col": "#5C6B8A", "yt": "UCyPOG_WzW6IK1ZiXGDBH1TA", "subs": 189000},
}
OWNERS = {c["yt"] for c in CREATORS.values()}

SPLIT_GU = re.compile(r"(시)([가-힣]{1,4}구)$")     # 2013년 경계는 "성남시분당구"처럼 붙어 있습니다
norm = lambda s: re.sub(r"[\s\-·,()\[\]'\"]+", "", str(s))


def tidy_region(r):
    a, *b = r.split(" ")
    return a + " " + SPLIT_GU.sub(r"\1 \2", "".join(b)) if b else r


def dedupe(stores):
    """같은 가게가 구글 링크와 네이버 링크로 두 번 들어옵니다. 거리와 이름으로 묶습니다."""
    stores = sorted(stores, key=lambda s: (-len(s["addr"]), -len(s["vids"])))
    kept = []
    for s in stores:
        hit = None
        for k in kept:
            d = math.hypot((s["lat"] - k["lat"]) * 111_000, (s["lng"] - k["lng"]) * 89_000)
            if d > DUP_M:
                continue
            a, b = norm(s["n"]), norm(k["n"])
            if a == b or a.startswith(b) or b.startswith(a):
                hit = k; break
        if not hit:
            kept.append(s); continue
        for v in s["vids"]:
            if not any(x["id"] == v["id"] for x in hit["vids"]):
                hit["vids"].append(v)
        hit["cs"] = sorted(set(hit["cs"]) | set(s["cs"]))
        hit["addr"] = hit["addr"] or s["addr"]
        hit["cat"] = hit["cat"] or s["cat"]
    return kept


def main():
    stores = dedupe(json.load(open(ROOT / "data" / "stores_real.json", encoding="utf-8")))
    cpath = ROOT / "data" / "raw" / "youtube" / "comments2.json"
    if not cpath.exists():
        cpath = ROOT / "data" / "raw" / "youtube" / "comments.json"
    C = json.load(open(cpath, encoding="utf-8"))
    print(f"댓글 파일: {cpath.name}")

    # 영상마다 연결된 식당 — 2곳 이상이거나 또간집이면 "여러 가게가 나오는 영상"
    on_video = collections.defaultdict(set)
    for s in stores:
        for v in s["vids"]:
            on_video[v["id"]].add(s["n"])
    multi = lambda v: len(on_video[v["id"]]) > 1 or v.get("c") in MULTI_PLACE_CREATORS

    out, tally = [], collections.Counter()
    for i, s in enumerate(stores, 1):
        s["id"] = "s%d" % i
        s["r"] = tidy_region(s["r"])
        texts = []
        for v in s["vids"]:
            rec = C.get(v["id"])
            if rec:
                texts += [{**c, "_multi": multi(v)} for c in rec["comments"]]

        total = len(texts)
        # 운영자 고정 댓글은 가게 소개·협찬 고지라서 방문자 반응이 아닙니다
        body = [c for c in texts if c.get("au") not in OWNERS and not VL.promo(c["t"])]
        tally["운영자·홍보 제외"] += total - len(body)
        visit = [c for c in body if VL.visited(c["t"])]
        pairs = [(c, VL.analyze(c["t"])) for c in visit]
        pairs = [(c, a) for c, a in pairs if a]

        rec = {"id": s["id"], "n": s["n"], "r": s["r"], "addr": s["addr"], "cat": s["cat"],
               "lat": round(s["lat"], 6), "lng": round(s["lng"], 6), "cs": s["cs"],
               "vids": [{**{k: v[k] for k in ("id", "t", "at", "c")},
                          "vw": VSTAT.get(v["id"], {}).get("views"),
                          "dur": VSTAT.get(v["id"], {}).get("dur")} for v in s["vids"]],
               "cTotal": total, "cVisit": len(visit), "cUsed": len(pairs)}

        if total < MIN_COMMENTS or len(visit) < MIN_VISIT:
            rec["status"] = "INSUFFICIENT_DATA"; tally["근거 부족"] += 1
            out.append(rec); continue

        agg = collections.defaultdict(lambda: [0, 0])
        for _, a in pairs:
            for k, v in a.items():
                agg[k][0 if v > 0 else 1] += 1
        aspects = [{"a": k, "p": round(100 * agg[k][0] / sum(agg[k])), "n": sum(agg[k])}
                   for k in VL.ASPECTS if sum(agg[k]) >= MIN_ASPECT]
        if not aspects:
            rec["status"] = "INSUFFICIENT_DATA"; tally["항목 미검출"] += 1
            out.append(rec); continue

        # 대기 부정은 "줄이 길었다"는 뜻이라 가게의 결함이 아니라 인기의 증거입니다.
        # 쓴소리를 셀 때는 빼고, 따로 보여 줍니다.
        waitN = sum(1 for _, a in pairs if a.get("대기", 0) < 0)
        gripeN = sum(1 for _, a in pairs if any(v < 0 for k, v in a.items() if k != "대기"))
        rec["aspects"] = aspects
        # 대표 댓글 규칙은 scripts/quotes.py 한 곳에 둡니다 (rebuild_quotes.py 와 공유)
        sib = sorted(set().union(*(on_video[v["id"]] for v in s["vids"])) - {s["n"]})
        rec["quotes"] = pick_quotes([{"t": c["t"], "like": c["like"], "at": c["at"], "asp": a,
                                      "multi": c["_multi"]} for c, a in pairs],
                                    name=s["n"], siblings=sib)
        rec["negN"] = gripeN
        rec["waitN"] = waitN
        rec["status"] = "RATED"; tally["점수 산출"] += 1
        out.append(rec)

    # 르슐랭 배지 — 보조 표시라 극소수에만 붙입니다.
    # 긍정률은 천장에 붙어 변별이 안 되므로, 실제로 다녀왔다는 반응의 양으로 가립니다.
    rated = sorted([r for r in out if r["status"] == "RATED"],
                   key=lambda r: (-r["cUsed"], -r["cVisit"]))
    for i, r in enumerate(rated):
        clean = r["negN"] / max(r["cUsed"], 1) <= .25     # 대기는 빠져 있습니다
        if   i < 3  and r["cUsed"] >= 15 and clean: r["lvl"] = 3
        elif i < 10 and r["cUsed"] >= 10 and clean: r["lvl"] = 2
        elif i < 25 and r["cUsed"] >= 7  and clean: r["lvl"] = 1

    # 구독자 많은 순으로 둡니다 — 화면에서 "좋아하는 유튜버 고르기"에 그 순서로 나옵니다.
    # 문자열 정렬이면 c1, c11, c12, c13, c2… 로 꼬입니다.
    used_c = sorted({c for r in out for c in r["cs"]},
                    key=lambda c: -CREATORS[c].get("subs", 0))
    seed = {"creators": [{k: v for k, v in CREATORS[c].items() if k != "yt"} | {"id": c} for c in used_c],
            "stores": out,
            "meta": {"stores": len(out), "videos": sum(len(r["vids"]) for r in out),
                     "comments": sum(r["cTotal"] for r in out),
                     "visit": sum(r["cVisit"] for r in out),
                     "used": sum(r["cUsed"] for r in out),
                     "rated": len(rated), "badged": sum(1 for r in out if r.get("lvl"))}}
    json.dump(seed, open(ROOT / "data" / "seed_real.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    m = seed["meta"]
    print(f"\n식당 {m['stores']}곳 · 영상 {m['videos']}편 · 댓글 {m['comments']:,}개")
    print(f"방문 경험 명시 {m['visit']:,}개 ({100*m['visit']/m['comments']:.1f}%) · "
          f"항목 집계 {m['used']:,}개")
    print(f"점수 산출 {m['rated']}곳 · 배지 {m['badged']}곳")
    for k, v in tally.most_common():
        print(f"  {k:<16}{v:>6}")

    agg = collections.Counter()
    for r in rated:
        for a in r["aspects"]:
            agg[a["a"]] += a["n"]; agg[a["a"] + "+"] += round(a["n"] * a["p"] / 100)
    print("\n항목별 긍정률 (천장 효과 확인용):")
    for k in VL.ASPECTS:
        if agg[k]:
            print(f"  {k:<5}{agg[k]+'+' if False else agg[k+'+']:>5}/{agg[k]:<5} {100*agg[k+'+']/agg[k]:>5.1f}%")

    print("\n방문 반응이 많은 곳:")
    for r in rated[:10]:
        asp = " ".join(f"{a['a']}{a['p']}%({a['n']})" for a in r["aspects"])
        print(f"  {'◆'*r.get('lvl',0):<4}{r['n'][:19]:<21}{r['r'][:13]:<15}"
              f"반응{r['cUsed']:>3} 부정{r['negN']:>2}  {asp}")


if __name__ == "__main__":
    main()
