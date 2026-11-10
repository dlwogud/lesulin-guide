"""식당에 연결된 영상의 댓글을 받습니다.

  set -a; source .env.local; set +a
  python3 scripts/collect_comments.py [--max-pages 5]

쿼터: commentThreads.list 는 호출당 1, 한 번에 100개. 영상당 최대 max-pages 번 부릅니다.
댓글이 꺼진 영상은 403을 돌려주는데, 그건 오류가 아니라 상태라서 기록만 하고 넘어갑니다.
"""
import argparse, json, os, pathlib, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).parent.parent
API = "https://www.googleapis.com/youtube/v3/"
KEY = os.environ.get("YOUTUBE_API_KEY")


def call(ep, **params):
    if not KEY:
        sys.exit("YOUTUBE_API_KEY가 없습니다. set -a; source .env.local; set +a 후 다시 실행하세요.")
    params["key"] = KEY
    url = API + ep + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            if e.code == 403 and "quota" in body.lower():
                sys.exit("쿼터를 초과했습니다. 내일 다시 실행하면 이어서 받습니다.")
            if e.code == 403:
                return {"_disabled": True}          # 댓글 사용 중지 — 상태이지 오류가 아님
            if e.code == 404:
                return {"_gone": True}
            if attempt == 2:
                return {"_err": f"{e.code} {body[:120]}"}
            time.sleep(1.5)
        except Exception as e:
            if attempt == 2:
                return {"_err": f"{type(e).__name__}"}
            time.sleep(1.5)
    return {"_err": "retry"}


def fetch(video_id, max_pages):
    out, tok = [], None
    for _ in range(max_pages):
        d = call("commentThreads", part="snippet", videoId=video_id, maxResults=100,
                 order="relevance", textFormat="plainText",
                 **({"pageToken": tok} if tok else {}))
        if "_disabled" in d: return None, "disabled"
        if "_gone" in d:     return None, "gone"
        if "_err" in d:      return out, d["_err"]
        for i in d.get("items", []):
            s = i["snippet"]["topLevelComment"]["snippet"]
            out.append({"t": s["textOriginal"], "at": s["publishedAt"][:10],
                        "like": s.get("likeCount", 0),
                        "au": (s.get("authorChannelId") or {}).get("value", "")})
        tok = d.get("nextPageToken")
        if not tok: break
    return out, "ok"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-pages", type=int, default=5)      # 영상당 최대 500개
    args = ap.parse_args()

    stores = json.load(open(ROOT / "data" / "stores_real.json", encoding="utf-8"))
    vids = {v["id"]: v for s in stores for v in s["vids"]}
    out_path = ROOT / "data" / "raw" / "youtube" / "comments2.json"
    done = json.load(open(out_path, encoding="utf-8")) if out_path.exists() else {}
    todo = [v for v in vids if v not in done]
    print(f"영상 {len(vids)}편 중 받을 것 {len(todo)}편 (이미 받은 것 {len(done)}편)")

    used, t0 = 0, time.time()
    for i, vid in enumerate(todo, 1):
        cs, status = fetch(vid, args.max_pages)
        used += args.max_pages if cs else 1
        done[vid] = {"status": status, "comments": cs or []}
        if i % 25 == 0 or i == len(todo):
            json.dump(done, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
            n = sum(len(v["comments"]) for v in done.values())
            print(f"  {i}/{len(todo)} · 댓글 {n:,}개 · {time.time()-t0:.0f}초", flush=True)

    json.dump(done, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
    from collections import Counter
    st = Counter(v["status"] for v in done.values())
    total = sum(len(v["comments"]) for v in done.values())
    print(f"\n영상 {len(done)}편 · 댓글 {total:,}개")
    for k, n in st.most_common():
        print(f"  {k:<10}{n:>5}편")
    print(f"쿼터 약 {used} 소모")
