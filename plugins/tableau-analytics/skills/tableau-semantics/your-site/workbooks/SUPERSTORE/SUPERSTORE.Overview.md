# Superstore — Overview — Semantic Model

> **Workbook:** Superstore, `Overview` dashboard. Machine facts live in the
> sibling `SUPERSTORE.Overview.derived.json`.
>
> **Address:** `Superstore-Overview_17909191002920/Overview` — canonical URL in
> `asset.url` of the derived JSON; combine this slug with a user-provided site
> origin at runtime (ideal: the user hands you the URL).

## Purpose

The "how are we doing" view of the Superstore retail business — an executive
overview of revenue, profit, and margin health with a geographic and
product-line split. Read by commercial leadership and sales managers to spot
underperforming regions and product lines before month-end.

- **Audience:** commercial leadership, sales managers
- **Domains:** revenue & margin management; regional sales performance
- **Decision it supports:** where to focus — which states/regions are eroding
  margin, and whether the sales/profit trend is healthy by segment and product
  category
- **Refresh cadence / expectations:** static sample dataset; no scheduled
  refresh detected (see `freshness.anchor` in the derived model). Data spans
  roughly 2023–2026.

## Frequently asked questions (FAQ)

| Question | How to answer it |
| -------- | ---------------- |
| What are the company's headline KPIs right now? | Read the Total Sales card — a Measure Names/Values sheet; read each measure by column name, never `rows[0]`. |
| Which states/provinces have the best margins? | Read the Sale Map marks (one row per state, `AGG(Profit Ratio)`); widen the Profit Ratio slider to its full domain first or the lowest-margin states are hidden. |
| Which states/provinces are the margin watchlist? | Same map read, sorted by Profit Ratio ascending — the bottom states carry negative profit. |
| Which states drive the most revenue? | Aggregate the map's underlying data by `State/Province` (Profit, Sales), or select the state mark and read the KPI cards. |

> These questions are encoded by the `overview-state-ranking` script
> (view-tableau-dashboard's `daily-executive-summary` workflow).

## Key visuals & KPIs

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| Total Sales | Total revenue in the current scope | SUM(Sales) |
| Total Profit | Gross profit in the current scope | SUM(Profit) |
| Quantity | Units sold in the current scope | SUM(Quantity) |
| Average Discount | Discount applied on average | AVG(Discount) |
| Profit Ratio | Margin health — the headline health metric | Calculated field: `SUM(Profit) / SUM(Sales)` |
| Sales per Customer | Average revenue per customer | Calculated field; formula is not exposed to the embedding API — confirm the exact definition with the datasource owner |
| Profit per Order | Average profit per order | Calculated field; same confirmation note as Sales per Customer |
| Sale Map | US states + Canadian provinces colored by margin | `AGG(Profit Ratio)` per State/Province on a map; the color legend doubles as the Profit Ratio range filter |
| Sales by Segment | Monthly sales/profit trend split by customer segment (Consumer / Corporate / Home Office) | SUM(Sales), SUM(Profit) by MONTH(Order Date) x Segment, split by Order Profitable? |
| Sales by Product | Monthly sales/profit trend split by product category (Furniture / Office Supplies / Technology) | SUM(Sales), SUM(Profit) by MONTH(Order Date) x Category, split by Order Profitable? |

## Filters & Parameters

- **Order Date** — range quick filter; dashboard-level. Defaults to the full
  dataset range; narrows every sheet.
- **Region** — categorical quick filter; Central / East / South / West;
  defaults to All. Cascades to every sheet.
- **Profit Ratio** — range quick filter tied to the map's color legend
  (`AGG(Profit Ratio)`); local to the map only. See the gotcha below on its
  default range.
- **Parameters:** none driven on this dashboard. The workbook's parameters
  (New Quota, Commission Rate, Base Salary, Churn Rate, New Business Growth,
  Sort by) belong to the other dashboards (Commission Model, What If Forecast,
  Customers); no parameter control is visible on Overview.

## Interactions (Action Filters)

The **Sale Map is the selection source**. Selecting a state mark fires
`Action (State/Province)` on the KPI cards, the Sales by Segment chart, and the
Sales by Product chart — verified live (a California selection read back
`appliedValues: ["California"]` on all three targets). Drive it with
`selectMarks` on the map; never `applyFilterAsync`.

The derived model also lists five more selection actions
(`Action (Postal Code,State/Province)` on the two bar charts, and the
`Action (MONTH(Order Date),Segment)` / `Action (MONTH(Order Date),Product
Category)` / `Action (Order Profitable?,…,MONTH(Order Date))` cross-filters on
the trend charts and KPI cards). Multi-mark selections on the bar charts did
**not** fire them in live testing — drive the confirmed map interaction, and
verify the bar-chart click behavior with the owner.

## Dashboard mechanics — the "driving model"

The behavioral half: how to get somewhere on this dashboard, not just what
controls exist.

- **To see how one state affects the business** — select that state on the Sale Map; the KPI cards and both trend charts narrow to it (`Action (State/Province)`).
- **To find the margin watchlist** — widen the Profit Ratio slider to its full domain, then read the map's lowest-ratio marks (see the gotcha below).
- **To scope the whole view by region or time** — use the Region and Order Date quick filters; both cascade to every sheet.

Mechanical details:

- **Worksheet drivers:** the Sale Map drives the KPI cards and both trend charts; the trend charts are targets (their own click behavior is unconfirmed — see Interactions).
- **Selection actions:** drive `Action (…)` filters by mark selection on the source, never `applyFilterAsync`.
- **Filter propagation:** Order Date and Region cascade to all four sheets (confirmed: Region=West narrowed the KPI cards, the map, and both charts); `AGG(Profit Ratio)` is local to the map.
- **KPI-card shape:** the top card is a **Measure Names / Measure Values** sheet — one row per measure. Read by column name (`SUM(Sales)`, `SUM(Profit)`, …), never `rows[0]`.
- **Reset semantics:** clear the map's mark selection (`clearSelectedMarksAsync`) so the `Action (…)` filters return to `isAllSelected: true`; clear Region / Order Date to restore the full scope. Confirmed live.

## Data & lineage

- **Primary datasource:** `Sample - Superstore`. Full lineage in
  `SUPERSTORE.Overview.derived.json`.
- **Grain:** one row per order line item (Order ID x Product). Observed live:
  ~10K lines, ~5K distinct orders.
- **Known data quirks:** the map covers the **US and Canada** (provinces), so
  Region filtering of Canadian provinces behaves by province. The Region domain
  is clean (no `%null%` members observed).

## Gotchas & aliases

- KPI cards are **Measure Names / Measure Values** — one row per measure; read
  by column name, never `rows[0]`.
- **Order Profitable?** reads as an applied filter (`isAllSelected: false`,
  `appliedValues: [true, true]`) but data reads still return both profitable
  and unprofitable rows. Treat it as the bar charts' color-split dimension, not
  a hard filter — do not try to apply/clear it to change the view.
- **`AGG(Profit Ratio)`** is the map legend's range slider. Its default range
  clips the low tail (domain floor ~-0.33 vs applied min ~-0.22), so the
  lowest-margin states are hidden until the slider is expanded. It affects the
  map only.
- The selection-action inventory in the derived JSON is orientation — live
  `Action (…)` filter names per sheet can differ (e.g., Total Sales also carries
  `Action (State/Province)`). Read them live before driving.
- The two calculated fields on the KPI card (Sales per Customer, Profit per
  Order) have no formula exposed to the embedding API — confirm their exact
  definitions with the datasource owner before relying on them.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.Overview.derived.json` → `freshness.anchor` · Owner: Analytics
COE · Last reviewed: 2026-10-01
