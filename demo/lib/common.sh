# Shared setup for the Tabby demo launcher. Sourced, not run directly.

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$DEMO_DIR/.." && pwd)"
PLUGIN_DIR="$REPO_DIR/plugins/tableau-analytics"
VIEW_DIR="$PLUGIN_DIR/skills/view-tableau-dashboard"
TABLEAU_VIZ="$VIEW_DIR/tableau-viz.sh"
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

# Yes/no dialog. $1 = message, $2 = yes button. Succeeds if the user chose yes.
confirm() {
  osascript -e "button returned of (display dialog \"$1\" with title \"Tabby demo\" buttons {\"Cancel\", \"$2\"} default button \"$2\")" 2>/dev/null | grep -q "$2"
}

# First run on a Mac: Bun runs the demo window. It installs into the user's
# home folder (no admin password).
install_bun() {
  confirm "Tabby needs to install one component (Bun) the first time it runs on this Mac. It takes about a minute." "Install" \
    || fail "Tabby can't start without Bun. Start the demo again to install it."
  echo "Installing Bun (about a minute)…"
  curl -fsSL https://bun.sh/install | bash || fail "Installing Bun failed. Check the internet connection and try again."
  command -v bun >/dev/null 2>&1 || fail "Bun installed, but Tabby can't find it. Ask Mayra or Stephen for help."
  echo ""
}

preflight() {
  command -v bun >/dev/null 2>&1 || install_bun
  [ -x "$TABLEAU_VIZ" ] || fail "The demo files are missing from this folder. Make sure you opened the Tabby repo on the demo branch."
}
