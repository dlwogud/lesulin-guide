"""방문 판정 정확도의 층화 보정 테스트 (src/lib/accuracy.ts 와 같은 식).

    .venv/bin/python scripts/test_score_labels.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from score_labels import stratified_visit  # noqa: E402


def near(a, b, msg):
    assert a is not None and abs(a - b) < 1e-3, f"{msg}: {a} != {b}"


def test_only_visit_side_has_no_recall():
    r = stratified_visit(tp_v=8, fp_v=2, fn_n=0, tn_n=0, pop_visit=12445, pop_non=261322)
    near(r["precision"], 0.8, "정밀도")
    assert r["recall"] is None, r


def test_recall_is_weighted_by_population():
    r = stratified_visit(tp_v=40, fp_v=10, fn_n=1, tn_n=49, pop_visit=12445, pop_non=261322)
    tp, fn = 12445 * 0.8, 261322 * 0.02
    near(r["recall"], tp / (tp + fn), "보정 재현율")
    assert r["recall"] < 0.7, f"보정 안 됨: {r['recall']} (합쳐 세면 40/41=0.976)"
    near(r["f1"], 2 * 0.8 * r["recall"] / (0.8 + r["recall"]), "F1")


def test_empty():
    r = stratified_visit(0, 0, 0, 0, 100, 1000)
    assert r["precision"] is None and r["recall"] is None and r["f1"] is None


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    bad = 0
    for t in tests:
        try:
            t(); print(f"  ✓ {t.__name__}")
        except AssertionError as e:
            bad += 1; print(f"  ✗ {t.__name__} — {e}")
    print(f"\n{len(tests) - bad}/{len(tests)} 통과")
    sys.exit(1 if bad else 0)
