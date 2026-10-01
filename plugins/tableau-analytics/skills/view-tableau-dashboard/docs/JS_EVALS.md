# Writing Evals — JS_EVALS

How to author the JavaScript you run against a live Tableau view. The eval is the primitive
of `view-tableau-dashboard`: every interaction — filter, parameter, mark selection, data
read — is a small JS program you write and send with `tableau-viz eval '…' --intent "…"`.

## Eval scope

Every eval runs in an async IIFE with these symbols in scope. No imports, no build step.
Write `return <expr>`; the executor awaits it and safe-serializes the result.

| Symbol | Meaning |
| --- | --- |
| `viz` | the `<tableau-viz>` element (the live viz). |
| `workbook` | `viz.workbook` — **lazy getter**; throws until `firstinteractive`. |
| `activeSheet` | `workbook.activeSheet` — lazy getter, same rule. |
| `helpers` | the in-page helper library (§ Helpers). |
| `meta` | the background metadata cache — plain object, reads instantly. |

Serializer caps: depth 6, arrays 5000, functions dropped, readers auto-released.

## Helpers

Prefer the helper library — it bakes in the correctness rules (read-back after mutation,
reader release, relevant domain). Names/values are getter-backed **properties**, not
methods (`workbook.name`, `filter.fieldName`, `column.fieldName` — `getName()` does not
exist).

| Helper | Purpose |
| --- | --- |
| `helpers.listSheets()` | workbook sheet list |
| `helpers.getActiveSheet()` | the active sheet |
| `helpers.getFilters(ws?)` | current filters (optionally one worksheet) |
| `helpers.applyCategoricalFilter(ws, field, values, updateType)` | categorical filter; `"replace"\|"add"\|"remove"\|"all"` |
| `helpers.applyRangeFilter(ws, field, options)` | range filter |
| `helpers.clearFilter(ws, field)` | clear a filter |
| `helpers.getParameters()` | current parameters + values |
| `helpers.setParameter(name, value)` | set a parameter |
| `helpers.readVizData(ws, { maxRows })` | summary data (keyed rows, handles empty readers) |
| `helpers.readUnderlyingData(ws, { maxRows })` | underlying data reader |
| `helpers.getDomainValues(ws, field)` | filter domain values (`"relevant"` by default) |
| `helpers.selectMarks(ws, criteria, updateType?)` | mark selection; `"select-replace"\|"select-add"\|"select-remove"` |
| `helpers.activateSheet(name)` | activate a worksheet/dashboard |
| `helpers.getVisualSpec(ws)` | visual specification |
| `helpers.getDataSources(ws)` | data sources — **flagged**: may impact viz performance; call only when needed |

`meta` (the background metadata cache) exposes `meta.worksheets[<name>].columns` and
`.visualSpec` once loaded — read it instead of calling `getSummaryColumnsInfoAsync`
yourself. `meta.ready()`/`meta.load()` fill on demand. The cache is **static**; it never
holds filter state, domains, or data — those are always read live.

## Correctness rules

Agents get these wrong otherwise. The helpers enforce most of them; if you write raw API
calls, apply them yourself.

- **Every `eval`/`run` carries `--intent <text>`.** Required flag — a short
  human-readable description of what the code does. The CLI fails fast without it, and the
  text appears as a notification on the viz page so a human in the loop always sees agent
  activity.
- **Names/values are getter-backed properties, not methods.** `workbook.name`,
  `sheet.name`, `filter.fieldName`, `column.fieldName`. `getName()` does not exist.
- **Enum literals are per-API and not interchangeable.** Filters
  `"replace"|"add"|"remove"|"all"`; mark selection
  `"select-replace"|"select-add"|"select-remove"`; filter domain `"relevant"|"database"`.
  Pass raw strings.
- **Tableau silently no-ops invalid mutations.** Never treat "no exception" as success —
  read state back (the helpers do). Discover valid categorical values with
  `helpers.getDomainValues` / `filter.getDomainAsync("relevant")`.
- **Release data readers** in a `finally`; readers returned from an eval are auto-released
  by the serializer. `getSummaryDataAsync()` is deprecated — use
  `getSummaryDataReaderAsync()`.
- **Use the `"relevant"` domain by default.** `helpers.getDomainValues` /
  `getDomainAsync("relevant")` returns only values actually present in the current view —
  controls for filter/time-frame state and stale data-source aliases automatically. The
  `"database"` domain can hand you values with no rows in the current view; querying them
  yields empty results.
- **Guard empty readers.** A worksheet with no rows under the current filter state yields a
  reader with `pageCount === 0`; paging it throws `invalid-parameter: 0 is invalid value
  for range: [0..0)`. Check `reader.pageCount` before paging and treat zero rows as empty
  data, not an error (`helpers.readVizData` handles this). Loops over values must survive
  one value having no data (e.g. `%null%` in a domain).
- **`viz.workbook` throws until `firstinteractive`** — keep the lazy-getter pattern so
  DOM-only diagnostics work while loading. `wait` before evals that touch the workbook.
- **Evals cap at ~55s in-page**; a non-resolving call returns a normal `error` and the loop
  stays alive (the bridge did not crash).
- **Read `meta`, don't block on it.** The cache fills in the background; the most common
  first command (a filter) is a *dynamic* call that doesn't depend on it.

## Patterns

- **Batch, don't chatter.** One eval per logical step. Loop dynamic values in-page instead
  of one round-trip per value. If a task fits in 3 evals, don't do it in 30.
- **Read by column name, never position.** KPI cards are often Measure Names / Measure
  Values tables — one row per measure. Read `rows[0]["SUM(Expected Amount)"]`, never
  `rows[0]` alone.
- **Loop the `"relevant"` domain.** Enumerate the values that actually exist in the current
  view, then apply/read/clear per value. Leave the viz as you found it so re-runs are
  reproducible.
- **Aggregate in-page.** `return` the distilled result (a summary object), never raw rows.
  Mind the serializer caps and the 55s eval budget.
- **Size the eval before you run it.** A long filter loop + a large underlying read can
  exceed the in-page cap. Measure once, then bound the work.

See `docs/EMBEDDING_API.md` for the full API surface these helpers wrap.