---
name: view-tableau-dashboard
description: Use this skill to interact with live Tableau dashboards to retrieve trusted data from visual interfaces that human users rely on for decision-making. It allows for reading and applying filters, getting and setting parameters, retrieving data, and selecting marks programmatically by evaluating agent generated JavaScript in a browser tab with the Tableau Embedding API.
license: Apache-2.0
metadata:
  authors: "stephen@action.co"
  version: "0.1.0"
  tags: ["tableau", "data", "analytics", "visualization", "chart"]
---

# View Tableau Dashboard

Embed a Tableau view **once**, keep it stable on screen, and drive Embedding
API v3 interactions by evaluating **agent-authored JavaScript** against the
live viz — no DOM automation, no page reloads, no command catalog to maintain.
A localhost bridge exposes a single `eval` primitive; every capability (list
sheets, read/apply filters, get/set parameters, retrieve data, select marks) is
JavaScript the agent writes, aided by an in-page helper library and a
background metadata cache.

This is the **session-bridge (v2)** implementation — the replacement for the
`view-tableau-dashboard-prototype`. Notable improvements:

- **WebSocket transport end-to-end** (no HTTP long-polling).
- **The session is the unit:** one shared bridge daemon, N browser tabs, N CLI
  invocations. Sub-agents fan out on the same server, each driving its own viz.
- **Live viz state** (`connecting → loading → interactive | error`), pushed to
  the bridge and readable by any later CLI — evals against a dead tab fail
  fast instead of hanging.
- **Instant snapshot** at `firstinteractive` (workbook, sheets, zones,
  parameters, dashboard filters) so the agent confirms access and describes the
  dashboard immediately.
- **Background metadata cache** (`meta`) — summary columns + visual specs for
  the active dashboard's worksheets, filled progressively at ~0ms read cost.
- **Scripts** — reusable eval steps; `start --script X` auto-fires one on
  `firstinteractive`, delivering `scriptResult` alongside the snapshot.
- **Auth that fits the site** — Tableau Public views need **no auth** (they
  just render); authenticated sites use `login` (drives the embed's own SSO
  once, creds from `.env`) or the reserved connected-app token seam. Library
  URL is derived from the viz origin (works for Public, Server, Cloud) — the
  environment-swap ritual is gone.
- **`start` always opens a tab** (the "already running ⇒ no tab" gotcha is gone).

## When to use this skill

- "Show me the SOC dashboard and filter it to the APAC region."
- "Read the current filters / parameters on this view."
- "Pull the summary data behind this worksheet as a table."
- "Set the *Compare Region* parameter to Europe and re-read the data."

It is the interactive-embedding runtime. It is **not** for querying Tableau's
REST/metadata APIs (use `query-tableau-data`) and does **not** export files.

## Layout

- `src/bridge.ts` — the session-bridge daemon (`Bun.serve`): static host, WS
  relay, per-session store, token guard, heartbeat.
- `src/session.ts` — the CLI-side session registry (`temp/sessions.json`), port
  probe/reclaim, id minting, URL handling.
- `src/cli.ts` — the `tableau-viz` CLI (start / login / ls / status / wait /
  meta / eval / run / scripts / open-site / stop).
- `src/client/executor.ts` — the in-page executor (bundled to JS and served by
  the bridge): WS connect, state machine, serialized eval loop, safe serializer,
  helper library, `meta` scope.
- `src/client/snapshot.ts` — instant-snapshot assembly (pure, unit-tested).
- `src/client/metadata-loader.ts` — background metadata cache + guardrails.
- `src/embed-tableau.html` — the embed page: dynamic library injection,
  `<tableau-viz>` mount, event wiring, watchdog, auth seam.
- `src/protocol.ts` — the Zod-validated WS envelopes (see `docs/PROTOCOL.md`).
- `scripts/` + `scripts.json` — reusable eval steps (`explore`, `describe`;
  see **Reusable scripts** below for authoring your own).
- `docs/EMBEDDING_API.md` — the curated API reference. **Read it before writing
  evals.** `docs/PROTOCOL.md` — the wire contract.

## Setup

Requires [Bun](https://bun.sh). Run everything through the wrapper
`./tableau-viz.sh` (resolves bun, installs deps on first run, wires a corporate
CA if configured):

```bash
./tableau-viz.sh --help
```

Auth: **three real paths.** Tableau **Public** views need no authentication —
they just render. **Authenticated** sites (Cloud/Server) use `tableau-viz login`
(automates the embed's own SSO once with creds from `.env`, then `start` reuses
the saved session) or the reserved **connected-app token** seam (enterprise;
see `docs/EMBEDDING_API.md` → §14). Browser-cookie session reuse across origins
is **not** possible: Tableau sets its session cookie `Partitioned`, scoped to
the top-level site.

## Operation

The canonical flow — one viz, stable on screen, driven live:

```bash
# AUTHENTICATED sites (Tableau Cloud/Server) — automated path (recommended):
#   one-time login; the embed's own SSO popup is driven with creds from the
#   skill's .env and the session is saved to a dedicated Chrome profile:
#     cp .env.template .env   # then fill in TABLEAU_USERNAME/PASSWORD
./tableau-viz.sh login --url <viz-url> --script explore

# AUTHENTICATED sites — manual path (fallback; limits multi-agent fan-out):
#   the human completes the embed's own in-frame sign-in by hand. `open-site`
#   opens the Tableau origin if you want a session established there first.
./tableau-viz.sh open-site --url <viz-url>

# PUBLIC (public.tableau.com) — no auth needed; nothing to set up.

# 1. Embed the view in a tab. The bridge starts if absent; the tab opens; the
#    session id + tabUrl are printed. This ALWAYS opens a tab. After a `login`,
#    the tab opens in the login profile so the session carries.
./tableau-viz.sh start --url <viz-url> --script explore

# 2. Block until the viz is interactive. You get the instant snapshot and, if a
#    script was scheduled, its scriptResult. --meta also waits for the cache fill.
./tableau-viz.sh wait --meta

# 3. Run agent-authored JS against the live viz. stdout = data, stderr = chrome.
./tableau-viz.sh eval 'return { name: workbook.name, sheets: helpers.listSheets() }' -f json

# 4. Stop the session (or the bridge) when done.
./tableau-viz.sh stop --session <id>        # close one tab
./tableau-viz.sh stop                       # stop the bridge + all sessions
```

`viz`, `workbook`, `activeSheet`, `helpers`, and `meta` are in scope for every
eval. Prefer the helper library — it bakes in the correctness rules:

```bash
./tableau-viz.sh eval 'return helpers.listSheets()' -f json
./tableau-viz.sh eval 'return helpers.getActiveSheet()' -f json
./tableau-viz.sh eval 'return helpers.getFilters()' -f json
./tableau-viz.sh eval 'return helpers.applyCategoricalFilter("Table - Open Cases", "Region", ["APAC"], "replace")' -f json
./tableau-viz.sh eval 'return helpers.clearFilter("Table - Open Cases", "Region")' -f json
./tableau-viz.sh eval 'return helpers.getParameters()' -f json
./tableau-viz.sh eval 'return helpers.setParameter("Compare Region", "Europe")' -f json
./tableau-viz.sh eval 'return helpers.readSummary("Table - Open Cases", { maxRows: 500 })' -f json
./tableau-viz.sh eval 'return helpers.getDomainValues("Table - Open Cases", "Region")' -f json
./tableau-viz.sh eval 'return helpers.selectMarks("Open Cases", [{ fieldName: "Region", value: ["APAC"] }])' -f json
```

Longer snippets: `./tableau-viz.sh eval --file probe.js`.

## Discovering what drives a dashboard

Dashboards are interactive in **three ways**: filters, parameters, and **mark
selection** (Tableau *select* dashboard actions — a human clicks a mark and the
other worksheets filter). Filters and parameters are visible in the `wait`
snapshot; selection is a **click you replicate**, not a filter you apply:

- **`Action (<field>)` filter names are the tell.** A selection-driven
  dashboard shows filters literally named `Action (Account Title)`,
  `Action (Region)`, … on the *target* worksheets — present even with nothing
  selected (`isAllSelected: true`). They belong to the action machinery: don't
  `applyFilterAsync` them; select marks on the **source** worksheet instead.
  After a selection the same filter reads back `isAllSelected: false` with
  `appliedValues` — you can see the click in the filter state.
- **If neither filters nor parameters explain the interactivity, try selecting
  marks** — click a bar/state/account by value, then read a target sheet and
  see if it changed:

  ```bash
  ./tableau-viz.sh eval 'return helpers.selectMarks("ACCOUNTS", [{ fieldName: "Account Title", value: ["Acme Corp"] }])' -f json
  ./tableau-viz.sh eval 'return helpers.readSummary("DETAILS", { maxRows: 100 })' -f json
  ```

- **Data reads see the selection.** `readSummary` / `readUnderlying` on the
  other worksheets return the selected slice — exactly what a human sees after
  clicking — so "select, then read" is a complete data-extraction strategy.
- **Reset = clear marks.** No helper wraps it; use the raw API (and read back
  to confirm the `Action (…)` filters return to `isAllSelected: true`):

  ```bash
  ./tableau-viz.sh eval 'const ws = activeSheet.worksheets.find(w => w.name === "ACCOUNTS"); await ws.clearSelectedMarksAsync(); return (await helpers.getFilters("DETAILS")).map(f => ({ f: f.fieldName, all: f.isAllSelected }))' -f json
  ```

A dashboard's driving mechanics are onboarding knowledge a human usually hands
you ("click an account to filter everything"). Without onboarding, probe: read
`filters` + `parameters` from the snapshot, and if they don't explain the viz,
try a selection and diff a target worksheet.

## Reusable scripts

A script is a named eval body the bridge serves and runs with the **standard
eval scope** (`viz`, `workbook`, `activeSheet`, `helpers`, `meta`) — no imports,
no build step. Author once, run by name forever.

1. Create `scripts/<name>.js` — just eval JS, `return <expr>`.
2. Register it in `scripts.json`:
   `{ "name": "<name>", "description": "…", "onInteractive": false }`.
   `onInteractive: true` additionally auto-fires it on `firstinteractive` when
   scheduled with `start --script <name>`; `false` means run-on-demand only.
3. Execute: `./tableau-viz.sh run <name>` (result on stdout), or schedule at
   start with `--script <name>` (result arrives in the snapshot as
   `scriptResult`). `./tableau-viz.sh scripts` lists what's registered.

Authoring rules the hard way:

- **No parameterization.** Evals take no arguments — don't scaffold for them.
  Discover the values from the dashboard itself (read a worksheet's summary to
  enumerate the categories, then loop); the script stays zero-arg and reusable.
- **Mind the caps.** ~55s per eval, serializer depth 6 / arrays 5000. Aggregate
  in-page and `return` the distilled result, never raw rows.
- **Start from a known state.** Clear selections you're about to replace and
  leave the viz as you found it when done, so re-runs are reproducible.
- **Loop the values that exist.** Enumerate via the `"relevant"` domain and
  guard empty readers (see Correctness rules) — one empty category must not
  bust the run.

## CLI surface

Global flags: `-f/--format json|table`, `-o/--output <file>`, `-v/--verbose`,
`-s/--session <id>`, `--latest`.

```
start    --url <viz-url> [--script <name>] [--port P] [--no-open] [--lib-url U]
         ensure the bridge (probe/reclaim); create a session; open a tab; print id + tabUrl
login    --url <viz-url> [--script <name>] [--port P] [--lib-url U]
         sign in to an authenticated embed ONCE (drives the in-frame auth +
         SSO popup with creds from .env); later embed tabs reuse the session
ls       list sessions: id, url, live state, metadata status
status   [--session S]            { state, snapshot, metadata, error? }
wait     [--session S] [--timeout N] [--meta]
         block until interactive + snapshot (+ scriptResult); --meta also waits for the cache fill
meta     [--session S] [--worksheet W] [--wait]
         thin internal eval: return meta / meta.worksheets[W]; --wait blocks until filled
eval     '<js>' [--session S] [--file <path>]    run arbitrary JS; fail-fast on dead/unknown session
run      <script-name> [--session S]             execute a reusable script by name
scripts                                       list reusable scripts (name, description, onInteractive)
open-site [--url <viz-url>]                   open the Tableau origin to establish a browser session
stop     [--session S | --port P]              close a session, reclaim an orphan bridge, or stop the bridge
```

`--session` defaults to the only session; with several, `--session`/`--latest`
is required. Sessions persist in `temp/sessions.json`; the bridge holds live
state.

## Multi-session & fan-out

One bridge daemon per port; N tabs (sessions) share it. `start` reuses a running
bridge and always opens a fresh tab. Multiple sub-agents on the same machine
share the server and each drive their own session:

```bash
# sub-agent A
./tableau-viz.sh start --url <viz-url-A> --script explore
# sub-agent B
./tableau-viz.sh start --url <viz-url-B> --script explore
./tableau-viz.sh ls                      # both, with live states
./tableau-viz.sh eval 'return helpers.listSheets()' --session <A-id>
```

## Correctness rules (agents get these wrong otherwise)

These are enforced by the helpers; if you write raw API calls, apply them
yourself. Full detail in `docs/EMBEDDING_API.md`.

- **Names/values are getter-backed properties, not methods.** `workbook.name`,
  `sheet.name`, `filter.fieldName`, `column.fieldName`. `getName()` does not exist.
- **Enum literals are per-API and not interchangeable.** Filters
  `"replace"|"add"|"remove"|"all"`; mark selection `"select-replace"|"select-add"|"select-remove"`;
  filter domain `"relevant"|"database"`. Pass raw strings.
- **Tableau silently no-ops invalid mutations.** Never treat "no exception" as
  success — read state back (the helpers do). Discover valid categorical values
  with `helpers.getDomainValues` / `filter.getDomainAsync("relevant")`.
- **Release data readers** in a `finally`; readers returned from an eval are
  auto-released by the serializer. `getSummaryDataAsync()` is deprecated — use
  `getSummaryDataReaderAsync()`.
- **Use the `"relevant"` domain by default.** `helpers.getDomainValues` /
  `getDomainAsync("relevant")` returns only values actually present in the
  current view. This controls for filter/time-frame state: values with no rows
  in the selected period (a country with no data this quarter) and stale
  data-source aliases (a legacy `"USA"` next to `"United States"`) are excluded
  automatically. The `"database"` domain can hand you those values — querying
  them yields empty results and confusing rows. Applies to ad hoc evals *and*
  reusable scripts (loop the relevant domain, not the database domain).
- **Guard empty readers.** A worksheet with no rows under the current filter
  state yields a reader with `pageCount === 0`; paging it throws
  `invalid-parameter: 0 is invalid value for range: [0..0)`. Check
  `reader.pageCount` before paging and treat zero rows as empty data, not an
  error (`helpers.readSummary` handles this). Scripts that loop over values must
  survive one value having no data.
- **`viz.workbook` throws until `firstinteractive`** — keep the lazy-getter
  pattern so DOM-only diagnostics work while loading. `wait` before evals that
  touch the workbook.
- **Evals cap at ~55s in-page**; a non-resolving call returns a normal `error`
  and the loop stays alive (the bridge did not crash).
- **Read `meta`, don't block on it.** The cache fills in the background; the
  most common first command (a filter) is a *dynamic* call that doesn't depend
  on it.

## Safety

- The bridge binds `127.0.0.1` only and requires a per-bridge token on every
  WebSocket. It is an ephemeral, local, single-user tool that dies with the
  process/tab. **Never expose the port publicly.**
- Arbitrary agent-authored JS runs in a page authenticated to Tableau via the
  user's session — by design (same trust model as a browser devtools console):
  the code author is the user's own agent, on the user's machine.
- Guardrails: the serializer caps depth (6) and array length (5000); use
  `maxRows` on `readSummary`/`readUnderlying` and always release readers.
- Script names served by the bridge are validated against `scripts.json`
  (no path traversal).

## Troubleshooting

- **"session has no connected tab — tab closed?"** → the tab's WebSocket closed;
  evals fail fast by design. Reopen with `start --url <url>` (or reuse another
  session via `--session`).
- **"viz still loading — run 'tableau-viz wait'"** → the eval ran before
  `firstinteractive`. `wait` first.
- **Watchdog timeout / auth failure** → the viz neither loaded nor errored in
  30s, or it redirected to Tableau's in-frame sign-in. For **Public**, public
  views need no session (hidden views: `open-site` to log in). For
  **authenticated Cloud/Server**, the session cookie is `Partitioned` and
  cannot be reused from another origin — run `login --url <url>` once (creds
  from `.env`) so the embed's own SSO flow populates the login profile;
  `start` then reuses it.
- **`eval exceeded 55000ms and was abandoned`** → a Tableau async call never
  resolved. The bridge is alive; retry with a bounded call.
- **Bridge started by one command, orphaned by a crash** → `stop --port <port>`
  reclaims it (probe/401 signature finds it, `lsof` resolves the pid).
- **`…does not look like a Tableau view URL (expected a /views/... path)`** →
  you passed a profile URL (`/app/profile/<user>/viz/<Workbook>`). Use the
  view URL: `https://<host>/views/<Workbook>/<Sheet>`.