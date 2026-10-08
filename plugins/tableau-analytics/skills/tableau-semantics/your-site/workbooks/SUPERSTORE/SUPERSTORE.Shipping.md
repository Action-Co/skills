# Superstore — Shipping Semantic Model

> **Workbook:** Superstore, `Shipping` dashboard. Machine facts live in the
> sibling `SUPERSTORE.Shipping.derived.json` — this file is the meaning, not
> the inventory.
>
> **Address:** `Superstore-Shipping_17909192007120/Shipping` — canonical URL in
> `asset.url` of the derived JSON; combine this slug with a user-provided site
> origin at runtime (ideal: the user hands you the URL).

## Purpose

Operational shipment-performance dashboard for the Superstore retail business:
"how well are we shipping". Read by logistics and fulfillment operations to
monitor whether orders ship early, on time, or late, and to find where delays
cluster (region, ship mode, week) before they compound into customer-facing
problems.

- **Audience:** logistics / fulfillment operations, regional ops leads
- **Domains:** logistics & fulfillment operations; on-time delivery
- **Decision it supports:** where are shipments late and is it getting worse —
  which region / ship mode / time window to investigate, and how large the late
  share is
- **Refresh cadence / expectations:** static sample extract ("Sample -
  Superstore"); no refresh schedule. Treat all numbers as orientation, not
  production data.

## Frequently asked questions (FAQ)

| Question | How to answer it |
| -------- | ---------------- |
| Which shipments are late, and what is the worst delay per ship mode? | Read DaystoShip — the `Shipped Late` line with the highest `SUM(Days to Ship Actual)`. Reset the per-worksheet Order Year/Quarter filters to "all" first or the scan is scoped to the latest quarter. |
| Is on-time shipping getting better or worse? | Read ShippingTrend — weekly `CNT(Orders)` split by Ship Status. |
| What share of orders ship early / on time / late? | Read ShipSummary — proportions by Ship Status (the reads are shares summing to ~1, not counts). |

> These questions are encoded by the `shipping-delays` script
> (view-tableau-dashboard's `daily-executive-summary` workflow).

## Key visuals & KPIs

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| ShippingTrend (area) | Weekly shipment volume split by on-time performance — the headline "is it getting better or worse" view | `CNT(Orders)` by `WEEK(Order Date)`, colored by `Ship Status` (a calculated field: early / on time / late based on ship mode) |
| ShipSummary (donut/bar) | Share of orders by ship status — the on-time rate headline | `CNT(Orders)` by `Ship Status` displayed as a share; reads return proportions summing to ~1.0 (one row per status), not raw counts |
| DaystoShip (table) | Order-line detail behind the trend: actual vs scheduled days to ship, per order line | `Days to Ship Actual` (calc: Ship Date − Order Date) with `Days to Ship Scheduled`, per order line item (Order ID × Product) |

## Filters & Parameters

- **Order Year / Order Quarter** — the two canonical time controls
  (`YEAR(Order Date)` / `QUARTER(Order Date)`); cascade to all three sheets.
  Default state is the latest period (observed 2026 Q4).
- **Region** — cascades to **ShippingTrend and DaystoShip only**; it does **not**
  reach ShipSummary. All regions selected by default.
- **Ship Mode** — cascades to all three sheets (First Class, Same Day, Second
  Class, Standard Class). All selected by default.
- **Ship Status** — an applied (non-visible) filter that cascades from
  DaystoShip to ShipSummary, so the detail table and the distribution stay in
  sync. All statuses selected by default.

## Interactions (Action Filters)

Three selection actions:

- **ShipSummary → ShippingTrend + DaystoShip** — `Action (Ship Status)`. Clicking a status slice on the donut narrows both the trend and the detail table to that status.
- **ShippingTrend → DaystoShip** — `Action (Ship Status,YEAR(Order Date),WEEK(Order Date))`. Clicking a weekly segment narrows the detail table to exactly those status/year/week combinations.
- **`Action (Delayed?)`** — present on ShippingTrend and DaystoShip but it **never fired** in any selection test this session; treat it as legacy and rely on `Action (Ship Status)`.

Drive them by `selectMarks` on the source sheet, never `applyFilterAsync`;
after a selection the `Action (…)` filters read `isAllSelected: false` with
`appliedValues` and the target sheets narrow.

## Dashboard mechanics — the "driving model"

The behavioral half: how to get somewhere on this dashboard, not just what
controls exist.

- **To find the worst delay per ship mode** — read DaystoShip (reset Order Year/Quarter to "all" first, or the scan is scoped to the latest quarter).
- **To see whether on-time shipping is improving** — read ShippingTrend (weekly `CNT(Orders)` by Ship Status).
- **To scope everything to one ship status** — click a slice on ShipSummary (or a weekly segment on ShippingTrend); the trend and/or detail table narrow to it.

Mechanical details:

- **Worksheet drivers:** ShipSummary → ShippingTrend + DaystoShip; ShippingTrend → DaystoShip. DaystoShip is a pure target (selecting its rows does nothing).
- **Selection actions:** drive by `selectMarks` on the source sheet, never `applyFilterAsync`.
- **Filter propagation:** Region reaches 2 sheets (trend + detail); Ship Mode and the time controls reach all 3; Ship Status reaches 2 (detail + summary).
- **KPI-card shape:** ShipSummary is **not** a Measure Names / Measure Values card — it is a single-axis distribution of `CNT(Orders)` by `Ship Status`; reads return one row per status and the values are shares summing to ~1.0. Read by column name, never `rows[0]`.
- **Reset semantics:** `clearSelectedMarksAsync` on the source sheets; the `Action (…)` filters return to `isAllSelected: true`.

## Data & lineage

- **Primary datasource(s):** `Sample - Superstore` (federated; logical tables
  Orders, People, Returns). Full lineage in `SUPERSTORE.Shipping.derived.json`.
- **Grain:** one row per order line item (Order ID × Product).
- **Known data quirks:** `Ship Status` is a calculated field ("Was shipment
  early, ontime or late based on ship mode"). No `%null%` members appeared in
  the relevant domains for Ship Mode, Region, or Ship Status during
  verification.

## Gotchas & aliases

- **ShipSummary reads are proportions, not counts** — the three `CNT(Orders)`
  values sum to ~1.0. Do not interpret them as order volumes.
- **`Action (Delayed?)` is present but unfired** — it was not triggered by any
  mark selection in testing; do not expect it to change.
- **Region does not reach ShipSummary** — filtering Region narrows the trend and
  the detail table but leaves the status-mix donut on the unfiltered
  distribution.
- **Ship Status is a hidden cascade, not a visible quick filter** — it is the
  applied filter shared between DaystoShip and ShipSummary.
- **Same Day is the smallest ship mode** — near-zero `Days to Ship Actual`
  there (0 days) is expected, not a data gap.
- **Selecting rows on DaystoShip does nothing** — the table is a target only.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.Shipping.derived.json` → `freshness.anchor` · Owner: Analytics
COE · Last reviewed: 2026-10-01
