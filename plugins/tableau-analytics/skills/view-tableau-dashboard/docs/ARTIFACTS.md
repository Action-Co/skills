# Serving Artifacts — ARTIFACTS.md

How to hand an agent-produced file (an HTML report, an exported JSON) to the
human, on the same localhost origin and browser as the viz tabs.

## The mechanism

- Write the file to `temp/artifacts/` under the skill directory.
- The bridge serves it at `http://127.0.0.1:<port>/artifacts/<name>`.
  Content-type is inferred from the file extension.
- **Safe names only:** single-segment, matching `[a-zA-Z0-9][a-zA-Z0-9._-]*` —
  no slashes, so no path traversal. Dotted names (`.env`) are rejected.
- Open it with:

```bash
./tableau-viz.sh open-artifact report.html
```

`open-artifact` opens the URL in the **same Chrome-first browser** as the viz
tabs (falling back to the OS default), so the demo finals live on the same
localhost origin and browser as the viz tabs — the human does not jump between
two browsers.

## Writing an artifact-producing eval

Artifacts are produced by an eval (see `docs/JS_EVALS.md` for the full eval
authoring guide) and written to disk by the CLI (`-o <file>`), or by a script
that returns the distilled result:

```bash
./tableau-viz.sh eval 'return helpers.readVizData("Table", { maxRows: 500 })' \
  --intent "Reading summary data for the report" -f json -o temp/artifacts/table.json
```

Authoring rules for artifact evals:

- Evals take **no arguments** — discover values from the dashboard and loop.
- Start from a **known state** and **leave the viz as you found it** (clear
  filters/selections when done) so re-runs are reproducible.
- Loop the `"relevant"` domain and **survive empty readers** (a zero-row
  worksheet is empty data, not an error).
- **Aggregate in-page** and return the distilled result — never raw rows —
  and mind the serializer caps (depth 6, arrays 5000) and the ~55s in-page
  eval budget.

For the report HTML itself, write the file and `open-artifact` it; the
bridge does not transform your content.