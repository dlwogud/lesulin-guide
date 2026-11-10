"""YouTube Data API v3로 채널·영상·댓글을 수집합니다.

  export YOUTUBE_API_KEY=...
  python3 scripts/collect_youtube.py --channel "채널명"        # 채널 검색
  python3 scripts/collect_youtube.py --channel-id UCxxx --videos 20

쿼터: search.list 100 / videos.list 1 / commentThreads.list 1 (일 10,000)
search는 비싸므로 channel-id를 알면 uploads 재생목록으로 받는다.
"""
import argparse, json, os, pathlib, sys, time, urllib.parse, urllib.request

KEY = os.environ.get("YOUTUBE_API_KEY")
API = "https://www.googleapis.com/youtube/v3/"
OUT = pathlib.Path(__file__).parent.parent / "data" / "youtube"


def call(ep, **params):
    if not KEY:
        sys.exit("YOUTUBE_API_KEY가 없습니다. export YOUTUBE_API_KEY=... 후 다시 실행하세요.")
    params["key"] = KEY
    url = API + ep + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        if e.code == 403 and "quota" in body.lower():
            sys.exit("쿼터를 초과했습니다. 내일 다시 시도하거나 키를 교체하세요.")
        sys.exit(f"API 오류 {e.code}: {body}")


def find_channel(q):
    """검색 결과를 자동으로 '유명 유튜버'로 간주하지 않는다. 사람이 고른다."""
    r = call("search", part="snippet", type="channel", q=q, maxResults=5)
    out = []
    for i in r.get("items", []):
        s = i["snippet"]
        out.append({"channelId": s["channelId"], "title": s["title"],
                    "thumb": s["thumbnails"]["default"]["url"],
                    "desc": s.get("description", "")[:80]})
    return out


def channel_info(cid):
    r = call("channels", part="snippet,contentDetails,statistics", id=cid)
    if not r.get("items"): sys.exit("채널을 찾지 못했습니다.")
    it = r["items"][0]
    st = it.get("statistics", {})
    return {
        "channelId": cid,
        "title": it["snippet"]["title"],
        "profileImageUrl": it["snippet"]["thumbnails"]["high"]["url"],
        "channelUrl": f"https://www.youtube.com/channel/{cid}",
        # 비공개면 표시하지 않는다
        "subscriberCount": None if st.get("hiddenSubscriberCount")
                           else int(st.get("subscriberCount", 0)) or None,
        "uploads": it["contentDetails"]["relatedPlaylists"]["uploads"],
    }


def videos(uploads, limit):
    out, token = [], None
    while len(out) < limit:
        r = call("playlistItems", part="snippet", playlistId=uploads,
                 maxResults=min(50, limit - len(out)), **({"pageToken": token} if token else {}))
        for i in r.get("items", []):
            s = i["snippet"]
            out.append({"youtubeVideoId": s["resourceId"]["videoId"],
                        "title": s["title"], "description": s.get("description", "")[:500],
                        "publishedAt": s["publishedAt"],
                        "thumbnailUrl": s["thumbnails"].get("high", {}).get("url"),
                        "videoUrl": f"https://www.youtube.com/watch?v={s['resourceId']['videoId']}"})
        token = r.get("nextPageToken")
        if not token: break
    return out[:limit]


def comments(vid, limit=200):
    """댓글 비활성화(403)는 오류가 아니라 상태로 기록한다."""
    out, token = [], None
    while len(out) < limit:
        try:
            r = call("commentThreads", part="snippet", videoId=vid, maxResults=100,
                     textFormat="plainText", order="relevance",
                     **({"pageToken": token} if token else {}))
        except SystemExit as e:
            if "403" in str(e): return out, "disabled"
            raise
        for i in r.get("items", []):
            s = i["snippet"]["topLevelComment"]["snippet"]
            out.append({"youtubeCommentId": i["id"], "text": s["textDisplay"],
                        "publishedAt": s["publishedAt"], "likeCount": s.get("likeCount", 0)})
        token = r.get("nextPageToken")
        if not token: break
        time.sleep(0.1)
    return out[:limit], "ok"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel");      ap.add_argument("--channel-id")
    ap.add_argument("--videos", type=int, default=15)
    ap.add_argument("--comments", type=int, default=200)
    a = ap.parse_args()

    if a.channel and not a.channel_id:
        for c in find_channel(a.channel):
            print(f"{c['channelId']}  {c['title']}\n    {c['desc']}")
        print("\n원하는 채널의 ID로 다시 실행하세요: --channel-id UCxxx")
        sys.exit()
    if not a.channel_id: sys.exit("--channel 또는 --channel-id가 필요합니다.")

    OUT.mkdir(parents=True, exist_ok=True)
    ch = channel_info(a.channel_id)
    vs = videos(ch.pop("uploads"), a.videos)
    print(f"{ch['title']} · 영상 {len(vs)}개")
    for v in vs:
        cs, status = comments(v["youtubeVideoId"], a.comments)
        v["comments"], v["commentStatus"] = cs, status
        print(f"  {v['publishedAt'][:10]}  {v['title'][:40]:<42} 댓글 {len(cs)} ({status})")
    path = OUT / f"{a.channel_id}.json"
    path.write_text(json.dumps({"channel": ch, "videos": vs}, ensure_ascii=False, indent=1))
    print(f"\n저장: {path.relative_to(path.parent.parent.parent)}")
