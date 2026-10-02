# Superstore — Order Details Dashboard Semantic Model

Behavioral documentation for the **Order Details** dashboard of the sample
`Superstore` workbook. Machine facts (schema, layout, filters, lineage,
freshness) live in the sibling `SUPERSTORE.OrderDetails.derived.json` — read
this file for the *meaning* and the *driving model*.

**Address:** `Superstore-OrderDetails_17909192940590/OrderDetails` — canonical
URL in `asset.url` of the derived JSON; combine this slug with a user-provided
site origin at runtime (ideal: the user hands you the URL).

## Purpose

Order-level operational view — the "which order lines are in the pipeline"
dashboard. Read by fulfillment and sales operations to inspect individual
orders, spot slow shipping and unprofitable or heavily discounted lines, and
triage which orders need follow-up.

- **Audience:** fulfillment / sales-operations analysts
- **Decision it supports:** which order lines to chase (long shipping gaps,
  negative-profit or high-discount lines, customers to contact)
- **Refresh cadence / expectations:** embedded `Sample - Superstore` extract;
  Tableau Public — the freshness anchor is null (see derived model), so treat
  data as orientation and verify values live

## Key visuals & KPIs

The dashboard is a single worksheet rendered as a **Measure Names / Measure
Values crosstab**: one row per order line per measure, columns are
`Customer Name`, `Order Date`, `Order ID`, `Ship Date`, `Ship Mode`, plus the
measure column. The seven measures are the "KPI columns" of the table:

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| Sales | Revenue of the order line | `SUM(Sales)` per order line |
| Profit | Margin of the order line (can be negative) | `SUM(Profit)` per order line |
| Profit Ratio | Margin health of the line | SUM of the `Profit Ratio` calc — Profit / Sales (verified per row: e.g. 8.5 / 32.7 = 0.26) |
| Quantity | Units on the line | `SUM(Quantity)` per order line |
| Discount | Discount applied to the line | `SUM(Discount)` per order line |
| Days to Ship Actual | How long shipping actually took | SUM of the `Days to Ship Actual` calc — Ship Date minus Order Date (verified: 1/7 minus 1/3 = 4 days) |
| Days to Ship Scheduled | The target shipping window for the line's ship mode | SUM of the `Days to Ship Scheduled` calc — scheduled-days value tied to Ship Mode (e.g. Standard Class = 6) |

## Filters & parameters

Six quick filters are canonical and all apply to the single worksheet, so each
narrows the whole table. They are listed (and classified) in the derived
model; their *behavior*:

- **Category / Segment / Region / State/Province** — categorical multi-select
  lists; default to all selected. No `%null%` members in the live domains.
- **City** — a large multi-select list. It does **not** necessarily open
  all-selected; the dashboard can present with a non-exhaustive subset of
  cities applied. Read the live applied values, never assume "all".
- **Order Date** — date-range slider; defaults to the full span. Narrowing it
  drops order lines outside the window.

The parameters in the derived model (quota / salary / churn etc.) are not
surfaced as controls on this dashboard and do not affect this view.

## Dashboard mechanics — the "Driving model"

- **Worksheet drivers:** none. The dashboard has a single worksheet; there is
  no sheet-to-sheet driving.
- **Selection actions:** the derived model lists two selection-action filters
  on the worksheet — `Action (Order Profitable?,MONTH(Order Date),Segment)` and
  `Action (Postal Code,State/Province) 1`. Live verification: selecting marks
  on the only embedded worksheet does **not** move them; both stay
  `isAllSelected: true`. The rendered marks carry only Customer Name / Order
  Date / Order ID / Ship Date / Ship Mode / Measure Names / Measure Values —
  none of the action source fields (Order Profitable?, Segment, Postal Code,
  State/Province) are in the marks, even though those fields exist in the
  underlying Orders table. In this published view the actions are inert: do
  not chase them with `applyFilterAsync` and do not expect mark selection to
  drive them.
- **Filter propagation:** every quick filter cascades to the whole table
  (only one target exists). Verified: full state 35,777 marks → `Region=West`
  11,445 → `+ Category=Technology` 3,486; `Order Date` restricted to 2024 →
  7,371.
- **KPI-card shape:** the sheet *is* a Measure Names / Measure Values
  crosstab — one row per measure per order line. Read by column name
  (`Measure Names`, `Measure Values`), never `rows[0]`.
- **Reset semantics:** clear mark selection before reading the table (see
  gotchas); clear quick filters via `clearFilterAsync`/re-applying all values
  to restore the full 35,777-mark state. The inert Action filters are always
  `isAllSelected: true`.

## Data & lineage

- **Primary datasource(s):** `Sample - Superstore` (embedded, extract).
  Full lineage in `SUPERSTORE.OrderDetails.derived.json`.
- **Grain:** one row per order line in the `Orders` table — `Order ID` repeats
  across multiple lines (verified: order `US-2023-112326` spans several rows).
  The crosstab expands each line into seven measure rows.
- **Known data quirks:** no `%null%` members observed in the live Category,
  Region, Segment, or State/Province domains. Order dates span 2023 to 2026 in
  this extract; the full date domain is large and should be read live.

## Gotchas & aliases

- The crosstab returns **one row per measure per order line** — read by column
  name, never `rows[0]`.
- While marks are selected, `readVizData` returns **only the selected marks'**
  rows (verified: after a single-mark selection the reader returned 1 row; the
  full table reappeared after `clearSelectedMarksAsync`). Clear the selection
  before reading the whole table.
- The derived model's two selection actions cannot be triggered from this
  published view — the action source fields are not present in the rendered
  marks. Treat them as authoring leftovers.
- The worksheet carries **two** `Order Date` filters: the visible range slider
  (which actually narrows data) and a hidden categorical filter that reports
  `isAllSelected: false` with no applied values yet does **not** restrict the
  data (verified: row count unchanged). Drive the range slider; ignore the
  categorical one.
- Measure Names surface as fully-qualified field ids in raw reads; friendly
  labels are Sales, Profit, Profit Ratio, Quantity, Discount, Days to Ship
  Actual, Days to Ship Scheduled.
- The workbook parameters in the derived model belong to other (unpublished)
  sheets, not this dashboard.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.OrderDetails.derived.json` → `freshness.anchor` · Owner:
Analytics COE · Last reviewed: 2026-10-01