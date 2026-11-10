"""채널 프로필과 영상 썸네일을 내려받습니다.

  set -a; source .env.local; set +a
  python3 scripts/fetch_images.py

썸네일은 i.ytimg.com 에서 바로 받습니다(API 쿼터 안 씁니다).
채널 프로필만 channels.list 를 한 번 부릅니다(채널 수만큼 1유닛).
이미 있는 파일은 건너뜁니다.
"""
import json, os, pathlib, sys, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).parent.parent
IMG = ROOT / "public" / "img"
KEY = os.environ.get("YOUTUBE_API_KEY")
sys.path.insert(0, str(ROOT / "scripts"))
from build_real_seed import CREATORS


def save(url, path):
    if path.exists() and path.stat().st_size > 1000:
        return "있음"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            b = r.read()
        if len(b) < 1000:
            return "빈파일"
        path.write_bytes(b)
        return "받음"
    except Exception:
        return "실패"


def main():
    (IMG / "ch").mkdir(parents=True, exist_ok=True)
    (IMG / "vid").mkdir(parents=True, exist_ok=True)

    # 1. 채널 프로필
    need = [(cid, c["yt"]) for cid, c in CREATORS.items()
            if not (IMG / "ch" / f"{cid}.jpg").exists()]
    if need and KEY:
        ids = ",".join(y for _, y in need)
        u = ("https://www.googleapis.com/youtube/v3/channels?"
             + urllib.parse.urlencode({"part": "snippet", "id": ids, "key": KEY}))
        try:
            with urllib.request.urlopen(u, timeout=25) as r:
                items = {i["id"]: i["snippet"]["thumbnails"]["high"]["url"]
                         for i in json.load(r).get("items", [])}
        except Exception as e:
            items = {}
            print(f"채널 조회 실패: {e}")
        for cid, yt in need:
            if yt in items:
                print(f"  프로필 {cid:<5}{save(items[yt], IMG / 'ch' / f'{cid}.jpg')}")
            else:
                print(f"  프로필 {cid:<5}채널 조회 안 됨 ({yt})")
    elif need:
        print("YOUTUBE_API_KEY 가 없어 채널 프로필은 건너뜁니다.")

    # 2. 영상 썸네일
    stores = json.load(open(ROOT / "data" / "stores_real.json", encoding="utf-8"))
    vids = sorted({v["id"] for s in stores for v in s["vids"]})
    todo = [v for v in vids if not (IMG / "vid" / f"{v}.jpg").exists()]
    print(f"\n영상 {len(vids)}편 중 받을 썸네일 {len(todo)}장")

    done = [0]
    def work(vid):
        r = save(f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg", IMG / "vid" / f"{vid}.jpg")
        done[0] += 1
        if done[0] % 200 == 0:
            print(f"  {done[0]}/{len(todo)}", flush=True)
        return r
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(work, todo))
    from collections import Counter
    for k, n in Counter(res).most_common():
        print(f"  {k:<6}{n:>5}장")
    print(f"\n보유 썸네일 {len(list((IMG/'vid').glob('*.jpg')))}장 · 프로필 {len(list((IMG/'ch').glob('*.jpg')))}장")


if __name__ == "__main__":
    main()
