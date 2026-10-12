#!/usr/bin/env bash
#
# Start Tabby Demo — double-click launcher (macOS).
#
# Opens Claude Code with the tableau-analytics plugin loaded from this repo
# and starts the Superstore demo on Tableau Public (no sign-in, no .env).
# Demoers never type in the terminal to get started.

set -uo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEMO_DIR/.." && pwd)"
PLUGIN_DIR="$REPO_DIR/plugins/tableau-analytics"
VIEW_DIR="$PLUGIN_DIR/skills/view-tableau-dashboard"
SETTINGS_FILE="$DEMO_DIR/tabby-demo-settings.json"
PROMPT_FILE="$DEMO_DIR/opening-prompt.md"

# Finder-launched windows don't always load the user's shell profile,
# so add the usual install locations for claude and bun.
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Plain-English dialog instead of a terminal error. $1 = message.
alert() {
  osascript -e "display dialog \"$1\" with title \"Tabby demo\" buttons {\"OK\"} default button \"OK\" with icon caution" >/dev/null 2>&1
}

fail() {
  alert "$1"
  echo ""
  echo "Tabby demo could not start: $1"
  echo "You can close this window."
  exit 1
}

clear
echo "Starting the Tabby demo…"
echo ""

# --- Preflight checks --------------------------------------------------------
command -v claude >/dev/null 2>&1 || fail "Claude Code isn't installed on this Mac. Ask Mayra or Stephen to run the one-time setup in demo/README.md."
command -v bun    >/dev/null 2>&1 || fail "Bun isn't installed on this Mac. Ask Mayra or Stephen to run the one-time setup in demo/README.md."
[ -d "$VIEW_DIR" ]      || fail "The demo files are missing from this folder. Make sure you opened the Tabby repo on the demo branch."
[ -f "$SETTINGS_FILE" ] || fail "demo/tabby-demo-settings.json is missing."
[ -f "$PROMPT_FILE" ]   || fail "demo/opening-prompt.md is missing."

if [ ! -d "/Applications/Google Chrome.app" ]; then
  echo "Note: Google Chrome isn't installed. Tableau Public dashboards still open in your default browser."
  echo ""
fi

# --- First run: install the dashboard skill's dependencies --------------------
if [ ! -d "$VIEW_DIR/node_modules" ]; then
  echo "First run on this Mac — installing demo components (about a minute)…"
  (cd "$VIEW_DIR" && bun install) || fail "Installing the demo components failed. Check the internet connection and try again."
  echo ""
fi

# --- Start Claude with the plugin and the opening prompt ----------------------
cd "$REPO_DIR" || fail "Couldn't open the repo folder."
OPENING_PROMPT="$(cat "$PROMPT_FILE")"

echo "Opening Claude and the Superstore dashboard. Your browser will open a new tab in a few seconds."
echo ""

claude \
  --plugin-dir "$PLUGIN_DIR" \
  --settings "$SETTINGS_FILE" \
  "$OPENING_PROMPT"

# --- Clean up when the presenter quits Claude --------------------------------
"$VIEW_DIR/tableau-viz.sh" stop >/dev/null 2>&1 || true
echo ""
echo "Tabby demo ended. You can close this window."
