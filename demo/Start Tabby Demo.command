#!/usr/bin/env bash
#
# Start Tabby Demo — double-click launcher (macOS).
#
# Opens the Tabby demo window: a welcome page, a side-panel menu of demos, and
# the Superstore Overview dashboard running by default (Tableau Public; no
# sign-in, no .env, no AI required). If an AI agent is set up, the presenter
# talks to Tabby in the window's Ask Tabby chat (app/server.ts runs the agent).

set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

APP_PORT=4747
APP_URL="http://127.0.0.1:$APP_PORT"
APP_LOG="$VIEW_DIR/temp/tabby-app.log"

# --- Agents ------------------------------------------------------------------
# One entry per supported AI agent: "id|Name|command to detect it".
# To add an agent, add a line here and a matching adapter in AGENT_ADAPTERS
# in app/server.ts.
AGENTS=(
  "claude|Claude Code|claude"
)

# Picks the agent from tabby-demo.conf. Prints "id|Name", or nothing for none.
pick_agent() {
  local wanted="auto" entry id label cmd
  [ -f "$CONFIG_FILE" ] && wanted="$(sed -n 's/^AGENT=//p' "$CONFIG_FILE" | tr -d '[:space:]')"
  [ "$wanted" = "none" ] && return
  for entry in "${AGENTS[@]}"; do
    IFS="|" read -r id label cmd <<< "$entry"
    if { [ "$wanted" = "auto" ] || [ "$wanted" = "$id" ]; } && command -v "$cmd" >/dev/null 2>&1; then
      echo "$id|$label"
      return
    fi
  done
}

# Close the demo window's server and the dashboards when the demo ends.
cleanup() {
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" >/dev/null 2>&1
  "$TABLEAU_VIZ" stop >/dev/null 2>&1 || true
}

# --- Start -------------------------------------------------------------------

clear
echo "Starting the Tabby demo…"
echo ""

preflight

# First run: install the dashboard skill's dependencies.
if [ ! -d "$VIEW_DIR/node_modules" ]; then
  echo "First run on this Mac — installing demo components (about a minute)…"
  (cd "$VIEW_DIR" && bun install) || fail "Installing the demo components failed. Check the internet connection and try again."
  echo ""
fi

# Start fresh: close dashboards and a demo window left over from an earlier run.
"$TABLEAU_VIZ" stop >/dev/null 2>&1 || true
if curl -fsS "$APP_URL/api/config" 2>/dev/null | grep -q '"tabby"'; then
  lsof -ti "tcp:$APP_PORT" | xargs kill >/dev/null 2>&1
  sleep 1
fi

cd "$REPO_DIR" || fail "Couldn't open the repo folder."
AGENT="$(pick_agent)"
AGENT_ID=""
AGENT_NAME=""
[ -n "$AGENT" ] && IFS="|" read -r AGENT_ID AGENT_NAME <<< "$AGENT"

# Start the demo window's local server.
mkdir -p "$(dirname "$APP_LOG")"
TABBY_AGENT_ID="$AGENT_ID" TABBY_AGENT_NAME="$AGENT_NAME" TABBY_PLUGIN_DIR="$PLUGIN_DIR" \
  TABBY_APP_PORT="$APP_PORT" bun "$DEMO_DIR/app/server.ts" >"$APP_LOG" 2>&1 &
APP_PID=$!
trap 'exit' HUP INT TERM
trap cleanup EXIT

for _ in $(seq 1 50); do
  curl -fsS "$APP_URL/api/config" >/dev/null 2>&1 && break
  sleep 0.2
done
curl -fsS "$APP_URL/api/config" >/dev/null 2>&1 \
  || fail "The demo window didn't start. Details are in $APP_LOG"

# Open the demo window. Chrome opens it as a clean app window; otherwise use
# the default browser.
echo "Opening the Tabby demo window…"
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$APP_URL" --window-size=1600,1000
else
  open "$APP_URL"
fi

echo ""
if [ -n "$AGENT_ID" ]; then
  echo "Talk to Tabby with Ask Tabby in the demo window (${AGENT_NAME})."
else
  echo "The demo is running without an AI agent."
  echo "Pick demos from the menu in the Tabby window."
fi
echo ""
read -r -p "Press Return when you're done to end the demo… " _
echo ""
echo "Tabby demo ended. You can close this window."
