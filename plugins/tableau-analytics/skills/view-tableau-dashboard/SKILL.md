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

**0. Start with the semantic model — always.** `tableau-semantics` owns the
governed model for this workbook/view (`<site>/workbooks/<Workbook>/<Workbook>.<View>.md` + `.derived.json`).
**When a model exists, reading it first is mandatory:** it answers the static
questions (meaning, sheets, KPIs, filters, parameters, driving mechanics, gotchas),
so you spend evals only on *dynamic* values — current filter state, domains, and the
numbers — instead of rediscovering the dashboard. Match by `asset.url` /
`structure.sheets[].url`, or the host-free `asset.urlSlug`.

**No model? Bootstrap one before you act** — run `tableau-semantics` →
`docs/BOOTSTRAP.md` (derive, draft the behavioral `.md` from live observation, then
**confirm with the user**). Infer the dashboard when the user can't describe it, but
don't silently trust an unconfirmed model.

**1. Embed the view in a tab.**

```bash
./tableau-viz.sh start --url <viz-url> --script explore
```

Public views (`public.tableau.com`) need no auth. Authenticated Cloud/Server views: the
human signs in to the embed's own in-frame auth once (or the site provides a connected-app
token). `start` always opens a tab and prints the session id + tabUrl.

> Note: **Viz URL format:** the CLI normalizes any Tableau view URL to the canonical embed path
> (`https://<host>/t/<site>/views/<Workbook>/<View>`, or `/views/...` on Public) — browser
> address-bar URLs (`#/site/<site>/views/...`) work too. Multi-word sheet names are
> **slugified** in the URL (spaces removed: "What If Forecast" → `WhatIfForecast`), so to
> address a specific sheet read its `url` field from the snapshot (`helpers.listSheets()`),
> never construct the view name from the display name.

**2. Block until the viz is interactive.**

```bash
./tableau-viz.sh wait
```

You get the instant snapshot (workbook, sheets, filters, parameters) and, if a script was
scheduled, its result. This confirms you are on the right viz before you act.

**Auth-aware loading:** when a Cloud/Server view needs sign-in, the embed reveals Tableau's
in-frame login and the session reports an `auth` state. `wait` treats `auth` as non-terminal — it keeps
waiting while the human signs in instead of erroring — and resumes once the viz is interactive. 
The 30s watchdog only applies while the viz is actually loading, never while waiting on sign-in.

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

Requires [Bun](https://bun.sh); run everything through `./tableau-viz.sh` (installs deps on first run, wires a corporate CA if configured).

- **Tableau Public** — no auth; nothing to set up.
- **Authenticated Cloud/Server** — a human completes Tableau's in-frame sign-in once in
  the tab (or the site provides a connected-app token); `wait` tolerates the `auth` state.
- **Browser** — `start` prefers **Chrome** (macOS), which authenticated embeds need:
  Tableau's in-frame sign-in opens an SSO popup that Safari blocks for cross-origin iframes.

Browser quirks, SSO/cross-origin-iframe failures, and CA/TLS fixes: [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Human alignment

The viz renders in a real browser tab on the user's machine — they watch you drive it.
Every `eval`/`run` requires `--intent <text>` so the user always sees why you are doing
what you are doing. Read-only commands (`meta`, `summary`, `describe`, `filter`) and
scheduled scripts toast automatically. There is no headless mode: a tab must be open for
the viz to be accessible (`start --no-open` only skips auto-opening the browser).

Sometimes you need the user, not just their attention: they must log in, confirm
something on the dashboard before you act, or you are auth-confirmed and fanning out
sub-agents who each need a nudge. `say` posts a one-way agent→human message as a toast
labeled **"Agent message"** on the session's tab — no eval, no `--intent`, works even
while the session sits in `auth` waiting on sign-in.

```bash
./tableau-viz.sh say 'Please log in — I will continue once you are signed in.'
./tableau-viz.sh say 'Confirm the Regional split is correct before I proceed' --hold
```

Default auto-dismisses after ~4s; `--hold` keeps the toast until the user dismisses it
(use it for anything you actually need them to act on).

## Discovering what drives a dashboard

Dashboards are interactive three ways: filters, parameters, and **mark selection**
(a human clicks a mark and other worksheets filter). Filters and parameters appear in the
`wait` snapshot; selection is a click you replicate, not a filter you apply. **You will
need to work out how a given dashboard drives itself** — especially with no semantic
model, since the model is where this is normally recorded; with a model, most of it is there.

The tell is `Action (<field>)` filters on the *target* worksheets: drive the **source**
worksheet with `helpers.selectMarks(...)` (never `applyFilterAsync`), read the others,
then reset with `clearSelectedMarksAsync()`. Mechanics: [`docs/EMBEDDING_API.md`](docs/EMBEDDING_API.md) §12.

## Reusable scripts

Author a named eval body once, run it by name forever (`scripts/<name>.js` +
`scripts.json`, then `run <name>` or `start --script <name>`). **Read
[`docs/SCRIPTS.md`](docs/SCRIPTS.md) before authoring or registering one** — the
eval-body contract, the `onInteractive` flag, and the `kind: "workflow"` shape.

**Shipped demo scripts** — one named script per Superstore view (all Tableau Public,
no auth), each self-contained and restoring the viz to its starting state:

| Script | View | Question it answers |
| ------ | ---- | ------------------- |
| `overview-state-ranking` | Overview | Top/bottom states by profit ratio and sales + headline KPIs |
| `product-peak-months` | Product | Peak/trough sales month per region × category |
| `customers-top3` | Customers | Top 3 customers per category × segment |
| `shipping-delays` | Shipping | Worst-delay order line per ship mode (full history) |
| `performance-outliers` | Performance | Biggest overshoot/shortfall vs target per year |
| `commission-plan` | Commission Model | OTE + top earner at 6/9/12%; quota attainment at $400k/$500k/$600k |

Run the workflow: `./tableau-viz.sh run daily-executive-summary --intent "..."` — opens all six views, collects each result, and renders one HTML report to `artifacts/` (`open-artifact` reopens it).

## Serving artifacts (HTML reports, exports)

Agent-produced reports/exports live in `artifacts/` (gitignored — the end user decides
what to keep); open them with `open-artifact` — guide: [`docs/ARTIFACTS.md`](docs/ARTIFACTS.md).

## CLI surface

Full command surface, global flags, and defaults: `./tableau-viz.sh --help`.

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

Agent-authored JS runs in a page authenticated to Tableau via the user's session — the
same trust model as a browser devtools console. Full security model:
[`docs/SECURITY.md`](docs/SECURITY.md).

## Docs

- `docs/JS_EVALS.md` — how to author evals: eval scope, helper library, correctness rules, patterns.
- `docs/EMBEDDING_API.md` — the curated Embedding API v3 reference (object tree, call shapes).
- `docs/SCRIPTS.md` — authoring + registering reusable scripts.
- `docs/ARTIFACTS.md` — serving reports/exports to the browser.
- `docs/SECURITY.md` — trust model + guardrails.
- `docs/ARCHITECTURE.md` — systems diagram + file-by-file intent map.
- `docs/TROUBLESHOOTING.md` — failure modes and fixes.
- `docs/PROTOCOL.md` — the WebSocket wire contract.
