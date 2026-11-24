"""영상 썸네일을 고화질로 받습니다 → public/img/vid/{영상id}.jpg (640x360).

예전에는 mqdefault(320x180)를 그대로 썼는데, 카드가 커지고 레티나 화면에서 흐릿했습니다.
YouTube 썸네일은 큰 것일수록 없는 영상이 있어 큰 것부터 차례로 시도합니다.
  maxresdefault 1280x720 → sddefault 640x480 → hqdefault 480x360 → mqdefault 320x180
sd·hq 는 4:3 이라 위아래 검은 띠가 붙어 있습니다. 가운데 16:9 만 잘라 씁니다.
없는 썸네일 주소는 404 대신 120x90 회색 그림을 주는 경우가 있어, 그 크기는 실패로 칩니다.

    python scripts/fetch_thumbs.py            없는 것만
    python scripts/fetch_thumbs.py --all      전부 다시 (예전 320x180 을 바꿀 때)

썸네일은 i.ytimg.com 에서 바로 받습니다(API 쿼터 안 씁니다). 폴더는 .gitignore 라 배포할 때 함께 올려야 합니다.
"""
import io
import json
import sys
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "img" / "vid"
W, H = 640, 360
KINDS = ["maxresdefault", "sddefault", "hqdefault", "mqdefault"]


def get(url: str) -> bytes | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20) as r:
            return r.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return None


def crop169(im: Image.Image) -> Image.Image:
    w, h = im.size
    if abs(w / h - 16 / 9) < 0.02:
        return im
    if w / h < 16 / 9:                       # 4:3 → 위아래 검은 띠를 잘라 냄
        nh = round(w * 9 / 16)
        top = (h - nh) // 2
        return im.crop((0, top, w, top + nh))
    nw = round(h * 16 / 9)
    left = (w - nw) // 2
    return im.crop((left, 0, left + nw, h))


def fetch(vid: str) -> str:
    for kind in KINDS:
        b = get(f"https://i.ytimg.com/vi/{vid}/{kind}.jpg")
        if not b:
            continue
        im = Image.open(io.BytesIO(b)).convert("RGB")
        if im.size == (120, 90):              # "썸네일 없음" 회색 그림
            continue
        im = crop169(im).resize((W, H), Image.LANCZOS)
        tmp = OUT / f".{vid}.jpg"
        im.save(tmp, "JPEG", quality=82, optimize=True, progressive=True)
        tmp.replace(OUT / f"{vid}.jpg")
        return kind
    return "fail"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stores = json.load(open(ROOT / "data" / "stores_real.json", encoding="utf-8"))
    vids = sorted({v["id"] for s in stores for v in s["vids"]})
    redo = "--all" in sys.argv
    todo = [v for v in vids if redo or not (OUT / f"{v}.jpg").exists()]
    print(f"영상 {len(vids)}편 중 받을 썸네일 {len(todo)}장 ({W}x{H})")
    done = [0]

    def work(v):
        r = fetch(v)
        done[0] += 1
        if done[0] % 200 == 0:
            print(f"  {done[0]}/{len(todo)}", flush=True)
        return v, r

    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(work, todo))
    for k, n in Counter(r for _, r in res).most_common():
        print(f"  {k:<14}{n:>5}장")
    fails = [v for v, r in res if r == "fail"]
    if fails:
        print("  실패:", " ".join(fails[:20]))


if __name__ == "__main__":
    main()
