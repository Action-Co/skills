# Superstore — Product Dashboard Semantic Model

> **Workbook:** Superstore, `Product` dashboard. Machine facts live in the
> sibling `SUPERSTORE.Product.derived.json` — read this file for the *meaning*
> and the *driving model*.
>
> **Address:** `Superstore-Product_17909191380680/Product` — canonical URL in
> `asset.url` of the derived JSON; combine this slug with a user-provided site
> origin at runtime (ideal: the user hands you the URL).

## Purpose

Product performance dashboard — "which products and categories make the
money". Read by product and merchandising managers to see revenue and profit
by product family over time, then drill into the per-product detail to decide
where to invest and which products are eroding margin.

- **Audience:** product / merchandising managers, commercial leadership
- **Domains:** product & merchandising performance; category management
- **Decision it supports:** which categories, sub-categories, and products
  drive revenue and profit; where to invest or promote, which products to
  review for margin
- **Refresh cadence / expectations:** embedded sample datasource with no
  extract (see derived model) — treat the data as orientation and verify
  values live

## Frequently asked questions (FAQ)

| Question | How to answer it |
| -------- | ---------------- |
| Which month is the sales peak / trough for each category, in each region? | Filter the Region quick filter, read ProductView (one row per Category × month × year), then aggregate months across years by calendar month. |
| How are the product categories performing over time? | Read ProductView directly — `SUM(Sales)` and `SUM(Profit)` by Category × MONTH × YEAR. |
| Which individual products are eroding margin? | Read ProductDetails — one mark per product, color is `AGG(Profit Ratio)`; narrow it by mark selection on ProductView, never the Category filter. |

> These questions are encoded by the `product-peak-months` script
> (view-tableau-dashboard's `daily-executive-summary` workflow).

## Key visuals & KPIs

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| ProductView (top chart) | Revenue and profit trend per product family over time — the "how are the categories doing" view | SUM(Sales), SUM(Profit) grouped by Category x MONTH(Order Date) x YEAR(Order Date); bars colored by Sales (Sales legend) |
| ProductDetails (bottom, "Product Drilldown") | Per-product scatter/heatmap: one circle per product, positioned by revenue within Sub-Category rows and Segment columns | SUM(Sales) per Product Name; color = AGG(Profit Ratio) (Profit Ratio legend); SUM(Profit) per product |
| Profit Ratio | Margin health of each product — the color scale on the drill-down | AGG of the calculated `Profit Ratio` field (Profit / Sales) |

## Filters & Parameters

- **Region** — the one visible quick filter. Categorical (Central / East /
  South / West), defaults to all selected, and cascades to **both**
  ProductView and ProductDetails.
- **Category** — an applied filter, not a visible control; it is local to
  ProductView only. Applying it narrows the top chart but **does not** narrow
  ProductDetails (the drill-down narrows via mark selection, below).

## Interactions (Action Filters)

Three selection actions on **ProductDetails**, all driven from **ProductView**:
`Action (Category,YEAR(Order Date),MONTH(Order Date))`,
`Action (YEAR(Order Date),MONTH(Order Date))`, and
`Action (YEAR(Order Date),MONTH(Order Date),Product Category)`. Selecting a bar
on ProductView narrows the drill-down to the selected category and time —
verified: selecting Category=Technology set the first action filter to
`isAllSelected: false` and ProductDetails returned only Technology products.
Drive them with `selectMarks` on ProductView, **never** `applyFilterAsync`.

## Dashboard mechanics — the "driving model"

The behavioral half: how to get somewhere on this dashboard, not just what
controls exist.

- **To see the peak/trough month per category in a region** — set the Region quick filter, read ProductView, then aggregate months across years by calendar month.
- **To drill into products eroding margin** — select a bar on ProductView (include the month/year values if you want to constrain time); ProductDetails narrows to that category and time.
- **To compare categories over time** — read ProductView directly (`SUM(Sales)`, `SUM(Profit)` by Category × MONTH × YEAR).

Mechanical details:

- **Worksheet drivers:** ProductView → ProductDetails. The top chart is the selection source; the drill-down pane (titled "Product Drilldown") is the target.
- **Selection actions:** drive by mark selection on ProductView; the `Action (…)` filters on ProductDetails read `isAllSelected: false` with `appliedValues` after a selection.
- **Filter propagation:** the Region quick filter cascades to both sheets; Category is ProductView-local and does not cascade.
- **KPI-card shape:** no Measure Names / Measure Values cards on this dashboard. ProductView returns one row per category-month-year; ProductDetails one row per product. Read both by column name (`SUM(Sales)`, `SUM(Profit)`, `AGG(Profit Ratio)`), not by `rows[0]`.
- **Reset semantics:** clear the mark selection on ProductView (`clearSelectedMarksAsync`); the `Action (…)` filters return to `isAllSelected: true` and the drill-down restores all products.

## Data & lineage

- **Primary datasource(s):** `Sample - Superstore` (embedded). Full lineage in
  `SUPERSTORE.Product.derived.json`.
- **Grain:** underlying Orders data is line-item level; ProductView aggregates
  to Category x month x year, ProductDetails to one row per Product Name
  (within Segment / Sub-Category).
- **Known data quirks:** no `%null%` members observed in the live Category or
  Region domains — both were clean (Furniture / Office Supplies / Technology;
  Central / East / South / West). The `Order Date` range filter on ProductDetails
  also applies to several other workbook sheets — it is a cross-sheet time
  anchor, not local to this dashboard.

## Gotchas & aliases

- Selecting a mark on ProductView by Category alone selects **all** of that
  category's bars across every month/year, so the `Action (…)` filter receives
  many values and the drill-down shows the category across all time. To
  constrain time, include the month/year values in the mark selection.
- The `Action (…)` filters on ProductDetails are selection-driven — do not
  `applyFilterAsync` them; they will not behave like quick filters.
- Applying the Category filter narrows only ProductView; if ProductDetails does
  not change when a Category filter is applied, that is expected — use mark
  selection for the drill-down.
- The Profit Ratio legend colors the ProductDetails scatter; the Sales legend
  accompanies the ProductView chart.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.Product.derived.json` → `freshness.anchor` · Owner: Analytics
COE · Last reviewed: 2026-10-01
