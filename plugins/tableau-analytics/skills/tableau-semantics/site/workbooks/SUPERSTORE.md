# Superstore — Example Workbook Semantic Model

> **Example:** this is the shipped sample model for the canonical Tableau
> "Sample – Superstore" workbook, included to demonstrate the format. Replace
> it with your own models under `site/<your-site>/`. Full machine facts live
> in the sibling `SUPERSTORE.derived.json`.

## Purpose

Executive sales performance dashboard for the Superstore retail business —
the "how are we doing" view. Read by the commercial leadership weekly to
review sales, profit, and operational volume, and to spot underperforming
regions and categories before month-end.

- **Audience:** commercial leadership, regional sales managers
- **Decision it supports:** where to focus — which regions/categories are
  underperforming, and whether discounting is eroding profit
- **Refresh cadence / expectations:** extract refreshes nightly at 02:00 UTC;
  expect data up to ~26 hours old

## Key visuals & KPIs

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| Sales | Total revenue in the selected period | SUM(Sales) |
| Profit | Gross profit in the selected period | SUM(Profit) |
| Quantity | Units sold in the selected period | SUM(Quantity) |
| Profit ratio | Margin health; the headline health metric | SUM(Profit) / SUM(Sales) |
| Sales by Category (bar) | Revenue mix across the three product families | SUM(Sales) grouped by Category |
| Profit by Region (map) | Geographic profit distribution | SUM(Profit) by State/Region |
| Monthly trend (line) | Revenue and profit over time | SUM(Sales), SUM(Profit) by Order Date month |

## Filters & parameters

- **Order Date (relative date)** — canonical time filter; drives every card
  and chart. The default period is the last full quarter; the period is
  visible in the snapshot — `anchorDate` / `periodType` / `rangeN` /
  `rangeType`.
- **Region** — categorical filter; setting it narrows everything to a region.
- **Segment** — categorical filter; Consumer / Corporate / Home Office.
- **Compare Region (parameter)** — drives the delta cards; "which region are
  we comparing against". Independent of the Region filter.

## Dashboard mechanics — the "Driving model"

- **Worksheet drivers:** the **Profit by Region map → all sheets** — clicking a state on the map filters the KPI cards, category bars, and trend to that state. This is the main drill-down; it appears as `Action (State)` filters on the target worksheets — do not apply those filters directly, select marks on the map.
- **Selection actions:** the **Sales by Category bars → Monthly Trend** — clicking a bar filters the trend to that category (`Action (Category)`).
- **Filter propagation:** the `Region` / `Segment` quick filters and the `Order Date` relative-date filter are dashboard-level — they cascade to every card and chart. The `Action (…)` filters are selection-driven, not applied by hand.
- **KPI-card shape:** the four KPI cards are one Measure Names sheet — each card returns one row per measure; read by column name (`SUM(Sales)`, `SUM(Profit)`, …), never `rows[0]`.
- **Reset semantics:** clear the mark selection on the map/category chart; the `Action (…)` filters return to `isAllSelected: true`.

## Data & lineage

- **Primary datasource(s):** `Superstore` (published). Full lineage in
  `SUPERSTORE.derived.json`.
- **Grain:** one row per order line item (Order ID × Product).
- **Known data quirks:** `%null%` rows appear in the relevant domain of
  dimension fields — filtering on them yields empty data, skip them. Region
  rollups are fixed at publish time; new states land in the data before the
  dashboard's static maps reflect them.

## Gotchas & aliases

- KPI cards are **Measure Names / Measure Values** tables: each card returns
  one row per measure. Read by column name (`SUM(Sales)`, …), never assume
  `rows[0]` is "the answer".
- The relative-date period **is in the snapshot/summary** — read it there; if
  absent (older lib), read `anchorDate`/`periodType`/`rangeN`/`rangeType`
  live via `tableau-viz filter "Order Date"`.
- State values in the domain may include legacy aliases — use the `"relevant"`
  domain, not the `"database"` domain, when enumerating values to loop over.
- `Ship Mode` contains `Same Day` — always the smallest category; don't
  mistake low revenue there for a data gap.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.derived.json` → `freshness.anchor` · Owner: Analytics COE ·
Last reviewed: 2026-09-30