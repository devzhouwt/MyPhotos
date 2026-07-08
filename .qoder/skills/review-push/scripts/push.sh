#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

RUN_DIR="${1:-.review-push/runs/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$RUN_DIR"
RUN_DIR="$(cd "$RUN_DIR" && pwd)"
LOG="$RUN_DIR/push.log"
RESULT="$RUN_DIR/push.json"

BRANCH="$(git branch --show-current)"
if [ -z "$BRANCH" ]; then
  echo "detached HEAD; refusing to push" | tee "$LOG"
  STATUS=1
elif [ "$BRANCH" = "main" ] && [ "${REVIEW_PUSH_ALLOW_MAIN:-}" != "1" ]; then
  echo "refusing to push from main (set REVIEW_PUSH_ALLOW_MAIN=1 to allow)" | tee "$LOG"
  STATUS=1
elif [ -n "$(git status --porcelain)" ]; then
  {
    echo "working tree has uncommitted or untracked changes; refusing to push HEAD"
    git status --short
  } | tee "$LOG"
  STATUS=1
else
  set +e
  bash -c "${REVIEW_PUSH_PUSH_CMD:-git push origin HEAD}" > >(tee "$LOG") 2>&1
  STATUS=$?
  set -e
fi

python3 - "$RESULT" "$STATUS" "$BRANCH" <<'PY'
import json
import sys
from pathlib import Path

status = int(sys.argv[2])
Path(sys.argv[1]).write_text(json.dumps({
    "name": "push",
    "status": "passed" if status == 0 else "failed",
    "exit_code": status,
    "remote": "origin",
    "branch": sys.argv[3],
    "command": "REVIEW_PUSH_PUSH_CMD or git push origin HEAD",
}, ensure_ascii=False, indent=2) + "\n")
PY

exit "$STATUS"
