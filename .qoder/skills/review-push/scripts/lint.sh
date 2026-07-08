#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

RUN_DIR="${1:-.review-push/runs/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$RUN_DIR"
RUN_DIR="$(cd "$RUN_DIR" && pwd)"
LOG="$RUN_DIR/lint.log"
RESULT="$RUN_DIR/lint.json"

COMMANDS=(
  "cd front && npm run lint"
  "git diff --check"
)

if [ -n "${REVIEW_PUSH_LINT_CMD:-}" ]; then
  COMMANDS=("$REVIEW_PUSH_LINT_CMD")
fi

set +e
{
  for cmd in "${COMMANDS[@]}"; do
    echo "$ $cmd"
    bash -c "$cmd"
    status=$?
    echo
    if [ "$status" -ne 0 ]; then
      exit "$status"
    fi
  done
} > >(tee "$LOG") 2>&1
STATUS=$?
set -e

python3 - "$RESULT" "$STATUS" "${COMMANDS[@]}" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(json.dumps({
    "name": "lint",
    "status": "passed" if int(sys.argv[2]) == 0 else "failed",
    "exit_code": int(sys.argv[2]),
    "commands": sys.argv[3:],
}, ensure_ascii=False, indent=2) + "\n")
PY

exit "$STATUS"
