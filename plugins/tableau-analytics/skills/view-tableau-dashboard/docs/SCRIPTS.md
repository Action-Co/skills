# Reusable Scripts — SCRIPTS.md

A script is a **named eval body** the bridge serves and runs with the standard
eval scope — no imports, no build step. Author once, run by name forever.

## Authoring

1. Create `scripts/<name>.js` — just eval JS, `return <expr>`:
   ```js
   // scripts/explore.js
   return meta;
   ```
2. Register it in `scripts.json`:
   ```json
   { "name": "explore", "description": "Return the background metadata cache", "onInteractive": true }
   ```
   - `onInteractive: true` auto-fires the script on `firstinteractive` when
     scheduled with `start --script <name>`.
   - `onInteractive: false` (default) keeps it manual.

## Running

- Manual: `./tableau-viz.sh run <name> --intent "Running <name>"` — requires
  `--intent`, like every eval.
- Scheduled at start: `./tableau-viz.sh start --url <url> --script <name>` —
  the result arrives as `scriptResult` in the `wait` snapshot.
- List what's registered: `./tableau-viz.sh scripts`.

## Workflows (multi-dashboard scripts)

A script can coordinate several dashboards in one run when its `scripts.json`
entry carries `kind: "workflow"` plus a `steps` array — one step per dashboard.
`run <name>` opens a session per step up front (tabs load in parallel), waits for
all of them concurrently (a failed step becomes an inline error box, never a dead
run), retries each failed step once, renders one HTML report to `artifacts/`, and
opens it. Sessions are left open so the human can watch the dashboards and reopen
the report.

**Step fields:**

| Field | Meaning |
| ----- | ------- |
| `name` | stable step key — also selects the report renderer (below) |
| `label` | human title for the report card |
| `url` | the view URL to embed |
| `script` | one eval script to run on the step |
| `scripts` | alternative to `script`: a list of `{ "name", "batches"? }` fragments |

**Fragments.** A step may run several scripts. `"batches": N` re-runs that script
N times with a `const __BATCH__ = <i>` injected, so a long read can be sliced
across runs. Fragments merge with `mergeFragments`: array values concatenate,
scalar values take the first non-undefined entry.

**The report renderer.** `run` hands the results to `src/executive-report.ts`,
which renders one card per step. Each step's `name` **must have a matching entry
in that file's `RENDERERS` map** — an unknown step name renders a
`no renderer for step '<name>'` card. So a workflow over *new* dashboards is a
two-part change: define the steps in `scripts.json`, and add a `RENDERERS` entry
(plus an `ACCENTS` color) per new dashboard in `src/executive-report.ts`. The
report filename is fixed (`daily-executive-summary.html`) — one report at a time.

```json
{
  "name": "daily-executive-summary",
  "description": "Executive report across the six Superstore dashboards…",
  "kind": "workflow",
  "steps": [
    { "name": "overview", "label": "Overview — state & margin ranking",
      "url": "https://public.tableau.com/views/…/Overview",
      "script": "overview-state-ranking" },
    { "name": "customers", "label": "Customers — top accounts",
      "url": "https://public.tableau.com/views/…/Customers",
      "scripts": [ { "name": "customers-top3" }, { "name": "customers-detail", "batches": 3 } ] }
  ]
}
```

Workflows are run-only (`run <name>`) — they are not eval bodies, so they cannot
be scheduled with `start --script <name>`.

## Guardrails

- Script names served by the bridge (`/scripts/<name>.js`) are validated
  against `scripts.json`; unknown names 404, and the pattern permits
  `[a-zA-Z0-9_-]` only.
- Scripts run with the exact same scope and caps as any eval — see
  `docs/JS_EVALS.md` for the authoring rules and `docs/EMBEDDING_API.md` for
  the API surface.