---
name: view-tableau-dashboard
description: Use this skill to interact with live Tableau dashboards and views to retrieve trusted data from the visual interfaces that human users rely on for decision-making. It allows reading and applying filters, getting and setting parameters, retrieving data, and selecting marks programmatically by evaluating agent-generated JavaScript in a browser tab with the Tableau Embedding API. Do not use this for querying Tableau data sources (use query-tableau-data instead).
license: Apache-2.0
metadata:
  authors: "ip-agent-skills@action.co"
  version: "0.1.0"
  tags: ["tableau", "data", "analytics", "visualization", "chart"]
---

# View Tableau Dashboard

A CLI-to-browser bridge: `tableau-viz` embeds a Tableau view in a browser tab and evaluates
agent-authored JavaScript against the live viz via the Embedding API v3. You drive the
dashboard the way a human would — filters, parameters, mark selection, data reads — and the
values you read are live, from the same canonical views humans use for decisions.

## Canonical workflow

Do this in order. Do not re-explore what the semantic model already tells you.

**0. Read the semantic model first.** If a model exists for this workbook
(`tableau-semantics` → `site/workbooks/<name>.md` + `.derived.json`), read it before
touching the viz. It already answers the static questions: what the dashboard means, its
sheets and KPIs, its filters, parameters, driving mechanics, and gotchas. Pull **only
dynamic values** live — current filter state, filter domains, and the actual numbers. Do
not duplicate model discovery in the viz.

**1. Embed the view in a tab.**

```bash
./tableau-viz.sh start --url <viz-url> --script explore
```

Public views (`public.tableau.com`) need no auth. Authenticated Cloud/Server views: the
human signs in to the embed's own in-frame auth once (or the site provides a connected-app
token). `start` always opens a tab and prints the session id + tabUrl.

**2. Block until the viz is interactive.**

```bash
./tableau-viz.sh wait
```

You get the instant snapshot (workbook, sheets, filters, parameters) and, if a script was
scheduled, its result. This confirms you are on the right viz before you act.

**3. Drive the viz with evals.** `viz`, `workbook`, `activeSheet`, `helpers`, and `meta`
are in scope for every eval. Every eval/run REQUIRES `--intent <text>` — a short
human-readable description of what the code does, shown as a notification on the viz page.

```bash
./tableau-viz.sh eval 'return helpers.listSheets()' --intent "Reading the sheet list" -f json
./tableau-viz.sh eval 'return helpers.getFilters()' --intent "Reading current filters" -f json
./tableau-viz.sh eval 'return helpers.applyCategoricalFilter("Table", "Region", ["APAC"], "replace")' --intent "Filtering Region to APAC" -f json
./tableau-viz.sh eval 'return helpers.readVizData("Table", { maxRows: 500 })' --intent "Reading summary data" -f json
```

**Batch your evals.** One eval per logical step; loop dynamic values in-page (e.g. a
country domain) instead of one round-trip per value. Get the job done in as few evals as
possible — do not "peek" at things you can read from the semantic model or the snapshot.

**4. Keep the session open for the conversation; stop when the work is done.**

The bridge keeps a live tab alive indefinitely (heartbeat ping/pong every 15s),
so a session does not time out between turns — keep it open across a dialogue
with the user. Stop only when the work is truly finished: end of an automation
run, or the human is done. Do not stop/start per turn.

```bash
./tableau-viz.sh stop --session <id>   # close one tab
./tableau-viz.sh stop                  # stop the bridge + all sessions
```

Run `./tableau-viz.sh --help` for the full command surface.

## Setup & auth

Requires [Bun](https://bun.sh); run everything through `./tableau-viz.sh` (installs deps on
first run, wires a corporate CA if configured).

- **Tableau Public** — no auth; nothing to set up.
- **Authenticated Cloud/Server** — the embed shows Tableau's in-frame sign-in; a human
  completes it once in the tab (or the site provides a connected-app token). The session
  cookie is `Partitioned` and cannot be reused across origins, so the sign-in happens in
  the embed's own tab.

## Human alignment

The viz renders in a real browser tab on the user's machine — they watch you drive it.
Every `eval`/`run` requires `--intent <text>` so the user always sees why you are doing
what you are doing. Read-only commands (`meta`, `summary`, `describe`, `filter`) and
scheduled scripts toast automatically. There is no headless mode: a tab must be open for
the viz to be accessible (`start --no-open` only skips auto-opening the browser).

## Discovering what drives a dashboard

Dashboards are interactive in **three ways**: filters, parameters, and **mark selection**
(select dashboard actions — a human clicks a mark and other worksheets filter). Filters and
parameters appear in the `wait` snapshot; selection is a click you replicate, not a filter
you apply.

- **`Action (<field>)` filters are the tell.** A selection-driven dashboard shows filters
  literally named `Action (Region)`, … on the *target* worksheets, present even with
  nothing selected (`isAllSelected: true`). Don't `applyFilterAsync` them; select marks on
  the **source** worksheet instead. After a selection they read back
  `isAllSelected: false` with `appliedValues`.
- **Select, then read.** `helpers.selectMarks("ACCOUNTS", [{ fieldName: "Account Title", value: ["Acme Corp"] }])`
  clicks the mark; `readVizData` on other worksheets then returns the selected slice —
  exactly what a human sees after clicking. A complete data-extraction strategy.
- **Reset = clear marks.** `ws.clearSelectedMarksAsync()`; read back to confirm the
  `Action (…)` filters return to `isAllSelected: true`.

The semantic model records these mechanics when they exist. Trust it for onboarding; probe
only when no model exists.

## Reusable scripts

A script is a named eval body the bridge serves and runs with the standard eval scope —
no imports, no build step. Author once, run by name forever.

1. Create `scripts/<name>.js` — just eval JS, `return <expr>`.
2. Register it in `scripts.json`:
   `{ "name": "<name>", "description": "…", "onInteractive": false }`.
   `onInteractive: true` auto-fires it on `firstinteractive` when scheduled with
   `start --script <name>`.
3. Run: `./tableau-viz.sh run <name> --intent "Running <name>"`, or schedule at start with
   `--script <name>` (the result arrives as `scriptResult` in the snapshot).
   `./tableau-viz.sh scripts` lists what's registered.

Authoring rules: evals take no arguments — discover values from the dashboard and loop;
start from a known state and leave the viz as you found it; loop the `"relevant"` domain
and survive empty readers; aggregate in-page and return the distilled result, never raw
rows. Full detail in `docs/JS_EVALS.md`.

## CLI surface

Global flags: `-f/--format json|table`, `-o/--output <file>`, `-v/--verbose`,
`-s/--session <id>`, `--latest`.

```
start    --url <viz-url> [--script <name>] [--port P] [--no-open] [--width W] [--height H]
         embed the view in a tab (bridge auto-starts); prints session id + tabUrl
wait     [--session S] [--timeout N] [--meta]   block until interactive + snapshot (+ metadata fill)
eval     '<js>' [--file <path>] --intent <text>  run JS against the live viz; --intent REQUIRED
run      <script-name> --intent <text>           execute a reusable script by name
ls / status / meta / summary / describe / filter   session & metadata introspection
scripts  list reusable scripts (name, description, onInteractive)
open-site [--url <viz-url>]                      open the Tableau origin (establish a browser session)
stop     [--session S | --port P]                close a session, reclaim an orphan bridge, or stop the bridge
```

`--session` defaults to the only session; with several, `--session`/`--latest` is required.
Sessions persist in `temp/sessions.json`; the bridge holds live state. Full flag detail:
`./tableau-viz.sh --help`.

## Multi-session & fan-out

One bridge daemon per port; N tabs (sessions) share it. `start` reuses a running bridge
and always opens a fresh tab, so multiple sub-agents can each drive their own session:

```bash
./tableau-viz.sh start --url <viz-url-A> --script explore   # sub-agent A
./tableau-viz.sh start --url <viz-url-B> --script explore   # sub-agent B
./tableau-viz.sh ls
./tableau-viz.sh eval 'return helpers.listSheets()' --intent "Reading the sheet list" --session <A-id>
```

## Safety

- The bridge binds `127.0.0.1` only and requires a per-bridge token on every WebSocket. It
  is an ephemeral, local, single-user tool. **Never expose the port publicly.**
- Arbitrary agent-authored JS runs in a page authenticated to Tableau via the user's
  session — the same trust model as a browser devtools console.
- Guardrails: the serializer caps depth (6) and array length (5000); use `maxRows` on data
  reads and always release readers; script names served by the bridge are validated
  against `scripts.json`.

## Docs

- `docs/JS_EVALS.md` — how to author evals: eval scope, helper library, correctness rules, patterns.
- `docs/EMBEDDING_API.md` — the curated Embedding API v3 reference (object tree, call shapes).
- `docs/ARCHITECTURE.md` — systems diagram + file-by-file intent map.
- `docs/TROUBLESHOOTING.md` — failure modes and fixes.
- `docs/PROTOCOL.md` — the WebSocket wire contract.
