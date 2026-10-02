# Embedding API v3 — Curated Reference

The distilled subset of the Tableau Embedding API v3 that `view-tableau-dashboard`
teaches. It covers the object tree, correct call shapes, the correctness rules
(read-back after mutation, reader release, per-API enum literals), the `meta`
cache, and the helper library. For exhaustive coverage see the
`tableau-embedding-api` reference skill.

Every eval runs inside an async IIFE with **`viz`, `workbook`, `activeSheet`,
`helpers`, and `meta` in scope**. Write `return <expr>`; the executor awaits it
and runs the value through the safe serializer. You do not import anything and
you do not hand-serialize.

---

## 1. Eval scope

| Symbol | Meaning |
| --- | --- |
| `viz` | the `<tableau-viz>` element (the live viz). |
| `workbook` | `viz.workbook` — **lazy getter**; throws until `firstinteractive`. |
| `activeSheet` | `workbook.activeSheet` — lazy getter, same rule. |
| `helpers` | the in-page helper library (§10). |
| `meta` | the background metadata cache (§11) — plain object, reads instantly. |

`return <expr>`; the executor `await`s the async IIFE and safe-serializes the
result (depth cap 6, array cap 5000, functions dropped, readers auto-released).

```js
return { name: workbook.name, sheets: workbook.publishedSheetsInfo.map(s => ({ name: s.name, type: s.sheetType })) }
return helpers.listSheets()
```

## 2. Object tree

```text
viz (the <tableau-viz> element)
└── workbook                         viz.workbook (lazy: throws pre-interactive)
    ├── name                         string  (property — NOT getName())
    ├── activeSheet                  the currently active Sheet
    ├── publishedSheetsInfo          SheetInfo[]  (synchronous)
    ├── getParametersAsync()         Parameter[]
    └── activateSheetAsync(name|index) -> Sheet

Sheet (activeSheet is one of these)
├── name / sheetType                 "dashboard" | "worksheet" | "story"
├── worksheets                       Worksheet[]  (dashboards only)
├── objects                          DashboardObject[]  (dashboards only)
└── getFiltersAsync()                Filter[]  (dashboard + worksheet)

Worksheet (a dashboard's contained sheet, or the active worksheet)
├── getFiltersAsync / applyFilterAsync / applyRangeFilterAsync / clearFilterAsync
├── getSummaryColumnsInfoAsync()     Column[] in VIEW order
├── getSummaryDataReaderAsync()      DataTableReader (NOT getSummaryDataAsync — deprecated)
├── getVisualSpecificationAsync()    VisualSpecification
├── getUnderlyingTablesAsync()       LogicalTable[]  (Explorer/Creator role)
├── selectMarksByValueAsync / getSelectedMarksAsync / clearSelectedMarksAsync
└── getDataSourcesAsync()            DataSource[]  (⚠ see §13)
```

- `sheetType` is the discriminant. Filters, marks, and data reads happen on a
  **worksheet**, so on a dashboard you must pick one of
  `activeSheet.worksheets` by name.
- `publishedSheetsInfo` entries are `{ name, index, sheetType, isActive,
  isHidden, url, size }`. Use `helpers.listSheets()` for the trimmed shape.
- Dashboard `objects` are `{ name, type, worksheet?, isFloating, isVisible,
  position:{x,y}, size:{width,height}, id }`.

## 3. Properties, not methods

Names and values are **getter-backed properties**:

| Correct (property) | Wrong (does not exist) |
| --- | --- |
| `workbook.name` | `workbook.getName()` |
| `sheet.name` | `sheet.getName()` |
| `filter.fieldName` | `filter.getFieldName()` |
| `column.fieldName` | `column.getFieldName()` |
| `parameter.name`, `parameter.currentValue` | `parameter.getName()` |

The `*Async()` methods (`getFiltersAsync`, `applyFilterAsync`,
`getSummaryDataReaderAsync`, `changeParameterValueAsync`, …) **are** methods and
must be `await`-ed.

## 4. Enum literals are per-API and NOT interchangeable

The eval scope has **no** API enum bindings — pass the **raw string literal**
(accepted since Tableau 2021.4):

| API family | Method | Enum | Valid string literals |
| --- | --- | --- | --- |
| Filters | `applyFilterAsync` | `FilterUpdateType` | `"replace"`, `"add"`, `"remove"`, `"all"` |
| Mark selection | `selectMarksByValueAsync` | `SelectionUpdateType` | `"select-replace"`, `"select-add"`, `"select-remove"` |
| Filter domain | `getDomainAsync` | `FilterDomainType` | `"relevant"`, `"database"` |

Passing `"replace"` to `selectMarksByValueAsync` throws
`invalid-parameter: replace is invalid value for enum: SelectionUpdateType`.

## 5. Filters

```js
const ws = activeSheet.worksheets.find(w => w.name === "Table - Open Cases");
await ws.applyFilterAsync("Region", ["APAC"], "replace", { isExcludeMode: false });
await ws.applyRangeFilterAsync("Sales", { min: 0, max: 100 });   // dates are UTC Date objects
await ws.clearFilterAsync("Region");
return (await ws.getFiltersAsync()).map(f => ({ field: f.fieldName, type: f.filterType }));
```

- **Base `Filter`:** `worksheetName`, `filterType`
  (`"categorical" | "range" | "hierarchical" | "relative-date"`), `fieldName`, `fieldId`.
- **`CategoricalFilter`:** adds `appliedValues: DataValue[]`, `isAllSelected`
  (when true `appliedValues` is empty), `isExcludeMode`, `getDomainAsync(domainType?)`.
- **`RangeFilter`:** adds `minValue: DataValue`, `maxValue: DataValue`
  (note: `minValue`/`maxValue`, not `min`/`max`).

Discover valid categorical values **before** applying (avoids the silent no-op
in §6) — `helpers.getDomainValues(ws, field)` does this.

### Domain discovery: use `"relevant"` by default

When enumerating valid values (`getDomainAsync`, `helpers.getDomainValues`),
pass **`"relevant"`** — it is the helper's default and the right choice in
almost every case. The relevant domain reflects the values **actually present in
the current view**, so it automatically excludes:

- rows the current filter/time-frame state has removed (e.g. a country with no
  data in the selected period), and
- stale/alias values in the data source that have no rows at all (e.g. a legacy
  `"USA"` sitting next to the canonical `"United States"`).

Looping over the **`"database"`** domain instead can hand you values that have
no data under the current state — you query them, the filter silently no-ops or
returns an empty reader (§8), and you produce confusing empty/duplicate rows.
Use `"database"` only when you specifically need every value ever present in
the data source regardless of the current view.

```js
// Right: only values present in the current view.
return helpers.getDomainValues("Table", "Region");              // default "relevant"
return (await f.getDomainAsync("relevant")).values.map(v => v.value);
// Only when you truly want every value the data source has ever seen:
return (await f.getDomainAsync("database")).values.map(v => v.value);
```

## 6. Tableau silently no-ops invalid mutations — read state back

The single most important pitfall. Mutations that should fail often **resolve
successfully as a no-op**:

- Applying an out-of-domain value (e.g. `"EMEA"` when the domain is `APAC` /
  `Europe`) is **ignored with no error**.
- A wrong-field-type call (`applyRangeFilterAsync` on a categorical field)
  **resolves successfully** and does nothing.

Never treat "no exception" as "it worked." After any mutation, **re-read** via
`getFiltersAsync()` / `getParametersAsync()` and confirm the state. Every
`helpers.*` mutator reads state back and returns the confirmed value.

## 7. Parameters

```js
return (await workbook.getParametersAsync()).map(p => ({ name: p.name, current: p.currentValue?.value, dataType: p.dataType }));
await workbook.changeParameterValueAsync("Compare Region", "Europe");
```

`Parameter`: `{ name, currentValue: DataValue, dataType, allowableValues, id,
changeValueAsync(value) }`. Out-of-range values are **clamped** (not rejected)
and off-step values snap — another reason to read back (§6). Date parameters
take UTC `Date` objects.

`allowableValues` is a `ParameterDomainRestriction` that nests `DataValue`
objects deeper than the serializer's depth cap — `helpers.getParameters()` and
the snapshot normalize it to a flat, serializer-safe shape:
`{ type: "list", values: [...] }`, `{ type: "range", min, max, stepSize,
dateStepPeriod }`, or `{ type: "any" }`.

## 8. Data retrieval + the `DataValue` shape

Use the **reader** pattern; `getSummaryDataAsync()` is **deprecated**.

```js
const reader = await ws.getSummaryDataReaderAsync();   // page size default/max 10,000
try {
  const table = await reader.getAllPagesAsync(500);    // cap rows to keep the payload small
  return {
    columns: table.columns.map(c => c.fieldName),
    totalRowCount: table.totalRowCount,
    limited: table.isTotalRowCountLimited,
    rows: table.data.map(row => row.map(c => c.value)),  // flat table of primitives
  };
} finally {
  await reader.releaseAsync();   // see §9
}
```

- **`DataTable`:** `{ name, columns: Column[], data: DataValue[][],
  totalRowCount, isTotalRowCountLimited }`.
- **`Column`:** `{ fieldName, fieldId, dataType, isReferenced, index }`. Note
  `getSummaryDataReaderAsync` returns columns in **alphabetical** order; use
  `getSummaryColumnsInfoAsync()` for **view order**.
- **`DataValue`** serializes to its public shape (`value`, `nativeValue`,
  `formattedValue`, `aliasValue`, `hasAlias`); for a flat table use `c.value`.

**Guard empty readers.** A worksheet with **no rows under the current filter
state** (e.g. a country with no data in the selected period) yields a
`DataTableReader` with `pageCount === 0`. Paging it — `getAllPagesAsync` or
`getPageAsync` — throws `invalid-parameter: 0 is invalid value for range:
[0..0)` and can kill an otherwise-fine eval or script. Always check
`reader.pageCount` before paging, and treat zero rows as **empty data, not an
error**:

```js
const reader = await ws.getSummaryDataReaderAsync();
try {
  if (!reader.pageCount) {
    return { columns: [], rows: [], totalRowCount: 0, isTotalRowCountLimited: false };
  }
  const table = await reader.getAllPagesAsync(500);
  return { /* ... */ };
} finally {
  await reader.releaseAsync();
}
```

This matters for both **ad hoc evals** and **reusable scripts** — scripts that
loop over a set of values (like per-country KPIs) must handle the values that
have no rows, or one empty value busts the whole loop.

`helpers.readVizData(ws, { maxRows })` wraps this whole pattern (including the
empty-reader guard) with a guaranteed release, and returns **rows keyed by
column name** (`rows[0]["SUM(Sales)"]` — never positional indices, which crash
on empty readers and silently shift on reordered columns). For underlying data
use `helpers.readUnderlyingData(ws, { maxRows, logicalTableId? })` (or the
reader pattern with `getUnderlyingTablesAsync` +
`getUnderlyingTableDataReaderAsync`). Don't size an underlying read off a
tiny probe: with `maxRows: 1` the reported `totalRowCount` was `1` even though
the table held thousands of rows — probe with a realistic `maxRows` and trust
`isTotalRowCountLimited` on that read.

## 9. Reader release is the agent's responsibility

The serializer **auto-releases** a `DataTableReader` it finds **in the return
value**. A reader you **consume inside the eval and do not return** must be
released explicitly (only one active summary reader per worksheet; auto-released
only after 60 min):

```js
const r = await ws.getSummaryDataReaderAsync();
try {
  const t = await r.getAllPagesAsync();
  return { rows: t.totalRowCount };
} finally {
  await r.releaseAsync();
}
```

## 10. Helper library reference

`helpers.*` bake in the rules above (read-back after mutation, guaranteed
release, lazy workbook). Convenience, not a cage — raw API calls work too.

| Helper | Signature | Returns |
| --- | --- | --- |
| `listSheets()` | — | `{ name, index, sheetType, isActive, isHidden }[]` |
| `getActiveSheet()` | — | `{ name, sheetType }` |
| `getFilters(worksheetName?)` | optional worksheet name | walks all worksheets on a dashboard |
| `applyCategoricalFilter(ws, field, values, updateType?)` | `"replace"` default / `"add"` / `"remove"` / `"all"` | confirmed `{ fieldName, appliedValues, isAllSelected }` (read back) |
| `applyRangeFilter(ws, field, options)` | `options` = `{ min?, max?, nullOption? }` | confirmed `{ fieldName, minValue, maxValue }` (read back) |
| `clearFilter(ws, field)` | — | `{ cleared, remaining }` |
| `getParameters()` | — | `{ name, currentValue, dataType, allowableValues }[]` — `allowableValues` normalized flat (`{type:"list",values}` / `{type:"range",…}` / `{type:"any"}`), never `"[max depth]"` |
| `setParameter(name, value)` | string/number/boolean | confirmed `{ name, current }` (read back) |
| `readVizData(ws, { maxRows? })` | `maxRows` default 10,000 | `{ columns, totalRowCount, isTotalRowCountLimited, rows, isEmpty }` — **rows keyed by column name**, reader released, empty readers guarded (§8). Access `rows[0]["SUM(Sales)"]`, never a positional index. |
| `readUnderlyingData(ws, { maxRows?, logicalTableId? })` | `maxRows` default 1000; optional `logicalTableId` | `{ table, columns, totalRowCount, isTotalRowCountLimited, rows, isEmpty }` — rows keyed by column name |
| `describeFilter(field, { worksheet?, domainType? })` | `domainType` = `"relevant"` (default) / `"database"` | full typed definition for any filter type: categorical (`appliedValues`, `isAllSelected`, `isExcludeMode`, `domain`), range (`minValue`, `maxValue`, `domain`), relative-date (`anchorDate`, `periodType`, `rangeN`, `rangeType`), hierarchical (`domain.levels`); plus `appliedWorksheets` |
| `getDomainValues(ws, field, domainType?)` | `domainType` = `"relevant"` (default) / `"database"` | `{ fieldName, domainType, values }` — **keep `"relevant"`** (§5) |
| `getVisualSpec(ws)` | — | the worksheet's `VisualSpecification` |
| `classifyFilters(filters)` | filter array with `fieldName` | `{ note, selectionActions, applied }` — `Action (...)` filters split out (selection actions); the note explains the groups. Same classification the snapshot and the semantic-model derive script use |
| `visibleControls(zones)` | zone array (`{ name, type, worksheet }`) | `{ note, controls }` — the quick-filter and parameter-control dashboard objects, i.e. the filters/parameters a human user actually sees and references |
| `getDataSources(ws)` | — | `[{ name, id, isExtract, isPublished, extractUpdateTime, fields }]` (⚠ §13) |
| `activateSheet(name)` | name or 0-based index | `{ active, sheetType }` |
| `selectMarks(ws, criteria, updateType?)` | `"select-replace"` default | selected-marks table summaries |

`ws` is a worksheet name; on a dashboard it is required unless the dashboard has
exactly one worksheet.

## 11. The `meta` background cache

A fifth in-scope symbol in every eval. Static metadata (summary columns + visual
specs) for the **active dashboard's worksheets** (capped ~8) is cached in the
background; dynamic values (filters, parameters, marks, active sheet) are never
cached — always read live.

```js
meta = {
  state: "loading" | "loaded" | "partial",
  progress: { completedCalls, totalCalls, completedWorksheets, totalWorksheets, elapsedMs },
  worksheets: {
    "Table - Open Cases": {
      columns:    [ ... ],        // getSummaryColumnsInfoAsync result (view order)
      visualSpec: { rowFields, columnFields, marksSpecifications },
      dataSources: null,          // NOT auto-fetched — call ws.getDataSourcesAsync() if needed
    }
  },
  ready:   async (worksheetName?) => Promise<void>,  // resolve when fill completes / a worksheet lands
  load:    async (worksheetName) => Promise<void>,   // on-demand fill for a sheet outside auto scope
  refresh: async () => Promise<void>                 // re-run the loader (auto after viz.refreshDataAsync())
}
```

- `return meta` reads whatever is loaded **instantly, no round trip** — the
  cache is a plain object, so a worksheet's columns are readable the moment they
  land even while its visual spec is still in flight.
- The loader is low-concurrency (2), per-call ~3s, global budget ~12s; on
  partial completion → `status:"partial"` + an `errors` list. **Commands are
  never blocked** — the loader deliberately yields.
- `tableau-viz meta` is the CLI wrapper; `--wait` blocks until filled,
  `--worksheet W` reads one entry, `--worksheet W --wait` fills it on demand
  (`meta.load(W)`).

## 12. Mark selection

```js
await ws.selectMarksByValueAsync([{ fieldName: "Region", value: ["APAC"] }], "select-replace");
const m = await ws.getSelectedMarksAsync();   // MarksCollection: { data: DataTable[] }
await ws.clearSelectedMarksAsync();
```

`SelectionCriteria`: `{ fieldName, value }` where `value` is a string, string
array, or `{ min, max, nullOption? }`.

### Selection is how select-action dashboards are driven

Many dashboards are interactive through Tableau **select actions**: a human
clicks a mark, other worksheets filter. You replicate the click with
`selectMarksByValueAsync` / `helpers.selectMarks` and the viz responds exactly
as it does for a human.

- **The tell-tale:** target worksheets carry filters named `Action (<field>)`
  (e.g. `Action (Account Title)`) — visible via `getFiltersAsync()` even with
  nothing selected (`isAllSelected: true`, empty `appliedValues`). They belong
  to the action machinery: **do not `applyFilterAsync` them** — select marks on
  the *source* worksheet instead. After a selection the same filter reads back
  `isAllSelected: false` with `appliedValues` set (the entry shape is not a
  plain primitive — don't lean on it).
- **Data reads see it.** `getSummaryDataReaderAsync` and the underlying-table
  reads on other worksheets reflect the selection as though it were a filter,
  so `helpers.readVizData` / `readUnderlyingData` return the selected slice.
- **Reset** with `clearSelectedMarksAsync()` (no helper wrapper). Read back —
  the `Action (…)` filters should return to `isAllSelected: true` — to confirm
  the viz is back in its original state.

## 13. Data sources — agent-initiated only, deep introspection belongs to semantics

`worksheet.getDataSourcesAsync()` is **never auto-called** by this tool. Tableau's
own docs: *"calling `getDataSourcesAsync` might negatively impact performance and
responsiveness of the view that you are embedding. The method is partly
asynchronous but includes some serial operations."*

Call it when the task genuinely needs data-source metadata (field origins,
published/extract status, connections) and accept the cost. Correct call shape:

```js
const dss = await ws.getDataSourcesAsync();
return dss.map(ds => ({ name: ds.name, id: ds.id, isExtract: ds.isExtract, isPublished: ds.isPublished, fields: ds.fields.map(f => f.name) }));
```

`helpers.getDataSources(ws)` returns this trimmed shape.

**Deep field introspection belongs in the `tableau-semantics` skill, not this
runtime.** The semantic-model derive script calls `getDataSourcesAsync()`
directly once per worksheet at model-build time, maps the full `Field` surface
(`aggregation`, `isCalculatedField`, `description`, `semanticRole`, `fieldId`,
…) and keeps only the fields the workbook's worksheets actually reference. If
you need that depth, derive or read the semantic model instead of poking the
live viz — this skill stays fast and snappy.

## 14. Auth model (Public / authenticated sites) + troubleshooting

**Tableau Public (no auth):** views served from `public.tableau.com` render
without any session — no auth decision applies. (Hidden Public views need a
`public.tableau.com` login; `open-site` opens the origin for that.)

**Authenticated Tableau Cloud/Server — the Partitioned-cookie problem:** Tableau
now sets its session cookie (`workgroup_session_id`) with
`SameSite=None; Secure; Partitioned`. A `Partitioned` cookie is double-keyed by
the **top-level site**, so a session from a normal tab (top-level = the Tableau
origin) does **not** carry into an embed whose top-level is `127.0.0.1` (the
bridge). The embed shows Tableau's in-frame auth helper (`embeddedAuth.html`)
with a *Sign in to Tableau Cloud* button instead.

The **human completes the in-frame sign-in once** in the embed's own tab (or the
site provides a connected-app token). The partition-scoped session then persists
in the browser for that top-level origin, so later `start` tabs on the same
machine can reuse it.

**Auth-aware loading:** the embed listens for `IframeSrcUpdated` /
`firstvizsizeknown` and, when it detects the iframe parked on a sign-in/`pkce`
route (or no viz size within ~5s), it **hides the loading animation** so the
login page is immediately visible and clickable. The session reports an `auth`
state during sign-in; `wait` keeps waiting rather than erroring. The 30s
watchdog only runs while the viz is actually loading — never while waiting on
auth.

Caveats:

- A human sign-in is required per machine/origin — it does not scale to
  autonomous multi-agent fan-out. The connected-app **token** path is the
  durable enterprise option.
- Corporate CSP `frame-ancestors` can block in-frame SSO for strict
  environments.
- **Token seam (enterprise):** pass a connected-app JWT via `?tableau-token=` on
  the embed page, or provide one at runtime via `window.__AUTH__ = { token }`.
  A token broker that mints short-lived JWTs is a reserved seam, not shipped.

**Library URL.** Derived from the viz URL's origin
(`<origin>/javascripts/api/tableau.embedding.3.latest.min.js`), valid for
Public, Server, and Cloud. `--lib-url` overrides edge cases (pinned version /
distinct SDK host). Never load the library from `file://`.

**Watchdog timeout.** If neither `firstinteractive` nor `vizloaderror` fires
within 30s, the session flips to `error`. For Public: `open-site` to establish
a session. For authenticated sites: a human completes the in-frame sign-in (or a
connected-app token is used).

## 15. Scope — what this tool does not do

- **No event listeners.** The bridge is request/response plus the lifecycle
  pushes; `addEventListener` (`FilterChanged`, `ParameterChanged`, …) has no
  delivery path. Drive the viz imperatively and **read state back**.
- **No exports / dialogs.** `exportImageAsync` / `exportPDFAsync` /
  `exportCrosstabAsync` / `exportDataAsync` return `Promise<void>` and only
  trigger a browser download. `displayDialogAsync` opens a modal for a human.
- **No hierarchical filters** (needs a cube/hierarchical field; rare).
- **Mark-click / context-menu-click handlers** depend on an event channel this
  tool does not provide.
- **Catalog / REST / metadata querying** is the `query-tableau-data` skill.

## 16. Performance & safety guidelines

- **Page and cap data.** Use the reader pattern + `maxRows`; shape `return` to
  the fields you need (serializer caps depth 6 / arrays 5000).
- **Always release readers** (§9) or use `helpers.readVizData`.
- **Localhost only.** The bridge binds `127.0.0.1` with a per-bridge token on
  every socket; never expose the port. Arbitrary agent JS runs in a page
  authenticated to Tableau via the user's session — the same trust model as a
  browser devtools console.