"""채널의 업로드 영상 전체를 받아 cN_full.json 으로 저장합니다.

  set -a; source .env.local; set +a
  python3 scripts/collect_channel.py c6 UC-x55HF1-IilhxZOzwJm7JA 김사원세끼

search.list(100유닛)를 쓰지 않고 uploads 재생목록을 페이지로 넘깁니다.
50편당 1유닛이라 1,500편 채널도 30유닛이면 끝납니다.

이미 파일이 있으면 마지막 수집일 이후만 받아 이어 붙입니다.
"""
import json, os, pathlib, sys, urllib.error, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "youtube"
KEY = os.environ.get("YOUTUBE_API_KEY")
API = "https://www.googleapis.com/youtube/v3/"


def call(ep, **p):
    p["key"] = KEY
    try:
        with urllib.request.urlopen(API + ep + "?" + urllib.parse.urlencode(p), timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        if e.code == 403 and "quota" in body.lower():
            sys.exit("유튜브 쿼터 초과. 받은 만큼은 저장돼 있습니다.")
        sys.exit(f"API 오류 {e.code}: {body}")


def main():
    if not KEY:
        sys.exit("YOUTUBE_API_KEY 가 없습니다.  set -a; source .env.local; set +a")
    if len(sys.argv) < 4:
        sys.exit("사용법: collect_channel.py <cid> <channelId> <표시이름>")
    cid, chan, name = sys.argv[1], sys.argv[2], sys.argv[3]

    r = call("channels", part="snippet,contentDetails,statistics", id=chan)
    if not r.get("items"):
        sys.exit(f"채널을 찾지 못했습니다: {chan}")
    it = r["items"][0]
    up = it["contentDetails"]["relatedPlaylists"]["uploads"]
    st = it.get("statistics", {})
    subs = None if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0)) or None

    path = RAW / f"{cid}_full.json"
    have = {}
    if path.exists():
        have = {v["id"]: v for v in json.load(open(path, encoding="utf-8"))["videos"]}
        print(f"기존 {len(have)}편 있음 — 새 영상만 받습니다.")

    out, tok,新 = list(have.values()), None, 0
    while True:
        d = call("playlistItems", part="snippet", playlistId=up, maxResults=50,
                 **({"pageToken": tok} if tok else {}))
        page = d.get("items", [])
        stop = False
        for i in page:
            s = i["snippet"]
            vid = s["resourceId"]["videoId"]
            if vid in have:
                stop = True          # 최신순이라 아는 영상을 만나면 그 뒤는 다 있습니다
                continue
            out.append({"id": vid, "t": s["title"],
                        "d": s.get("description", ""), "at": s["publishedAt"][:10]})
            新 += 1
        if stop and have:
            break
        tok = d.get("nextPageToken")
        if not tok:
            break
        if 新 % 250 == 0 and 新:
            print(f"  {新}편...", flush=True)

    out.sort(key=lambda v: v["at"], reverse=True)
    json.dump({"creator": cid, "name": name, "channelId": chan, "subs": subs, "videos": out},
              open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    sub = f"{subs:,}명" if subs else "비공개"
    print(f"{name} · 구독 {sub} · 영상 {len(out)}편 (새로 {新}편) → {path.name}")


if __name__ == "__main__":
    main()
