# Deriving a Semantic Model — the exact queries

This document is the **source of truth for generating and refreshing** the
derived semantic model (`<Name>.derived.json`). Any agent can re-run these
calls against a live asset and regenerate the machine half of a model.

Three sources feed the derived model:

| Source | Transport | Contributes |
| ------ | --------- | ----------- |
| REST API | `https://<host>/api/{api-version}/sites/{site-id}/...` | Identity, `createdAt` / `updatedAt` (**freshness anchor**), project, owner, tags, views |
| Metadata API | `POST /api/metadata/graphql` | Lineage (workbook → datasource → table/column), field catalog enrichment (descriptions, roles, types, formulas) |
| Embedding API v3 | JavaScript in a live embedded viz | The visual layer: sheets, zones, parameters, filters, per-worksheet columns + visual specs, datasource fields and logical tables |

> The REST and Metadata API calls need only a Personal Access Token (PAT).
> The Embedding API calls need a live viz and are **optional** — the REST +
> GraphQL calls already capture the structural core. Use the Embedding API
> when a `view-tableau-dashboard` session is available to enrich the visual
> layer.

---

## 1. Authentication

Create a PAT (Tableau UI → My Account Settings → Personal Access Tokens) and
configure `.env` (see `.env.template`):

```
TABLEAU_SERVER_URL="https://your-server"
TABLEAU_SITE_NAME="your-site"
PAT_NAME="your-pat-name"
PAT_VALUE="your-pat-secret"
```

Sign in to get a session token:

```
POST {TABLEAU_SERVER_URL}/api/{api-version}/auth/signin
Content-Type: application/json

{
  "credentials": {
    "name": PAT_NAME,
    "password": PAT_VALUE,
    "site": { "contentUrl": TABLEAU_SITE_NAME }
  }
}
```

Response: `credentials.token` (the `X-Tableau-Auth` header for all calls
below) and `credentials.site.id` (the `{site-id}` path segment).

To find an asset's LUID, query the catalog:

```
GET {server}/api/{api-version}/sites/{site-id}/workbooks?filter=name:eq:{WorkbookName}
GET {server}/api/{api-version}/sites/{site-id}/datasources?filter=name:eq:{DatasourceName}
```

---

## 2. REST — identity and freshness anchor

### Workbook

```
GET {server}/api/{api-version}/sites/{site-id}/workbooks/{workbook-luid}
X-Tableau-Auth: {token}
```

Captured fields (the **freshness anchor** is `updatedAt`):

```json
{
  "workbook": {
    "id": "…", "name": "…", "description": "…", "contentUrl": "…",
    "webpageUrl": "…", "showTabs": true, "size": 12345,
    "createdAt": "…", "updatedAt": "…",
    "defaultViewId": "…",
    "project": { "id": "…", "name": "…" },
    "owner": { "id": "…", "name": "…" },
    "tags": { "tag": [{ "label": "…" }] },
    "views": { "view": [{ "id": "…", "name": "…", "viewUrlName": "…",
                          "createdAt": "…", "updatedAt": "…" }] }
  }
}
```

### Datasource

```
GET {server}/api/{api-version}/sites/{site-id}/datasources/{datasource-luid}
X-Tableau-Auth: {token}
```

Captured fields: `id`, `name`, `description`, `contentUrl`, `webpageUrl`,
`type`, `createdAt`, `updatedAt` (**freshness anchor**), `isCertified`,
`hasExtracts`, `extractLastUpdateTime`, `project`, `owner`, `tags`.

> **Freshness check:** compare the model's `freshness.anchor` to the current
> `updatedAt` from this call. If the asset is newer, the model is stale.

---

## 3. Metadata API (GraphQL) — lineage and catalog enrichment

`POST /api/metadata/graphql` with header `X-Tableau-Auth: {token}` and
`Content-Type: application/json`. The Metadata API is **lineage-first**: one
targeted query per asset by LUID.

### 3a. Workbook lineage + field-level structure

```graphql
query IntrospectWorkbook($luid: String!) {
  workbooks(filter: { luid: $luid }) {
    name
    luid
    description
    projectName
    owner { name }
    createdAt
    updatedAt
    sheets {
      name
      luid
      index
      sheetFieldInstances {
        name
        ... on ColumnField { dataType role }
        ... on CalculatedField { dataType role formula }
      }
      worksheetFields {
        name
        formula
        dataType
        role
      }
      containedInDashboards {
        name
        luid
      }
    }
    dashboards {
      name
      luid
      index
      sheets { name luid }
    }
    embeddedDatasources {
      name
      hasExtracts
      fields {
        name
        ... on ColumnField { dataType role }
        ... on CalculatedField { dataType role formula }
      }
      upstreamDatasources {
        luid
        name
      }
    }
    parameters {
      name
    }
  }
}
```

Send as JSON body with `"variables": { "luid": "<workbook-luid>" }`.

### 3b. Published datasource field enrichment

```graphql
query DatasourceFieldInfo($luid: String!) {
  publishedDatasources(filter: { luid: $luid }) {
    name
    description
    owner { name }
    fields {
      name
      isHidden
      description
      fullyQualifiedName
      __typename
      upstreamTables { name }
      ... on ColumnField {
        dataCategory role dataType defaultFormat semanticRole aggregation
      }
      ... on CalculatedField {
        dataCategory role dataType defaultFormat semanticRole aggregation
        formula isAutoGenerated
      }
      ... on BinField   { dataCategory role dataType formula binSize }
      ... on GroupField { dataCategory role dataType hasOther }
    }
  }
}
```

### 3c. Lineage (upstream / downstream)

For a **workbook** — what powers it and what it contains:

```graphql
query WorkbookLineage($luid: String!) {
  workbooks(filter: { luid: $luid }) {
    luid name description projectName
    sheets { luid name }
    dashboards { luid name }
    embeddedDatasources {
      name
      upstreamDatasources { luid name }
    }
    upstreamDatasources { luid name }
    upstreamDatabases { name connectionType }
  }
}
```

For a **datasource** — what consumes it and what it reads from:

```graphql
query DatasourceLineage($luid: String!) {
  publishedDatasources(filter: { luid: $luid }) {
    luid name description projectName isCertified hasExtracts
    downstreamWorkbooks { luid name }
    downstreamSheets { luid name }
    downstreamDashboards { luid name }
    upstreamTables { name databaseName }
    upstreamDatabases { name connectionType }
    fields(first: 30) { name __typename dataType role }
  }
}
```

---

## 4. Embedding API v3 — the visual layer (optional, live viz)

When a live viz is available (via `view-tableau-dashboard`), enrich the
model with the visual layer. These are **agent-authored JS** against the
embedded viz. Do not auto-call `getDataSourcesAsync` in a background loader —
Tableau's docs warn it can impact view performance; call it deliberately at
model-build time only.

> **Reusable derivation:** the shipped skill includes
> [`scripts/derive-workbook.sh`](../scripts/derive-workbook.sh) — a one-shot
> wrapper that embeds a workbook, runs [`derive-workbook.js`](../scripts/derive-workbook.js)
> against it, and writes `<Name>.derived.json` under
> `<site>/workbooks/<Workbook>/`. Use it so every derived model is produced by
> the same code path:
>
> ```bash
> ./scripts/derive-workbook.sh \
>   --site <site> \
>   --url https://public.tableau.com/views/<Workbook>/<View> \
>   --name <Workbook>.<View>
> ```
>
> The derivation covers everything the Embedding API exposes statically:
> sheets, zones, **visible controls** (the quick-filter / parameter-control
> dashboard objects), parameters (allowable values normalized flat),
> **filters grouped** (selection actions vs applied, with relative-date
> periods + `appliedWorksheets`), per-worksheet columns + visual specs,
> **referenced fields** (the union of fields the worksheets use, enriched from
> the datasource catalog — the workbook model deliberately does not dump the
> full schema), datasource + logical tables + `extractUpdateTime`, and domain
> samples. REST/Metadata-only fields (`luid`, `owner`, `tags`,
> `freshness.anchor`, lineage, formulas) are emitted as `null` — enrich them
> with the REST (§2) and Metadata (§3) queries when a PAT is available.
>
> `getDataSourcesAsync()` is called **only** here, at model-build time — the
> `view-tableau-dashboard` skill's runtime path never invokes it.

```js
// Workbook, sheets, zones
const wb = viz.workbook;                       // name, publishedSheetsInfo
const sheets = wb.publishedSheetsInfo;         // [{ name, sheetType, index, isHidden }]
const active = viz.workbook.activeSheet;       // if a dashboard:
const zones = active.objects;                  // [{ name, type, worksheet?, isFloating, position, size }]

// Parameters + dashboard-level filters (async)
const params = await wb.getParametersAsync();  // [{ name, dataType, currentValue, allowableValues }]
const filters = await active.getFiltersAsync();// [{ worksheet, fieldName, filterType, appliedValues?, isAllSelected? }]
// NOTE: relative-date filters expose anchorDate/periodType/rangeN/rangeType — read them live.

// Per-worksheet static metadata
const cols = await ws.getSummaryColumnsInfoAsync();   // [{ fieldName, fieldId, dataType, index, ... }]
const spec = await ws.getVisualSpecificationAsync();  // { rowFields, columnFields, marksSpecifications }

// Datasource fields + logical tables (agent-initiated; performance warning applies)
const dss = await ws.getDataSourcesAsync();           // [{ name, id, isExtract, isPublished, extractUpdateTime, fields }]
for (const ds of dss) {
  const tables = await ds.getLogicalTablesAsync();    // [{ id, caption }]
}
```

**Field instance metadata** (`FieldInstance`) available on each field of a
datasource: `name`, `fieldId`, `role` (DIMENSION/MEASURE), `aggregation`,
`dataType`, `description`, `isCalculatedField`, `isCombinedField`,
`isGenerated`, `isGeospatial`, `isHidden`, `isPresentOnPublishedDatasource`,
`semanticRole`, `columnType`.

---

## 5. Assembling the derived model

Save the merged result as `<Name>.derived.json` next to the behavioral
markdown. Shape:

```jsonc
{
  "schema_version": "1.0",
  "asset": {
    "type": "workbook" | "datasource",
    "name": "…",
    // Full canonical embed URL — the easiest match when a user hands you a URL.
    "url": "…",
    // Host-free slug (path after /views/) — portable across sites. Combine with
    // a user-provided site origin at runtime to rebuild the embed URL.
    "urlSlug": "…",
    "luid": "…",            // null when Embedding-only (no REST pass)
    "site": "…",
    "project": "…",
    "owner": "…",
    "contentUrl": "…",
    "webpageUrl": "…",
    "description": "…",
    "tags": ["…"],
    // Placeholder note: identity fields are populated by your real environment
    // (PAT-enabled REST/Metadata pass), never hard-coded in an example model.
    "note": "…"
  },
  "freshness": {
    "anchor": "<source updatedAt> | null",   // null: no REST catalog (e.g. Tableau Public) — no refresh schedule, likely static
    "retrievedAt": "<when the model was generated>",
    "source": "REST API | Embedding API (view-tableau-dashboard)",
    "note": "…"   // placeholder: the anchor is populated by your real environment (PAT REST pass), never hard-coded
  },
  "structure": {            // workbook: sheets, dashboards, zones, visible controls, parameters, filters
    "sheets": [{ "name": "…", "type": "worksheet" | "dashboard", "index": 0, "url": "…" }],  // url = full canonical URL per sheet
    "dashboards": [{ "name": "…", "luid": "…", "sheets": ["…"] }],
    "zones": [{ "name": "…", "type": "…", "worksheet": "…" }],
    "visibleControls": {    // what a human user sees and references
      "note": "…",          // "quick-filter objects are the visible filter controls, parameter-control objects the visible parameter pickers…"
      "controls": [{ "name": "…", "type": "quick-filter" | "parameter-control", "worksheet": "…" }]
    },
    "parameters": [{ "name": "…", "dataType": "…", "allowableValues": { "type": "list", "values": ["…"] } | { "type": "range", "min": …, "max": …, "stepSize": …, "dateStepPeriod": … } | { "type": "any" } }],
    "filters": {            // grouped deterministically; the note encodes the semantics
      "note": "…",          // selection actions are driven by mark selection; applied filters are the rest (visible + hidden)
      "selectionActions": [{ "worksheet": "…", "fieldName": "Action (…)", "filterType": "categorical", "appliedWorksheets": ["…"] }],
      "applied": [{ "worksheet": "…", "fieldName": "…", "filterType": "…", "period": { "anchorDate": …, "periodType": …, "rangeN": …, "rangeType": … }, "appliedWorksheets": ["…"] }]
    }
  },
  "datasource": {           // the primary embedded datasource
    "name": "…",
    "id": "…",
    "hasExtracts": true,
    "isPublished": false,
    "extractUpdateTime": "…",   // the best data-freshness signal when freshness.anchor is null (Public)
    "logicalTables": [{ "id": "…", "caption": "…" }],
    "fullSchemaFieldCount": 438 // the full catalog lives in the datasource semantic model
  },
  "fields": [               // REFERENCED FIELDS ONLY — the union of fields the workbook's worksheets use
    {
      "name": "…",
      "dataType": "STRING" | "INTEGER" | "REAL" | "BOOLEAN" | "DATE" | "DATETIME",  // canonical casing
      "role": "DIMENSION" | "MEASURE",
      "aggregation": "…",
      "description": "…",
      "isCalculated": false,
      "formula": "…",       // Metadata API enrichment (null from Embedding)
      "logicalTable": "…",  // Metadata API enrichment (null from Embedding)
      "datasource": "…"     // which embedded datasource the field came from
    }
  ],
  "lineage": {
    "upstreamDatasources": [{ "luid": "…", "name": "…" }],
    "upstreamTables": [{ "name": "…", "databaseName": "…" }],
    "upstreamDatabases": [{ "name": "…", "connectionType": "…" }],
    "downstreamWorkbooks": [{ "luid": "…", "name": "…" }]
  },
  "samples": {              // OPTIONAL, labeled — NEVER treated as live truth
    "note": "samples only — filter domain values and row counts must be verified live",
    "fieldDomainSamples": { "<fieldName>": ["…", "…"] }
  },
  "_meta": {                // derivation provenance
    "derivationSource": "…",
    "worksheets": ["…"],
    "note": "referenced fields only — the full datasource catalog belongs in the datasource semantic model"
  }
}
```

Rules:

- **Static metadata goes in.** Layout, parameters, filter classification,
  visible controls, referenced field catalog, lineage, identity, freshness.
- **Workbook `fields` = referenced fields only.** The union of fields the
  workbook's worksheets actually use, enriched from the datasource catalog —
  never the full schema. The full catalog belongs in the **datasource**
  semantic model; lineage is the bridge.
- **Canonical casing.** `dataType` uses `STRING/INTEGER/REAL/BOOLEAN/DATE/
  DATETIME`; `role` uses `DIMENSION/MEASURE` (matches the Metadata API). The
  Embedding API's lowercase values are normalized at derivation time.
- **Filters are grouped, not flat.** Selection actions (`Action (...)` —
  mark-selection driven) vs applied; the visible set is `visibleControls`,
  not the filter list (the dashboard filter list includes hidden filters).
- **Dynamic values are samples at most.** Domain members, ranges, current
  values, row counts belong in `samples` (or are omitted entirely) and must
  be verified live.
- **The freshness anchor drives staleness when present.** `freshness.anchor`
  is authoritative for Cloud/Server. A `null` anchor (Tableau Public — no
  REST catalog) means no detectable refresh schedule; treat the model as
  orientation and verify live (see `READING_THE_MODEL.md`).