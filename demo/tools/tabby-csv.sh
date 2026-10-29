#!/usr/bin/env bash
# tabby-csv: read-only analysis of CSV files attached in Ask Tabby.
# Usage is in tabby-csv.ts. Pre-approved for the agent in agents/claude-settings.json.
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec bun "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tabby-csv.ts" "$@"
