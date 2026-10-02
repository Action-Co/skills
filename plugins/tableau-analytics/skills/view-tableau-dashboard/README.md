# View Tableau Dashboard

Embed a live Tableau view once, keep it stable on screen, and drive Embedding
API v3 interactions by evaluating **agent-authored JavaScript** against the
live viz — no DOM automation, no page reloads, no command catalog.

- **Session-bridge:** a localhost WebSocket bridge relays an `eval`
  primitive end-to-end. One shared bridge daemon, many browser tabs, many CLI
  invocations — sub-agents fan out on the same server.
- **Live viz state** (`connecting → loading → interactive | error`), pushed to
  the bridge and readable by any later CLI. Evals against a dead tab fail fast.
- **Instant snapshot** at `firstinteractive` (workbook, sheets, zones,
  parameters, dashboard filters).
- **Background metadata cache** (`meta`): summary columns + visual specs for
  the active dashboard's worksheets, filled progressively.
- **Scripts:** reusable eval steps; `start --script X` auto-fires one on
  `firstinteractive`.
- **Auth that fits the site:** Public views need no auth; authenticated Cloud/Server
  sites use Tableau's in-frame sign-in (a human, once) or the connected-app token
  seam. Library URL is derived from the viz origin (Public / Server / Cloud).
- **Scaled viz display:** the viz renders at a fixed native size (1920×1080
  default; `start --width/--height` to override) and is CSS-scaled to fit any
  surface, aspect-preserving, on a dark background — rounded corners, hairline
  border, and a per-tab glow color so side-by-side tabs are identifiable. The
  tab title becomes "Tableau Session Bridge — <viz name>" once interactive.
- **Agent visibility:** every `eval`/`run` requires `--intent <text>`, shown
  as a notification toast on the page so a human sees what the agent is doing.

## Quick start

Requires [Bun](https://bun.sh).

```bash
./tableau-viz.sh start --url <viz-url> --script explore
./tableau-viz.sh wait --meta
./tableau-viz.sh eval 'return helpers.listSheets()' --intent "Reading the sheet list" -f json
./tableau-viz.sh eval 'return helpers.applyCategoricalFilter("Table", "Region", ["APAC"], "replace")' --intent "Filtering Region to APAC" -f json
./tableau-viz.sh stop
```

Public views (`public.tableau.com`) need no auth — nothing to set up.

**Authenticated Tableau Cloud/Server embeds** are signed in manually: the embed
shows Tableau's in-frame sign-in and a human completes it once in the tab (or
the site provides a connected-app token via `?tableau-token=`). The
partition-scoped session cookie persists in the browser for the top-level origin
(`127.0.0.1:3000`), so later `start` tabs on the same machine reuse it without
re-signing-in.

**Browser support:** Chrome is the recommended browser for authenticated embeds.
Tableau's in-frame sign-in opens an SSO popup, and Safari blocks popups opened
from cross-origin iframes — so authenticated Cloud/Server views don't work well
in Safari. On macOS, `start` opens tabs in Chrome when it's installed (falling
back to the OS default browser). On Windows/Linux, `start` uses the OS default
browser — that's fine, since Edge (Chromium) and Firefox don't block the
sign-in popup. If you're on Safari, try one of our Tableau Public samples
instead (no sign-in needed):

- [Salesforce Dashboard Starters: Opportunity Overview](https://public.tableau.com/views/DashboardStartersOpportunityOverview/OpportunityOverview)
- More samples will be listed here as they are published (e.g. the Superstore
  workbook on Tableau Public).

Enterprise teams that need agent authentication without a human in the loop
should provision a connected-app token — contact Action (action.co) to set that
up.

## Docs

- `SKILL.md` — the agent runbook (read first).
- `docs/EMBEDDING_API.md` — the curated Embedding API v3 reference: object tree,
  enum literals, correctness rules, helpers, `meta`, auth troubleshooting.
- `docs/PROTOCOL.md` — the Zod-validated WS envelope schemas + state machine.

## Layout

- `src/bridge.ts` — bridge daemon (`Bun.serve`): static host, WS relay,
  per-session store, token guard, heartbeat.
- `src/session.ts` — session registry (`temp/sessions.json`), port probe/reclaim.
- `src/cli.ts` — `tableau-viz` CLI (start / ls / status / wait / meta / eval /
  run / scripts / open-site / stop).
- `src/client/` — executor, snapshot, metadata-loader (in-page, bundled).
- `scripts/` + `scripts.json` — reusable eval steps (`explore`).

## Tests

```bash
bun test        # bridge relay, session registry, snapshot, metadata loader
bunx tsc --noEmit
bun run e2e-smoke.ts   # spawns a real bridge, simulates a page, drives the CLI
```