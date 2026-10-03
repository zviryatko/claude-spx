#!/usr/bin/env bash
# Self-test for the spx-chart mod. Run from anywhere:
#   scripts/selftest.sh [--project /path/to/drupal/project] [--refresh-fixture]
# 1. claude plugin validate   - manifest + hooks module as the engine reads them
# 2. claude plugin test       - unit tests + pane mounted on the terminal surface, incl.
#                               a deep synthetic report (hooks/fixtures/synthetic.ts)
# 3. headless run of /spx-chart against the project's real spx-mcp server
set -euo pipefail
MOD="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$PWD"
REFRESH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --refresh-fixture) REFRESH=1; shift ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done

[ "$REFRESH" = 1 ] && python3 "$MOD/scripts/capture-fixture.py" --project "$PROJECT" --threshold 0.01

echo "== 1/3 validate"; claude plugin validate "$MOD" | grep -E "✘|✔"
echo "== 2/3 plugin test"; claude plugin test "$MOD" | tail -4

echo "== 3/3 headless /spx-chart against the real MCP server (project: $PROJECT)"
LIST="$(cd "$PROJECT" && timeout 600 claude -p "/spx-chart" --plugin-dir "$MOD" < /dev/null 2>&1)"
echo "$LIST" | head -6
echo "$LIST" | grep -Eq "^ *1  " || { echo "FAIL: bare /spx-chart did not list reports" >&2; exit 1; }
OUT="$(cd "$PROJECT" && timeout 600 claude -p "/spx-chart latest" --plugin-dir "$MOD" < /dev/null 2>&1)"
echo "$OUT"
echo "$OUT" | grep -Eq "spx-chart: SPX chart: spx-.* · [0-9]+ frames" || { echo "FAIL: command did not report a loaded chart" >&2; exit 1; }
echo "OK"
