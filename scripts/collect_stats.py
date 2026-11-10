"""영상의 조회수와 재생시간을 받습니다.

  set -a; source .env.local; set +a
  python3 scripts/collect_stats.py

videos.list 는 id 50개를 한 번에 받고 1유닛입니다. 1,541편이면 31유닛입니다.
이미 받은 영상은 건너뜁니다(--refresh 로 전부 다시).

※ 예전엔 이 단계를 손으로 돌려서, 시드를 다시 만들 때 조회수가 사라졌습니다.
   같은 일이 또 생기지 않게 스크립트로 두고 build_real_seed.py 가 읽게 했습니다.
"""
import json, os, pathlib, re, sys, urllib.error, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"
KEY = os.environ.get("YOUTUBE_API_KEY")
API = "https://www.googleapis.com/youtube/v3/"


def hhmmss(iso):
    """PT1H2M3S → 1:02:03 · PT11M1S → 11:01"""
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return None
    h, mi, s = (int(x or 0) for x in m.groups())
    return f"{h}:{mi:02d}:{s:02d}" if h else f"{mi}:{s:02d}"


def main():
    if not KEY:
        sys.exit("YOUTUBE_API_KEY 가 없습니다.")
    refresh = "--refresh" in sys.argv
    stores = json.load(open(ROOT / "data" / "stores_real.json", encoding="utf-8"))
    vids = sorted({v["id"] for s in stores for v in s["vids"]})

    path = RAW / "video_stats.json"
    out = {} if refresh else (json.load(open(path, encoding="utf-8")) if path.exists() else {})
    todo = [v for v in vids if v not in out]
    print(f"영상 {len(vids)}편 중 받을 것 {len(todo)}편 (쿼터 약 {-(-len(todo)//50)})")

    gone = 0
    for i in range(0, len(todo), 50):
        chunk = todo[i:i + 50]
        u = API + "videos?" + urllib.parse.urlencode(
            {"part": "statistics,contentDetails", "id": ",".join(chunk), "key": KEY})
        try:
            with urllib.request.urlopen(u, timeout=30) as r:
                d = json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:200]
            if e.code == 403 and "quota" in body.lower():
                print("쿼터 초과 — 받은 만큼 저장합니다."); break
            print(f"오류 {e.code}: {body}"); break
        got = set()
        for it in d.get("items", []):
            got.add(it["id"])
            out[it["id"]] = {"views": int(it["statistics"].get("viewCount", 0)) or None,
                             "dur": hhmmss(it["contentDetails"].get("duration"))}
        for v in set(chunk) - got:
            out[v] = {"views": None, "dur": None}      # 삭제·비공개
            gone += 1
        if (i // 50) % 10 == 0:
            print(f"  {min(i+50, len(todo))}/{len(todo)}", flush=True)
        json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)

    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    have = sum(1 for v in vids if out.get(v, {}).get("views"))
    print(f"\n조회수 확보 {have}/{len(vids)}편 · 비공개·삭제 {gone}편 → video_stats.json")


if __name__ == "__main__":
    main()
