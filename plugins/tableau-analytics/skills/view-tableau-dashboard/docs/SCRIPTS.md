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

## Guardrails

- Script names served by the bridge (`/scripts/<name>.js`) are validated
  against `scripts.json`; unknown names 404, and the pattern permits
  `[a-zA-Z0-9_-]` only.
- Scripts run with the exact same scope and caps as any eval — see
  `docs/JS_EVALS.md` for the authoring rules and `docs/EMBEDDING_API.md` for
  the API surface.