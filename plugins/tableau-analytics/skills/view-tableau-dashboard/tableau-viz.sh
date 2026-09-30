#!/usr/bin/env bash
#
# tableau-viz — agent-facing wrapper for the view-tableau-dashboard CLI.
#
# Resolves bun, installs deps on first run, wires the corporate CA for
# Node/Bun TLS, then execs the Commander CLI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- resolve bun ------------------------------------------------------------
if ! command -v bun >/dev/null 2>&1; then
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  else
    echo "❌ Error: 'bun' not found. Install from https://bun.sh" >&2
    exit 1
  fi
fi

# --- install deps on first run ----------------------------------------------
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "Installing dependencies (first run)…" >&2
  (cd "$SCRIPT_DIR" && bun install) >&2
fi

# --- Corporate CA for TLS -------------------------------------------------
# Bun/Node honor NODE_EXTRA_CA_CERTS. Point at the system corporate CA bundle if
# present and not already configured.
if [ -z "${NODE_EXTRA_CA_CERTS:-}" ]; then
  for ca in \
    "/etc/ssl/certs/corporate-root-ca.pem" \
    "$HOME/.config/corporate-ca/root-ca.pem"; do
    if [ -f "$ca" ]; then
      export NODE_EXTRA_CA_CERTS="$ca"
      break
    fi
  done
fi

exec bun "$SCRIPT_DIR/src/cli.ts" "$@"