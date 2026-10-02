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
entry carries `kind: "workflow"` plus a `steps` array — one step per dashboard,
each with a `name`, `label`, the view `url`, and the eval `script` to schedule
on it. `run <name>` starts a session for every step up front (tabs load in
parallel), waits for all `scriptResult`s concurrently (failures become inline
error boxes, never a dead run), and hands the collected results to the CLI's
report renderer (`src/executive-report.ts`, keyed by step `name`), which writes
an HTML report to `temp/artifacts/` and opens it. Sessions are left open so the
human can watch the dashboards and reopen the report.

```json
{
  "name": "daily-executive-summary",
  "description": "Executive report across the eight Superstore dashboards…",
  "kind": "workflow",
  "steps": [
    { "name": "overview", "label": "Overview — state & margin ranking",
      "url": "https://public.tableau.com/views/…/Overview",
      "script": "overview-state-ranking" }
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