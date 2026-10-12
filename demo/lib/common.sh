# Shared setup for the Tabby demo launcher. Sourced, not run directly.

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$DEMO_DIR/.." && pwd)"
PLUGIN_DIR="$REPO_DIR/plugins/tableau-analytics"
VIEW_DIR="$PLUGIN_DIR/skills/view-tableau-dashboard"
TABLEAU_VIZ="$VIEW_DIR/tableau-viz.sh"
PROMPT_FILE="$DEMO_DIR/opening-prompt.md"
CONFIG_FILE="$DEMO_DIR/tabby-demo.conf"

# Finder-launched windows don't always load the user's shell profile,
# so add the usual install locations.
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Plain-English dialog instead of a terminal error. $1 = message.
alert() {
  osascript -e "display dialog \"$1\" with title \"Tabby demo\" buttons {\"OK\"} default button \"OK\" with icon caution" >/dev/null 2>&1
}

fail() {
  alert "$1"
  echo ""
  echo "Tabby demo: $1"
  echo "You can close this window."
  exit 1
}

preflight() {
  command -v bun >/dev/null 2>&1 || fail "Bun isn't installed on this Mac. Ask Mayra or Stephen to run the one-time setup in demo/README.md."
  [ -x "$TABLEAU_VIZ" ] || fail "The demo files are missing from this folder. Make sure you opened the Tabby repo on the demo branch."
}
