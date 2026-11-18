"""대표 댓글 고르기 규칙 테스트.

    .venv/bin/python scripts/test_quotes.py

실제로 잘못 뽑혔던 사례(나진국밥·왕거미식당·일등식당)를 그대로 옮겨 왔습니다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from quotes import pick_quotes  # noqa: E402


def c(t, like, asp, at="2024-01-01"):
    return {"t": t, "like": like, "at": at, "asp": asp}


def test_wait_only_is_not_a_gripe():
    # 나진국밥: 줄 선 이야기만 있는 칭찬이 좋아요가 많아 "아쉬운 점"으로 뽑혔습니다
    q = pick_quotes([c("가족여행 첫 식사였는데 가장 기억에 남네요. 평일 1시 반에 가서 좀 기다렸어요", 200, {"대기": -1})])
    assert q["neg"] is None, q["neg"]


def test_greeting_self_intro_is_excluded():
    # 왕거미식당 사장님 사과문, 일등식당 출연자 인사
    q = pick_quotes([
        c("안녕하세요 여원찜갈비 입니다. 손님들이 많이 오셔서 대처가 미흡했습니다", 500, {"서비스": -1}),
        c("안녕하세요! 에띵맘입니다.🐶 인터뷰 내내 행복했습니다 맛있게 드세요", 400, {"맛": 1}),
    ])
    assert q["pos"] is None and q["neg"] is None, q


def test_mostly_praise_is_not_a_gripe():
    q = pick_quotes([c("맛있고 양도 많고 친절한데 주차가 좀 불편", 90, {"맛": 1, "양": 1, "서비스": 1, "주차": -1})])
    assert q["neg"] is None, q["neg"]


def test_real_gripe_is_picked_even_with_some_praise():
    q = pick_quotes([c("맛은 괜찮은데 너무 비싸요", 30, {"맛": 1, "가격": -1})])
    assert q["neg"]["x"].startswith("맛은 괜찮은데"), q["neg"]


def test_praise_with_wait_mention_can_be_good():
    q = pick_quotes([c("웨이팅 길었지만 정말 맛있었어요", 50, {"맛": 1, "대기": -1})])
    assert q["pos"]["x"].startswith("웨이팅"), q["pos"]


def test_praise_with_real_gripe_is_not_good():
    q = pick_quotes([c("맛있는데 불친절해요", 70, {"맛": 1, "서비스": -1})])
    assert q["pos"] is None, q["pos"]


def test_most_liked_wins_and_format():
    q = pick_quotes([
        c("맛있어요", 5, {"맛": 1}),
        c("정말 맛있어요 또 갈게요", 80, {"맛": 1}, at="2023-05-06"),
        c("양이 너무 적고 비싸요", 3, {"양": -1, "가격": -1}),
        c("짜고 불친절", 40, {"맛": -1, "서비스": -1}, at="2022-02-02"),
    ])
    assert q["pos"] == {"x": "정말 맛있어요 또 갈게요", "at": "2023-05-06", "like": 80}, q["pos"]
    assert q["neg"] == {"x": "짜고 불친절", "at": "2022-02-02", "like": 40}, q["neg"]


def test_long_text_is_cut_at_170():
    q = pick_quotes([c("가" * 300, 1, {"맛": 1})])
    assert len(q["pos"]["x"]) == 170


def test_visitor_greeting_with_story_is_kept():
    # 평범한 방문자가 "안녕하세요"로 시작하는 경우는 남겨야 합니다
    q = pick_quotes([c("안녕하세요 어제 가족이랑 다녀왔는데 정말 맛있었어요", 10, {"맛": 1})])
    assert q["pos"] is not None


# ── 여러 가게가 나오는 영상 ──────────────────────────────────────
def m(t, like, asp):
    """여러 가게가 나오는 영상(또간집, 식당 여러 곳이 연결된 영상)의 댓글."""
    return {**c(t, like, asp), "multi": True}


def test_multi_video_comment_about_other_store_is_excluded():
    # 신사시장 떡볶이집에 "맛있는집"·"잠원떡볶이" 이야기가 붙었습니다
    q = pick_quotes([
        m("북가좌동 주민인데 맛있는집 떡볶이 진짜 맛있어요", 90, {"맛": 1}),
        m("떡볶이 투어 가봤는데 잠원떡볶이 별로였음", 80, {"맛": -1}),
    ], name="신사시장 떡볶이집", siblings=["맛있는집", "순이네고릴라떡볶이", "잠원떡볶이"])
    assert q["pos"] is None and q["neg"] is None, q


def test_multi_video_comment_naming_the_store_is_kept():
    q = pick_quotes([m("떡볶이 투어 가봤는데 잠원떡볶이 별로였음", 80, {"맛": -1})],
                    name="잠원떡볶이", siblings=["신사시장 떡볶이집", "맛있는집"])
    assert q["neg"] is not None


def test_ttogan_episode_comment_without_store_name_is_excluded():
    # 일등식당(또간집 망원편)에 "정각·뼈해장국집" 이야기가 붙었습니다
    q = pick_quotes([m("맛은 정각이 제일 맛있어보이는데 뼈해장국집이 미쳤다", 50, {"맛": 1})],
                    name="일등식당")
    assert q["pos"] is None, q["pos"]


def test_chain_branches_in_one_video_need_the_branch_name():
    sib = ["정통집 샤로수길점", "정통집 왕십리한양대점", "정통집 신촌점"]
    q = pick_quotes([m("정통집 영등포에서 갔었는데 맛있게 먹었어요", 60, {"맛": 1})],
                    name="정통집 수유역점", siblings=sib)
    assert q["pos"] is None, q["pos"]
    q = pick_quotes([m("정통집 수유역 갔는데 맛있게 먹었어요", 60, {"맛": 1})],
                    name="정통집 수유역점", siblings=sib)
    assert q["pos"] is not None


def test_branch_suffix_is_not_required_for_single_branch():
    q = pick_quotes([m("두루미 1시간 웨이팅하고 먹었는데 최고", 30, {"맛": 1})], name="두루미 서면점")
    assert q["pos"] is not None


def test_single_store_video_does_not_need_the_name():
    q = pick_quotes([c("어제 다녀왔는데 정말 맛있었어요", 10, {"맛": 1})], name="일등식당")
    assert q["pos"] is not None


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t(); print(f"  ✓ {t.__name__}")
        except AssertionError as e:
            failed += 1; print(f"  ✗ {t.__name__} — {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} 통과")
    sys.exit(1 if failed else 0)
