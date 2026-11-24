#!/usr/bin/env bash
# 커밋된 상태(HEAD)만 실서비스에 배포합니다.
#
#   bash scripts/deploy-prod.sh
#
# 작업 폴더에서 바로 `vercel deploy` 하면 커밋 안 한 수정까지 올라갑니다(여러 창이 같은 폴더를 쓸 때 문제).
# 그래서 HEAD 를 임시 폴더로 꺼내 배포합니다. 단, git 에 없는 파일은 거기 없으므로
# .gitignore 된 배포 자산(영상 썸네일 public/img/vid, 약 90MB)을 함께 복사합니다.
# 11/24 이걸 빠뜨리고 배포해 실서비스 썸네일이 전부 404 가 났습니다.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

N=$(ls public/img/vid/*.jpg 2>/dev/null | wc -l | tr -d ' ')
if [ "$N" -lt 1000 ]; then
  echo "public/img/vid 썸네일이 ${N}장뿐입니다. python scripts/fetch_thumbs.py 로 먼저 받으세요." >&2
  exit 1
fi

W="$(mktemp -d)/lesulin-deploy"
git worktree add -q --detach "$W" HEAD
trap 'git -C "$ROOT" worktree remove --force "$W"' EXIT
mkdir -p "$W/.vercel" "$W/public/img"
cp .vercel/project.json "$W/.vercel/"
cp -R public/img/vid "$W/public/img/vid"
echo "배포: $(git log --oneline -1) · 썸네일 ${N}장"
(cd "$W" && npx vercel deploy --prod --yes)
