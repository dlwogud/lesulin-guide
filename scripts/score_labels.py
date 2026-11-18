"""사람 라벨 vs 분류기 — 정확도 측정.

  python3 scripts/score_labels.py                       1차(labeling/)
  python3 scripts/score_labels.py labeling/round2       2차 — 방문/비방문 50건씩 층화 표본

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


def stratified_visit(tp_v, fp_v, fn_n, tn_n, pop_visit, pop_non):
    """방문/비방문 쪽을 따로 뽑은 표본으로 방문 판정 정확도를 냅니다.

    src/lib/accuracy.ts 의 stratified() 와 같은 식입니다.
    그냥 합쳐 세면 비방문 쪽(전체의 95% 이상)에서 놓친 비율이 작게 잡혀 재현율이 부풀려집니다.
      정밀도 = 방문 쪽 표본에서 사람도 방문이라고 본 비율
      재현율 = 추정 TP / (추정 TP + 추정 FN), 각 쪽 비율 × 그 쪽 전체 수
    """
    n_v, n_n = tp_v + fp_v, fn_n + tn_n
    p = tp_v / n_v if n_v else None
    r = None
    if n_v and n_n:
        tp, fn = pop_visit * tp_v / n_v, pop_non * fn_n / n_n
        r = tp / (tp + fn) if tp + fn else None
    f = 2 * p * r / (p + r) if p is not None and r is not None and p + r else None
    return {"precision": p, "recall": r, "f1": f}


def load_human(lab):
    """채워진 시트를 모읍니다. 중복 번호는 먼저 읽은 것을 씁니다."""
    out, files = {}, []
    for f in sorted(lab.glob("라벨링_*.csv")):
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
    lab = ROOT / sys.argv[1] if len(sys.argv) > 1 else LAB
    raw = json.load(open(lab / "_answer_key.json", encoding="utf-8"))
    meta_path = lab / "_meta.json"
    meta = json.load(open(meta_path, encoding="utf-8")) if meta_path.exists() else None
    # 저장된 예측을 쓰지 않고 지금 분류기로 다시 돌립니다.
    # 그래야 사전을 고칠 때마다 점수가 바로 움직입니다.
    sys.path.insert(0, str(ROOT / "scripts"))
    import visit_lexicon as VL
    key = {}
    for r in raw:
        v = VL.visited(r["text"])
        key[r["id"]] = {**r, "pred_visit": v, "pred": VL.analyze(r["text"]) if v else {}}
    raw_by_id = {r["id"]: r for r in raw}
    human, files = load_human(lab)
    if not human:
        sys.exit(f"채워진 라벨이 없습니다. {lab.relative_to(ROOT)}/라벨링_○○○.csv 를 먼저 채워 주세요.")

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

    # 층화 표본(2차부터)이면 전체 크기로 보정한 값이 발표에 쓸 숫자입니다
    strat = None
    if meta:
        changed = [i for i in human if key[i]["pred_visit"] != raw_by_id[i]["stratum"]]
        if changed:
            print(f"    ⚠ 뽑을 때와 지금 분류기 판정이 다른 댓글 {len(changed)}건 — 분류기를 바꿨다면 새로 뽑으세요")
        sv = lambda pv, g: sum(1 for i, h in human.items() if raw_by_id[i]["stratum"] == pv and h["visit"] == g)
        nv = sum(1 for i in human if raw_by_id[i]["stratum"]); nn = len(human) - nv
        strat = stratified_visit(sv(True, True), sv(True, False), sv(False, True), sv(False, False),
                                 meta["pop_visit"], meta["pop_non"])
        fmt = lambda x: "—" if x is None else f"{x:.3f}"
        print(f"    ▶ 층화 보정 (방문 쪽 {nv}건 · 비방문 쪽 {nn}건, 전체 {meta['pop_visit']:,} / {meta['pop_non']:,})")
        print(f"      정밀도 {fmt(strat['precision'])} · 재현율 {fmt(strat['recall'])} · F1 {fmt(strat['f1'])}")

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

    out = {"labeled": len(human), "total": len(key), "visit_stratified": strat,
           "visit": {"precision": p, "recall": r, "f1": f},
           "aspect": {"precision": p2, "recall": r2, "f1": f2},
           "sentiment": {"precision": p3, "recall": r3, "f1": f3},
           "per_aspect": {a: {"gold": per[a][2], "pred": per[a][1],
                              "hit": per[a][0], "sent_hit": per[a][3]} for a in ASPECTS}}
    dest = ROOT / "data" / ("label_score.json" if lab == LAB else f"label_score_{lab.name}.json")
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n저장: {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
