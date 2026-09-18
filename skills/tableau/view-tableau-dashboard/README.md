# View Tableau Dashboard

Embed a live Tableau view once, keep it stable on screen, and drive Embedding
API v3 interactions by evaluating **agent-authored JavaScript** against the
live viz — no DOM automation, no page reloads, no command catalog.

- **Session-bridge (v2):** a localhost WebSocket bridge relays an `eval`
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
- **Public-first auth:** reuses the browser's logged-in session; library URL is
  derived from the viz origin (Public / Server / Cloud).

## Quick start

Requires [Bun](https://bun.sh).

```bash
./tableau-viz.sh open-site --url <viz-url>       # (one-time) establish a browser session
./tableau-viz.sh start --url <viz-url> --script explore
./tableau-viz.sh wait --meta
./tableau-viz.sh eval 'return helpers.listSheets()' -f json
./tableau-viz.sh eval 'return helpers.applyCategoricalFilter("Table", "Region", ["APAC"], "replace")' -f json
./tableau-viz.sh stop
```

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
- `scripts/` + `scripts.json` — reusable eval steps (`explore`, `describe`).

## Tests

```bash
bun test        # bridge relay, session registry, snapshot, metadata loader
bunx tsc --noEmit
bun run e2e-smoke.ts   # spawns a real bridge, simulates a page, drives the CLI
```