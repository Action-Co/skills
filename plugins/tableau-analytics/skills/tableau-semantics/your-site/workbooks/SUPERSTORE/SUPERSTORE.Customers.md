# Superstore — Customers Semantic Model

> **Workbook:** Superstore, `Customers` dashboard (titled "Customer Analysis").
> Machine facts live in the sibling `SUPERSTORE.Customers.derived.json`.
>
> **Address:** `Superstore-Customers_17909191689460/Customers` — canonical URL in
> `asset.url` of the derived JSON; combine this slug with a user-provided site
> origin at runtime (ideal: the user hands you the URL).
>
> DRAFT for review — behavioral claims below are grounded in a live session of
> the running viz (2026-10-01); a human owns the final definitions.

## Purpose

Customer-performance dashboard for the Superstore retail business: "which of
our customers are worth the most, and how do they cluster by region". Read by
sales/account management to identify high-value and unprofitable customers,
compare customers across regions, and decide where to invest relationship
effort. The region-driven KPI cards and the customer scatter/rank sit behind
the same three quick filters (Year, Category, Segment), so every customer
figure is always read within that context.

- **Audience:** sales / account management, regional leads
- **Domains:** customer & account management; regional sales
- **Decision it supports:** which customers (by region, category, segment, and
  year) to grow, retain, or renegotiate — driven by sales, profit, profit
  ratio, and sales-per-customer
- **Refresh cadence / expectations:** static sample extract ("Sample -
  Superstore"); no refresh schedule. Treat all numbers as orientation, not
  production data.

## Frequently asked questions (FAQ)

| Question | How to answer it |
| -------- | ---------------- |
| Who are the top customers by sales, per category and segment? | Filter Category + Segment (the two quick filters), read CustomerRank, sort by `SUM(Sales)` desc and take the top N. |
| Which customers are the most / least profitable? | Read CustomerScatter — one mark per customer positioned by sales/profit and colored by Profit Ratio. |
| How do customers cluster by region? | Select a Region cell on the CustomerOverview KPI grid (mark selection, not a filter) — both customer views narrow to that region. |

> These questions are encoded by the `customers-top3` script
> (view-tableau-dashboard's `daily-executive-summary` workflow).

## Key visuals & KPIs

The top KPI grid (**CustomerOverview**) is a Measure Names/Measure Values card
partitioned by Region — **one row per measure per region** (6 measures × 4
regions). It is not a set of independent cards; read it by column name and the
`Measure Values` column, never `rows[0]`.

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| CustomerOverview (KPI grid) — `CNTD(Customer Name)` | Distinct customers in the region | `COUNTD(Customer Name)` |
| CustomerOverview — `SUM(Sales)` | Total revenue in the region | `SUM(Sales)` over order lines |
| CustomerOverview — `SUM(Quantity)` | Total units sold in the region | `SUM(Quantity)` |
| CustomerOverview — `SUM(Profit)` | Total profit in the region | `SUM(Profit)` |
| CustomerOverview — `Sales per Customer` | Average revenue per customer — the headline customer-value figure | calculated field `SUM(Sales) / COUNTD(Customer Name)` (verified live: West 739,813.6 / 686 = 1,078.4) |
| CustomerOverview — `Profit Ratio` | Margin — how profitable the region's business is | calculated field `SUM(Profit) / SUM(Sales)` (verified live: South 46,749.4 / 391,721.9 = 0.119) |
| CustomerScatter (scatter) | One mark per customer positioned by sales and profitability; colored by Profit Ratio (legend present) | `Customer Name` with `SUM(Sales)`, `SUM(Profit)`, `AGG(Profit Ratio)` — all customers (~800) pooled across regions |
| CustomerRank (bar) | Full customer ranking by sales (all customers, not a top-N) | one row per `Customer Name` with `SUM(Sales)` (bar + label), `SUM(Profit)`, `AGG(Profit Ratio)` |

## Filters & Parameters

The canonical controls are the three visible quick filters; all default to
"all selected".

- **Year** — the `YEAR(Order Date)` quick filter; domain 2023–2026; cascades to
  all three sheets.
- **Category** — Furniture / Office Supplies / Technology; cascades to all
  three sheets (verified live: applying Technology narrows both customer views
  from 800 to 687 customers).
- **Segment** — Consumer / Corporate / Home Office; cascades to all three
  sheets.

Two applied (non-visible) filters are **local to CustomerOverview only** and do
not reach the customer views: `QUARTER(Order Date)` (all four quarters
explicitly selected) and `Region` (the partition on the KPI grid). The workbook
carries parameters (`Commission Rate`, `Base Salary`, `Churn Rate`, `New
Business Growth`, `Sort by`, `New Quota`) but none are referenced by these
three sheets — treat them as legacy and do not rely on them.

## Interactions (Action Filters)

One selection action: **`Action (Region)`**, driven from the **CustomerOverview
KPI grid** and applied to **CustomerScatter + CustomerRank**. Selecting a Region
cell on the grid narrows both customer views to that region — verified live
(selecting West takes the scatter from 800 to 686 customers). Drive it with
`selectMarks` on CustomerOverview with `Region`, never `applyFilterAsync`.

The derived JSON associates the action with CustomerScatter, but live testing
overrides that: the true **source is CustomerOverview**, and the action filters
live on the targets. Selecting individual customer marks on the scatter or rank
does **not** fire it.

## Dashboard mechanics — the "driving model"

The behavioral half: how to get somewhere on this dashboard, not just what
controls exist.

- **To rank customers for a category/segment** — set the Category and Segment quick filters, then read CustomerRank (sort by `SUM(Sales)`).
- **To compare a customer's sales against profitability** — read CustomerScatter (one mark per customer, colored by Profit Ratio).
- **To narrow both customer views to a region** — select a Region cell on the CustomerOverview KPI grid; both views narrow to it (`Action (Region)`).

Mechanical details:

- **Worksheet drivers:** CustomerOverview → CustomerScatter + CustomerRank (the only selection behavior observed). The scatter and rank are pure targets.
- **Selection actions:** drive by `selectMarks` on the source worksheet CustomerOverview with `Region`; after a selection the `Action (Region)` filter on both targets reads `isAllSelected: false` with `appliedValues` (e.g. `["West"]`).
- **Filter propagation:** the three visible quick filters cascade to all sheets; `Region` and `QUARTER(Order Date)` are local to the KPI grid.
- **KPI-card shape:** CustomerOverview is a Measure Names/Measure Values grid — **one row per measure per region** (24 rows). Read the `Measure Values` column or the specific measure column by name, never `rows[0]`.
- **Reset semantics:** `clearSelectedMarksAsync` on CustomerOverview; the `Action (Region)` filters return to `isAllSelected: true` and both customer views restore to the full population.

## Data & lineage

- **Primary datasource(s):** `Sample - Superstore` (federated; logical tables
  Orders, People, Returns). Full lineage in `SUPERSTORE.Customers.derived.json`.
- **Grain:** the sheets aggregate order lines up to **one row per customer**
  (within the active filters); the scatter/rank show all distinct customers
  (~800) rather than a top-N.
- **Known data quirks:** per-region customer counts overlap — summing the four
  region `CNTD(Customer Name)` cards (2,508) far exceeds the ~800 distinct
  customers in the pooled views because customers order from multiple regions.
  No `%null%` members appeared in the Category, Segment, Region, or Year domains
  during verification.

## Gotchas & aliases

- **KPI cards are Measure Names rows** — CustomerOverview returns 24 rows (6
  measures × 4 regions); read `Measure Values` or the specific measure column
  by name, never `rows[0]`.
- **`Action (Region)` fires from the KPI grid, not the customer charts** —
  the selection source is CustomerOverview; selecting customer marks on the
  scatter or rank does nothing.
- **The plain `Region` filter on CustomerScatter and CustomerRank is inert** —
  it stays `isAllSelected: true` even while `Action (Region)` is actively
  filtering those sheets. Ignore it; watch `Action (Region)`.
- **Region and Quarter are hidden filters** — only Year / Category / Segment
  are visible quick filters; Region and `QUARTER(Order Date)` are applied
  locals on the KPI grid.
- **Do not sum the region KPI cards** — multi-region customers are double
  counted in `CNTD(Customer Name)`.
- **`Sales per Customer` and `Profit Ratio` are calculated fields** — they are
  ratios, not raw measures; the scatter colors by Profit Ratio.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.Customers.derived.json` → `freshness.anchor` · Owner: Analytics
COE · Last reviewed: 2026-10-01
