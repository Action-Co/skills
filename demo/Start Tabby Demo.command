#!/usr/bin/env bash
#
# Start Tabby Demo — double-click launcher (macOS).
#
# Runs the Superstore demo on Tableau Public (no sign-in, no .env).
# Works with no AI agent installed. A menu offers:
#   - Talk to Tabby with each supported AI agent found on this Mac
#   - Autopilot: executive summary of all six dashboards (no AI)
#   - Open the Superstore dashboard (no AI)

set -uo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEMO_DIR/.." && pwd)"
PLUGIN_DIR="$REPO_DIR/plugins/tableau-analytics"
VIEW_DIR="$PLUGIN_DIR/skills/view-tableau-dashboard"
TABLEAU_VIZ="$VIEW_DIR/tableau-viz.sh"
PROMPT_FILE="$DEMO_DIR/opening-prompt.md"
OVERVIEW_URL="https://public.tableau.com/views/Superstore-Overview_17909191002920/Overview"

# Finder-launched windows don't always load the user's shell profile,
# so add the usual install locations.
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"

# --- Helpers -----------------------------------------------------------------

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

# Native Mac picker. $1 = prompt, remaining args = choices.
# Prints the chosen item, or "false" if the presenter clicks Cancel.
choose() {
  local prompt="$1"; shift
  local list="" item
  for item in "$@"; do list+="\"$item\","; done
  list="${list%,}"
  osascript -e "choose from list {$list} with title \"Tabby demo\" with prompt \"$prompt\" default items {\"$1\"} OK button name \"Start\" cancel button name \"Cancel\"" 2>/dev/null
}

wait_to_end() {
  echo ""
  read -r -p "Press Return when you're done to end the demo… " _
}

# --- Agent adapters ----------------------------------------------------------
# One entry per supported AI agent: "id|Menu name|command to detect it".
# To add an agent, add a line here and a matching start_<id> function that
# loads the plugin's skills and sends opening-prompt.md as the first message.
AGENTS=(
  "claude|Claude Code|claude"
)

start_claude() {
  claude \
    --plugin-dir "$PLUGIN_DIR" \
    --settings "$DEMO_DIR/agents/claude-settings.json" \
    "$(cat "$PROMPT_FILE")"
}

# --- No-AI modes -------------------------------------------------------------

run_overview() {
  echo "Opening the Superstore Overview dashboard…"
  "$TABLEAU_VIZ" start --url "$OVERVIEW_URL" >/dev/null \
    || fail "The dashboard didn't open. Check the internet connection and try again."
  echo "The dashboard is open in your browser."
  wait_to_end
}

run_autopilot() {
  echo "Autopilot: opening all six Superstore dashboards and building the executive summary."
  echo "This takes a minute or two. Watch the browser tabs."
  echo ""
  if "$TABLEAU_VIZ" run daily-executive-summary --intent "Building the daily executive summary" >/dev/null; then
    echo ""
    echo "The executive summary report is open in your browser."
  else
    alert "Autopilot hit a problem. Any dashboards that finished are still open in the browser."
  fi
  wait_to_end
}

# --- Start -------------------------------------------------------------------

clear
echo "Starting the Tabby demo…"
echo ""

command -v bun >/dev/null 2>&1 || fail "Bun isn't installed on this Mac. Ask Mayra or Stephen to run the one-time setup in demo/README.md."
[ -x "$TABLEAU_VIZ" ] || fail "The demo files are missing from this folder. Make sure you opened the Tabby repo on the demo branch."
[ -f "$PROMPT_FILE" ] || fail "demo/opening-prompt.md is missing."

# First run: install the dashboard skill's dependencies.
if [ ! -d "$VIEW_DIR/node_modules" ]; then
  echo "First run on this Mac — installing demo components (about a minute)…"
  (cd "$VIEW_DIR" && bun install) || fail "Installing the demo components failed. Check the internet connection and try again."
  echo ""
fi

# Build the menu: installed agents first, then the no-AI modes.
MENU=()
MENU_IDS=()
for entry in "${AGENTS[@]}"; do
  IFS="|" read -r id label cmd <<< "$entry"
  if command -v "$cmd" >/dev/null 2>&1; then
    MENU+=("Talk to Tabby with $label")
    MENU_IDS+=("$id")
  fi
done
MODE_AUTOPILOT="Autopilot: executive summary of all six dashboards (no AI)"
MODE_OVERVIEW="Open the Superstore dashboard (no AI)"
MENU+=("$MODE_AUTOPILOT" "$MODE_OVERVIEW")
MENU_IDS+=("autopilot" "overview")

CHOICE="$(choose "How do you want to run the demo?" "${MENU[@]}")"
if [ -z "$CHOICE" ] || [ "$CHOICE" = "false" ]; then
  echo "Demo cancelled. You can close this window."
  exit 0
fi

MODE=""
for i in "${!MENU[@]}"; do
  [ "${MENU[$i]}" = "$CHOICE" ] && MODE="${MENU_IDS[$i]}"
done

cd "$REPO_DIR" || fail "Couldn't open the repo folder."
case "$MODE" in
  autopilot) run_autopilot ;;
  overview)  run_overview ;;
  "")        fail "Unknown choice: $CHOICE" ;;
  *)
    echo "Opening Tabby. Your browser will open the Superstore dashboard in a few seconds."
    echo ""
    "start_$MODE"
    ;;
esac

# Close the dashboard connection when the demo ends.
"$TABLEAU_VIZ" stop >/dev/null 2>&1 || true
echo ""
echo "Tabby demo ended. You can close this window."
