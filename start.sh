#!/bin/sh
# 르슐랭 가이드 — 카카오맵 버전 실행
# 사용법:  ./start.sh
set -e
cd "$(dirname "$0")"
. ./.env.local
PORT=4321
URL="http://localhost:$PORT/map.html?key=$NEXT_PUBLIC_KAKAO_MAP_KEY"
# 이미 떠 있으면 다시 띄우지 않습니다
if ! curl -s -o /dev/null "http://localhost:$PORT/map.html"; then
  (cd public && python3 -m http.server "$PORT" >/dev/null 2>&1 &)
  sleep 1
fi
echo "열기: $URL"
open "$URL" 2>/dev/null || true
