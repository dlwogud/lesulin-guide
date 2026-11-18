"""식당 상세에 보여 줄 대표 댓글 고르기.

build_real_seed.py(새로 만들 때)와 rebuild_quotes.py(DB 의 대표 댓글만 다시 계산할 때)가
같은 규칙을 쓰도록 여기 한 곳에 둡니다.

후보 하나는 {"t": 본문, "like": 좋아요, "at": "YYYY-MM-DD", "asp": {항목: +1/-1}} 입니다.
후보는 이미 "다녀왔다"로 분류됐고 항목이 하나 이상 잡힌 댓글이어야 합니다.

전에 틀렸던 것과 지금 규칙:
- 줄 선 이야기(대기 -1)만 있는 칭찬이 "아쉬운 점"으로 뽑혔습니다(597곳 중 206곳).
  대기 부정은 가게의 결함이 아니라 인기의 증거라서 아쉬운 점으로 세지 않습니다.
- 칭찬이 대부분이고 불만이 한 줄인 댓글도 "아쉬운 점"이었습니다.
  아쉬운 점은 불만(대기 제외)이 칭찬보다 적지 않을 때만 고릅니다.
- 좋았던 점에는 실제 불만(대기 제외)이 섞이지 않은 댓글만 고릅니다.
- "안녕하세요 ○○입니다"로 시작하는 가게·출연자 인사(사장님 사과문, 출연자 감사 인사)를
  방문 후기로 뽑았습니다. 자기소개로 시작하는 댓글은 대표로 쓰지 않습니다.
"""
import re

WAIT = "대기"
CUT = 170
# 한 편에 여러 가게를 도는 채널. 우리 데이터엔 한 편당 한 곳만 연결돼 있어도
# 댓글은 그 편의 다른 가게 이야기일 수 있습니다.
MULTI_PLACE_CREATORS = {"c4"}   # 또간집

# "안녕하세요 여원찜갈비 입니다" · "안녕하세요! 에띵맘입니다" — 인사 바로 뒤 한 단어 + 입니다
_SELF_INTRO = re.compile(r"^\s*안녕하(세요|십니까)[\s!~.,]*\S{1,20}\s*(입니다|이에요|예요)")


def is_self_intro(text):
    return bool(_SELF_INTRO.match(text or ""))


def _gripes(asp):
    return sum(1 for k, v in asp.items() if v < 0 and k != WAIT)


def _praises(asp):
    return sum(1 for v in asp.values() if v > 0)


def _fmt(c):
    return {"x": c["t"].strip()[:CUT], "at": c["at"], "like": c["like"]}


def _top(pool):
    # 좋아요가 가장 많은 것. 같으면 먼저 들어온 것(정렬은 안정적)
    return _fmt(sorted(pool, key=lambda c: -c["like"])[0]) if pool else None


def _parts(name):
    """'정통집 수유역점' → ('정통집', '수유') · '일등식당' → ('일등식당', None).

    앞 단어를 상호로, '…점'으로 끝나는 마지막 단어를 지점으로 봅니다.
    '본점'처럼 지점 이름이 남지 않으면 지점 없음으로 둡니다."""
    words = re.sub(r"\(.*?\)", " ", name or "").split()
    if not words:
        return "", None
    branch = None
    if len(words) > 1 and words[-1].endswith("점"):
        b = re.sub(r"(직영점|본점|역점|점)$", "", words[-1])
        branch = b if len(b) >= 2 else None
    return words[0], branch


def mentions(text, name, siblings=()):
    """댓글이 이 가게를 이름으로 가리키는지.

    같은 영상에 같은 상호의 다른 지점이 있으면(정통집 4곳) 지점 이름까지 있어야 합니다."""
    flat = re.sub(r"\s+", "", text or "")
    brand, branch = _parts(name)
    if not brand or brand not in flat:
        return False
    chain = branch and any(_parts(s)[0] == brand for s in siblings)
    return not chain or branch in flat


def pick_quotes(cands, name=None, siblings=()):
    """name 을 주면, 여러 가게가 나오는 영상의 댓글(cand["multi"])은 이 가게 이름을 쓴 것만 씁니다.

    또간집처럼 한 편에 여러 곳을 도는 영상이나 식당 여러 곳이 연결된 영상의 댓글은
    39%가 다른 가게 이야기였습니다(112건을 읽어 판정, 한 곳 영상은 7%)."""
    cands = [c for c in cands if c.get("asp") and not is_self_intro(c["t"])]
    if name:
        cands = [c for c in cands if not c.get("multi") or mentions(c["t"], name, siblings)]
    pos = [c for c in cands if _praises(c["asp"]) > 0 and _gripes(c["asp"]) == 0]
    neg = [c for c in cands if _gripes(c["asp"]) > 0 and _gripes(c["asp"]) >= _praises(c["asp"])]
    return {"pos": _top(pos), "neg": _top(neg)}
