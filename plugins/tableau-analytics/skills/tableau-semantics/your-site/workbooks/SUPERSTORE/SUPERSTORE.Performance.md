# Superstore — Performance (Worksheet) Semantic Model

> **Workbook:** Superstore, `Performance` worksheet (standalone sheet, not a
> dashboard). Machine facts live in the sibling
> `SUPERSTORE.Performance.derived.json`.
>
> **Address:** `Superstore-Performance_17909203588290/Performance` — canonical
> URL in `asset.url` of the derived JSON; combine this slug with a user-provided
> site origin at runtime (ideal: the user hands you the URL).

## Purpose

The **Performance** sheet is a standalone worksheet (not a dashboard) that
tracks actual sales against sales target, month by month, broken down by
segment and category. It is the "are we hitting our numbers" view for the
Superstore commercial business — a cross-tab you read across rows rather than
a clickable dashboard.

- **Audience:** regional sales managers and commercial leadership
- **Domains:** sales performance vs target
- **Decision it supports:** which segment × category × month combinations are
  running below target and by how much, so effort can be re-directed before
  the quarter closes
- **Refresh cadence / expectations:** the sheet reads live from the
  `Sample - Superstore` and `Sales Target` federated datasources (no extracts
  observed); freshness anchor in the derived model

## Frequently asked questions (FAQ)

| Question | How to answer it |
| -------- | ---------------- |
| Are we hitting our sales targets? | Read the matrix (one row per year-month × segment × category) with `SUM(Sales)` vs `SUM(Sales Target)`; the delta column is the over/under in dollars. |
| Which categories are furthest above or below target each year? | Filter `YEAR(Order Date)` per year, aggregate the delta by Category; the biggest positive/negative are the outliers. |
| What was the sharpest single miss? | The row (month × segment × category) with the most negative delta. |

> These questions are encoded by the `performance-outliers` script
> (view-tableau-dashboard's `daily-executive-summary` workflow).

## Key visuals & KPIs

The sheet is one cross-tab (text table): row headers are `YEAR(Order Date)`,
`MONTH(Order Date)`, `Segment`, `Category`; the measure columns sit next to
them. Every row carries actual, target, the dollar delta, and an above/below
flag.

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| `SUM(Sales)` | Actual revenue for that month/segment/category | SUM of `Sales` from `Sample - Superstore` |
| `SUM(Sales Target)` | The revenue target for the same combination | SUM of `Sales Target` from the `Sales Target` datasource |
| Delta (the `SUM([Sales])-SUM([Sales Target].[Sales Target])` column) | Over/under target in dollars | `SUM(Sales)` minus `SUM(Sales Target)` for the row |
| `Sales above Target?` | Per-row pass/fail status | Aggregated string measure; `Above Target` / `Below Target` (observed both) |

Note the layout is a performance **matrix**, not a trend chart: one row per
year-month, segment and category, with no time series smoothing or ranking.

## Filters & Parameters

The sheet's own filters are the only controls it exposes (no quick-filter
dashboard objects, no parameter pickers on this sheet):

- **Region** — categorical, applied to `Performance` only. Defaults to all
  selected (`Central` / `East` / `South` / `West`); narrowing it re-aggregates
  the whole matrix to that region. Verified live: applying `West` changes the
  returned rows.
- **YEAR(Order Date)** — categorical, applied to `Performance` only. Defaults
  to all selected (years 2023–2026 observed); narrowing it restricts the
  matrix to the chosen years. Verified live: applying `2025` drops the other
  years' rows.

The workbook-global parameters (`Base Salary`, `Commission Rate`, `Sort by`,
`New Business Growth`, `Churn Rate`, `New Quota`) appear in the derived model
because they are workbook-scoped, but they belong to the **Commission Model**
sheet and do not affect this one — ignore them here.

## Interactions (Action Filters)

None. This is a standalone worksheet: the derived model's `selectionActions` is
empty, there are no dashboard zones, and no `Action (…)` filter appears on the
sheet. Clicking marks does nothing to any other sheet. The only way the view
changes is through its two applied filters (`Region`, `YEAR(Order Date)`).

## Dashboard mechanics — the "driving model"

The behavioral half: how to get somewhere on this sheet, not just what controls
exist. It is **static except for its two filters** — there is nothing to select
or drill into.

- **To check target attainment** — read the matrix (`SUM(Sales)` vs `SUM(Sales Target)`) and the delta column.
- **To find a year's biggest misses** — filter `YEAR(Order Date)`, aggregate the delta by Category; the largest negatives are the outliers.

Mechanical details:

- **Worksheet drivers:** none — it is a worksheet, not a dashboard; no sheet drives or is driven.
- **Selection actions:** none (see Interactions).
- **Filter propagation:** the two filters (`Region`, `YEAR(Order Date)`) apply to this sheet only.
- **KPI-card shape:** no Measure Names / Measure Values cards; it is a single cross-tab. Read measure columns by name, never by position.
- **Reset semantics:** clear the `Region` and `YEAR(Order Date)` filters (back to `isAllSelected: true`) to return to the full matrix.

## Data & lineage

- **Primary datasource(s):** `Sample - Superstore` (Orders) cross-datasource
  joined with `Sales Target` — full lineage and datasource ids in
  `SUPERSTORE.Performance.derived.json`.
- **Grain:** one row per year-month × segment × category, with all regions
  rolled up. `Region` is a filter, not a matrix dimension. Of the 432 possible
  combinations (4 years × 12 months × 3 segments × 3 categories), 428 were
  observed — a few cells have no data.
- **Known data quirks:** the delta and `Sales above Target?` flag are computed
  across the two datasources — a negative delta means below target, and the
  flag simply signs it. Target values are whole-dollar ints while actuals are
  floats.

## Gotchas & aliases

- The **visual specification could not be read over the embedding protocol**
  in this session (an enum-mapping error on `month`). The cross-tab structure
  above is inferred from the live summary columns and the returned data shape
  — confirm the exact shelf layout if you rely on it.
- The derived model lists `fields: []` for worksheet-type views — that is a
  derivation limitation, not reality. Use the live summary columns
  (`getSummaryColumnsInfoAsync` / the columns above) as the authoritative
  catalog.
- Read measure columns **by column name** (`SUM(Sales)`, `SUM(Sales Target)`,
  the delta column, `Sales above Target?`), never by position.
- `Region` and `YEAR(Order Date)` **domains are dynamic** — read them live
  before looping filter values; the derived `samples` block is orientation
  only.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.Performance.derived.json` → `freshness.anchor` · Owner:
Analytics COE · Last reviewed: 2026-10-01
