# Reading a Derived Semantic Model

How to read `<Asset>.derived.json` — what each section means and how to
interpret the nulls. The model is a **snapshot**, not a live system: treat it
as a head start, and verify dynamic values live.

## Top-level sections

| Section | Meaning | Notes |
| ------- | ------- | ----- |
| `schema_version` | Format version of the derived model | Bump on breaking shape changes |
| `asset` | Identity: type, name, **url** (full canonical embed URL), **urlSlug** (host-free), LUID, site, project, owner, URLs, tags, `note` | **Nulls mean the derivation ran Embedding-only** (no PAT-enabled REST/Metadata pass): `luid`, `site`, `project`, `owner`, `webpageUrl`, `description`, `tags` are unfilled. Enrich with a PAT run if you need them. The `note` field explains which identity fields a real environment populates automatically. |
| `freshness` | When the model was captured and against what | `anchor` is the source `updatedAt` (REST); `retrievedAt` is when the model was generated |
| `structure` | Sheets, dashboards, zones, **visibleControls**, parameters, filters | The static visual layer |
| `datasource` | The primary embedded datasource: extract state, `extractUpdateTime`, logical tables, `fullSchemaFieldCount` | See below |
| `fields` | **Referenced fields only** — the fields the workbook's worksheets actually use | See below |
| `lineage` | Upstream datasources/tables/databases; downstream workbooks | The bridge to the datasource semantic model |
| `samples` | Labeled samples of categorical domain values | **Never treated as live truth** — verify live |
| `_meta` | Derivation provenance + worksheets covered | Notes explain generation choices |

## Reading the nulls

| Null / empty | Meaning | What to do |
| ------------ | ------- | ---------- |
| `freshness.anchor: null` | The workbook has **no detectable refresh schedule** — the REST API was unavailable (e.g., **Tableau Public**) or the asset is static. The URL origin (`public.tableau.com` vs a Cloud/Server host) tells you which. The model's `freshness.note` states that a real-environment run populates the anchor. | Treat the model as orientation over a likely-static dataset. Read data live; do not block on a staleness comparison. `datasource.extractUpdateTime`, when present, is the best data-freshness signal. |
| `asset.luid` / `site` / `project` / `owner` / `tags` null | Embedding-only derivation — the REST/Metadata catalog pass didn't run. See `asset.note`. | Optional enrichment: run the PAT-enabled REST + GraphQL queries in `docs/DERIVATION.md` to fill identity + lineage. |
| `fields[].logicalTable` / `formula` null | Metadata API enrichment didn't run (Embedding API does not expose formulas or table mapping). | Optional enrichment via the Metadata API (see `docs/DERIVATION.md` §3). |
| `fields[].dataType` / `role` / etc. null on a *referenced* field | The field is used by a worksheet but was not found in the datasource catalog (sheet-level calculation, caption mismatch, or a derived field). | The reference is still meaningful — the workbook uses it. Query it live by name to learn its shape. |
| `fields` much smaller than `datasource.fullSchemaFieldCount` | Expected, not a bug: the workbook model intentionally lists only the fields the workbook leverages. | For the full catalog, derive or read the **datasource** semantic model (`<site>/datasources/<Datasource>/`), reachable via `lineage`. |

## Filters & visible controls

- `structure.filters` is grouped: `selectionActions` (`Action (...)` — driven
  by mark selection / mouse clicks; drive with `selectMarks`, never
  `applyFilterAsync`) and `applied` (everything else applied to the dashboard).
- `structure.visibleControls` lists the **quick-filter** and
  **parameter-control** dashboard objects — **the filters and parameters a
  human user sees and references**. The full filter list is *not* the visible
  set: `getFiltersAsync()` returns every filter on the dashboard, visible or
  hidden. If a filter matters to a user, it will appear in `visibleControls`;
  everything else is under the fold.
- `filters[].appliedWorksheets` tells you whether a filter is dashboard-level
  (applies to many sheets) or sheet-local.

## Addressing a view (URL + host-free slug)

The model carries **both** addressing forms:

- **`asset.url`** (and `structure.sheets[].url`) — the full canonical embed URL
  (e.g. `https://public.tableau.com/views/Superstore-Overview_…/Overview`).
  This is the **easiest match**: when a user hands you a URL, compare it
  directly against these fields to confirm the right view.
- **`asset.urlSlug`** — the host-free slug (the path after `/views/`, e.g.
  `Superstore-Overview_…/Overview`). This is the **portable** identifier: it
  lets an agent combine a user-provided site origin with the slug to rebuild
  an embed URL on any site (`…/t/<site>/views/<slug>`, or
  `https://public.tableau.com/views/<slug>`).

The ideal workflow is the user handing you the URL directly; the slug is the
stable identifier that lets you match a model to a URL on any site. Note that
models derived from a **private** site carry that site's URL — strip to the
slug before sharing a model outside your organization.

## Placeholder notes for example models

Fields the Embedding-only pass cannot fill (`asset.luid`/`owner`/…,
`freshness.anchor`, `fields[].formula`, …) stay `null` and carry a `note` field
explaining that they are **populated by your real environment** when the
derivation runs against a site with a PAT-enabled REST/Metadata pass — never
hard-coded. Read the note, don't treat the null as an error.

## Static vs dynamic — the discipline

- **Trust the model for:** schema, field catalog, layout, parameters and their
  types, filter classification, lineage, identity, freshness.
- **Always read live:** filter **domain values**, range values, current
  parameter values, row counts. The model may carry a labeled sample
  (`samples`), never the live truth.