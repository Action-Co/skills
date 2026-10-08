#!/usr/bin/env bash
#
# derive-workbook.sh — one-shot derivation of a workbook's semantic model.
#
# Embeds the workbook in a live viz, runs scripts/derive-workbook.js against it
# (via the view-tableau-dashboard skill's tableau-viz CLI), and writes
# <Name>.derived.json into <site>/workbooks/<Workbook>/.
#
# Layout convention:
#   <site>/workbooks/<Workbook>/<Workbook>.<View>.md + .derived.json
# <site> is your Tableau site folder — the shipped placeholder is "your-site";
# rename it to the site's content URL (add a sibling folder per extra site).
# The <Workbook> folder is the part of --name before the first ".". The
# behavioral <Name>.md is the human half — write it from
# docs/WORKBOOK_TEMPLATE.md (see docs/WRITING.md).
#
# Usage:
#   ./derive-workbook.sh --site <site> --url <viz-url> --name <Workbook>.<View> [--dir <path>]
#
#   --site  site folder at the skill root (the rename-me placeholder is "your-site")
#   --url   the direct Tableau view URL (/views/...)
#   --name  base name for the model files, "<Workbook>.<View>"
#   --dir   override the skill root (default: this script's parent)
#
# Example:
#   ./derive-workbook.sh --site your-site \
#     --url https://public.tableau.com/views/Superstore-Overview_17909191002920/Overview \
#     --name SUPERSTORE.Overview
#
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIZ_DIR="${TABLEAU_VIZ_DIR:-$SKILL_DIR/../view-tableau-dashboard}"

SITE=""
URL=""
NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site) SITE="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --dir) SKILL_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$SITE" ] || [ -z "$URL" ] || [ -z "$NAME" ]; then
  echo "usage: derive-workbook.sh --site <site> --url <viz-url> --name <Workbook>.<View> [--dir <path>]" >&2
  exit 1
fi
if [ ! -x "$VIZ_DIR/tableau-viz.sh" ]; then
  echo "view-tableau-dashboard not found at $VIZ_DIR (set TABLEAU_VIZ_DIR)" >&2
  exit 1
fi

DERIVE_JS="$SKILL_DIR/scripts/derive-workbook.js"

# Workbook folder = the part of --name before the first "."
WORKBOOK="${NAME%%.*}"
OUT_DIR="$SKILL_DIR/$SITE/workbooks/$WORKBOOK"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/$NAME.derived.json"

echo "[derive] url=$URL"
echo "[derive] output=$OUT_FILE"

SESSION_ID=""
cleanup() {
  if [ -n "$SESSION_ID" ]; then
    "$VIZ_DIR/tableau-viz.sh" stop --session "$SESSION_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

START_JSON="$("$VIZ_DIR/tableau-viz.sh" start --url "$URL" -f json)"
SESSION_ID="$(printf '%s' "$START_JSON" | sed -n 's/.*"session": "\([^"]*\)".*/\1/p')"
if [ -z "$SESSION_ID" ]; then
  echo "[derive] ERROR: could not start a session" >&2
  exit 1
fi
echo "[derive] session=$SESSION_ID"

"$VIZ_DIR/tableau-viz.sh" wait --session "$SESSION_ID" --meta >/dev/null

"$VIZ_DIR/tableau-viz.sh" eval --file "$DERIVE_JS" --session "$SESSION_ID" \
  --intent "Deriving workbook semantic model" -f json -o "$OUT_FILE"

echo "[derive] done — derived model saved:"
echo "$OUT_FILE"
