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
- **Auth that fits the site:** Public views need no auth; authenticated sites
  use `login` (one-time, creds from `.env`) or the token seam. Library URL is
  derived from the viz origin (Public / Server / Cloud).
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
./tableau-viz.sh login --url <viz-url>           # (authenticated sites) sign in once — creds from .env
./tableau-viz.sh start --url <viz-url> --script explore
./tableau-viz.sh wait --meta
./tableau-viz.sh eval 'return helpers.listSheets()' --intent "Reading the sheet list" -f json
./tableau-viz.sh eval 'return helpers.applyCategoricalFilter("Table", "Region", ["APAC"], "replace")' --intent "Filtering Region to APAC" -f json
./tableau-viz.sh stop
```

Public views (`public.tableau.com`) need no auth — skip `login` entirely.

`login` is only needed for **authenticated Tableau Cloud/Server** embeds, whose
session cookies are partitioned and can't be reused across origins. It drives
the embed's own SSO flow once using `TABLEAU_USERNAME`/`TABLEAU_PASSWORD` from
`.env` (see `.env.template`) and saves the session to a dedicated Chrome
profile that `start` reuses — autonomous after the first run.

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