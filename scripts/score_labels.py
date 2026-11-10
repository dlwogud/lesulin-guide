"""사람 라벨 vs 분류기 — 정확도 측정.

  python3 scripts/score_labels.py

팀원이 채운 labeling/라벨링_*.csv 를 모두 읽어 labeling/_answer_key.json 의
분류기 예측과 맞춰 봅니다. 아직 안 채운 파일은 건너뜁니다.

세 가지를 따로 잽니다.
  1. 방문 판정   "다녀왔다"를 맞게 가렸는가 (정밀도·재현율·F1)
  2. 항목 탐지   맛·양·가격·서비스·대기·분위기를 찾아냈는가
  3. 감성 일치   찾은 항목의 긍정·부정까지 맞았는가

사람이 '애매함(?)'으로 둔 항목은 채점에서 제외합니다. 정답이 없는 걸로 재면
점수가 왜곡됩니다.
"""
import collections, csv, json, pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent
LAB = ROOT / "labeling"
ASPECTS = ["맛", "양", "가격", "서비스", "대기", "분위기"]
POS, NEG = {"긍정", "+", "1", "o", "O"}, {"부정", "-", "-1", "x", "X"}


def f1(tp, pred_n, gold_n):
    if not pred_n or not gold_n:
        return 0.0, 0.0, 0.0
    p, r = tp / pred_n, tp / gold_n
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def load_human():
    """채워진 시트를 모읍니다. 중복 번호는 먼저 읽은 것을 씁니다."""
    out, files = {}, []
    for f in sorted(LAB.glob("라벨링_*.csv")):
        if f.name == "라벨링_전체.csv":
            continue
        filled = 0
        for row in csv.DictReader(open(f, encoding="utf-8-sig")):
            rid = (row.get("번호") or "").strip()
            vis = (row.get("방문함(O/X)") or "").strip().upper()
            if not rid or not vis:
                continue
            asp, vague = {}, set()
            for a in ASPECTS:
                v = (row.get(a) or "").strip()
                if v in POS: asp[a] = 1
                elif v in NEG: asp[a] = -1
                elif v:        vague.add(a)       # 뭔가 적었는데 해석 불가 → 보류 처리
            if (row.get("애매함(?)") or "").strip():
                vague |= set(ASPECTS)             # 줄 전체를 보류로 둔 경우
            if rid not in out:
                out[rid] = {"visit": vis.startswith("O"), "asp": asp, "vague": vague}
                filled += 1
        if filled:
            files.append((f.name, filled))
    return out, files


def main():
    raw = json.load(open(LAB / "_answer_key.json", encoding="utf-8"))
    # 저장된 예측을 쓰지 않고 지금 분류기로 다시 돌립니다.
    # 그래야 사전을 고칠 때마다 점수가 바로 움직입니다.
    sys.path.insert(0, str(ROOT / "scripts"))
    import visit_lexicon as VL
    key = {}
    for r in raw:
        v = VL.visited(r["text"])
        key[r["id"]] = {**r, "pred_visit": v, "pred": VL.analyze(r["text"]) if v else {}}
    human, files = load_human()
    if not human:
        sys.exit("채워진 라벨이 없습니다. labeling/라벨링_○○○.csv 를 먼저 채워 주세요.")

    print("읽은 시트")
    for n, c in files:
        print(f"  {n:<24}{c:>4}건")
    print(f"\n정답셋 {len(key)}건 중 라벨 완료 {len(human)}건 ({100*len(human)/len(key):.0f}%)\n")

    # 1. 방문 판정
    tp = sum(1 for i, h in human.items() if h["visit"] and key[i]["pred_visit"])
    pn = sum(1 for i, h in human.items() if key[i]["pred_visit"])
    gn = sum(1 for i, h in human.items() if h["visit"])
    p, r, f = f1(tp, pn, gn)
    print("[1] 방문 판정 — \"다녀왔다\"를 맞게 가렸는가")
    print(f"    정밀도 {p:.3f} · 재현율 {r:.3f} · F1 {f:.3f}   (사람 {gn}건 / 분류기 {pn}건 / 일치 {tp}건)")
    fp = [i for i, h in human.items() if key[i]["pred_visit"] and not h["visit"]]
    fn = [i for i, h in human.items() if h["visit"] and not key[i]["pred_visit"]]
    print(f"    잘못 잡음 {len(fp)}건 · 놓침 {len(fn)}건")

    # 2·3. 항목 탐지와 감성 — 사람이 방문이라고 한 것만 대상
    aT = aP = aG = sT = 0
    per = collections.defaultdict(lambda: [0, 0, 0, 0])   # tp, pred, gold, 감성일치
    for i, h in human.items():
        if not h["visit"]:
            continue
        pred = key[i]["pred"]
        for a in ASPECTS:
            if a in h["vague"]:
                continue                                   # 사람이 보류한 항목은 채점 제외
            inP, inG = a in pred, a in h["asp"]
            aP += inP; aG += inG
            per[a][1] += inP; per[a][2] += inG
            if inP and inG:
                aT += 1; per[a][0] += 1
                if pred[a] == h["asp"][a]:
                    sT += 1; per[a][3] += 1

    p2, r2, f2 = f1(aT, aP, aG)
    p3, r3, f3 = f1(sT, aP, aG)
    print("\n[2] 항목 탐지 — 맛·양·가격·서비스·대기·분위기를 찾아냈는가")
    print(f"    정밀도 {p2:.3f} · 재현율 {r2:.3f} · F1 {f2:.3f}   (사람 {aG}개 / 분류기 {aP}개 / 일치 {aT}개)")
    print("\n[3] 감성 일치 — 찾은 항목의 긍정·부정까지 맞았는가")
    print(f"    정밀도 {p3:.3f} · 재현율 {r3:.3f} · F1 {f3:.3f}   (감성까지 맞은 것 {sT}개)")

    print(f"\n[항목별]\n    {'항목':<6}{'사람':>5}{'분류기':>6}{'일치':>5}{'감성':>5}{'탐지F1':>9}{'감성F1':>9}")
    for a in ASPECTS:
        t, pn_, gn_, s = per[a]
        if not (pn_ or gn_):
            continue
        _, _, fa = f1(t, pn_, gn_)
        _, _, fs = f1(s, pn_, gn_)
        print(f"    {a:<6}{gn_:>5}{pn_:>6}{t:>5}{s:>5}{fa:>9.3f}{fs:>9.3f}")

    out = {"labeled": len(human), "total": len(key),
           "visit": {"precision": p, "recall": r, "f1": f},
           "aspect": {"precision": p2, "recall": r2, "f1": f2},
           "sentiment": {"precision": p3, "recall": r3, "f1": f3},
           "per_aspect": {a: {"gold": per[a][2], "pred": per[a][1],
                              "hit": per[a][0], "sent_hit": per[a][3]} for a in ASPECTS}}
    json.dump(out, open(ROOT / "data" / "label_score.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("\n저장: data/label_score.json")


if __name__ == "__main__":
    main()
