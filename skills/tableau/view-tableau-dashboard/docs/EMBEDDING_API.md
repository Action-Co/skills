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

`helpers.readSummary(ws, { maxRows })` wraps this whole pattern with a
guaranteed release. For underlying data use `helpers.readUnderlying` (or the
reader pattern with `getUnderlyingTablesAsync` + `getUnderlyingTableDataReaderAsync`).

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
| `getParameters()` | — | `{ name, currentValue, dataType, allowableValues }[]` |
| `setParameter(name, value)` | string/number/boolean | confirmed `{ name, current }` (read back) |
| `readSummary(ws, { maxRows? })` | `maxRows` default 10,000 | `{ columns, totalRowCount, isTotalRowCountLimited, rows }` — reader released |
| `getDomainValues(ws, field, domainType?)` | `domainType` = `"relevant"` (default) / `"database"` | `{ fieldName, domainType, values }` |
| `getVisualSpec(ws)` | — | the worksheet's `VisualSpecification` |
| `getDataSources(ws)` | — | `[{ name, id, isExtract, isPublished, extractUpdateTime, fields }]` (⚠ §13) |
| `activateSheet(name)` | name or 0-based index | `{ active, sheetType }` |
| `selectMarks(ws, criteria, updateType?)` | `"select-replace"` default | selected-marks table summaries |
| `readUnderlying(ws, { maxRows?, tableIndex? })` | `maxRows` default 1000 | `{ table, columns, totalRowCount, limited, rows }` |

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

## 13. Data sources — agent-initiated only

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

## 14. Auth model (public-first) + troubleshooting

**Default (Tableau Public / SSO):** the embed page reuses the browser's
existing session — no token.

1. `tableau-viz open-site --url <viz-url>` opens the Tableau origin so the user
   can log in. The agent tells the human it needs help here.
2. `tableau-viz start --url <viz-url>` embeds and reuses that session.

Caveats:

- **Session reuse requires third-party cookies enabled**; blocked cookies
  present as auth failures (`VizLoadError` with an auth-shaped error).
- Browser-SSO auto-auth works only against **Public**; corporate CSP
  `frame-ancestors` blocks in-frame SSO redirects — those deployments need the
  connected-app **token** path.
- **Token seam (enterprise):** pass a connected-app JWT via `?tableau-token=` on
  the embed page, or provide one at runtime via `window.__AUTH__ = { token }`.
  A token broker that mints short-lived JWTs is a reserved seam, not shipped.

**Library URL.** Derived from the viz URL's origin
(`<origin>/javascripts/api/tableau.embedding.3.latest.min.js`), valid for
Public, Server, and Cloud. `--lib-url` overrides edge cases (pinned version /
distinct SDK host). Never load the library from `file://`.

**Watchdog timeout.** If neither `firstinteractive` nor `vizloaderror` fires
within 30s, the session flips to `error` — usually an auth/session problem. Run
`open-site`, or check third-party cookies.

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
- **Always release readers** (§9) or use `helpers.readSummary`.
- **Localhost only.** The bridge binds `127.0.0.1` with a per-bridge token on
  every socket; never expose the port. Arbitrary agent JS runs in a page
  authenticated to Tableau via the user's session — the same trust model as a
  browser devtools console.