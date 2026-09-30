# Superstore — Example Datasource Semantic Model

> **Example:** this is the shipped sample model for the canonical Tableau
> "Sample – Superstore" datasource, included to demonstrate the format.
> Replace it with your own models under `site/<your-site>/`. Full machine
> facts live in the sibling `SUPERSTORE.derived.json`.

## Purpose

Published order-level sales dataset for the Superstore retail business — the
source of truth behind the Superstore workbooks. Queried directly for
ad-hoc analysis that the dashboards do not surface (e.g., late-stage pipeline
style breakdowns, customer-level aggregations, discount analysis).

- **Source system:** Excel extract (Excel-direct connection), refreshed
  nightly at 02:00 UTC by a scheduled extract refresh
- **Consumers:** Superstore workbooks (`site/workbooks/SUPERSTORE.md`),
  ad-hoc analyst queries via `query-tableau-data`
- **Trust level:** governed sample — certified for internal use, not yet a
  corporate source of truth

## Grain & scope

- **Grain:** one row per order line item (Order ID × Product). The `Returns`
  logical table joins on Order ID for returned-item flags.
- **Time coverage:** full history back to 2015; snapshots nightly.
- **Rows / volume (order of magnitude):** ~10K order lines; grows ~50/day —
  read exact counts live.

## Key fields

| Field | Meaning | Notes |
| ----- | ------- | ----- |
| Region | US sales region rollup | `Central`, `East`, `South`, `West` — rollup fixed at publish time |
| State | US state | Map drill-down target; new states appear before static maps update |
| Category / Sub-Category | Product taxonomy | Category = Furniture, Office Supplies, Technology |
| Segment | Customer class | Consumer, Corporate, Home Office |
| Sales / Profit | Revenue and profit per line | Aggregated as SUM in queries |
| Discount | Discount applied to the line | Watch for discount-vs-profit erosion analysis |
| Profit Ratio | Calculated margin | `SUM(Profit) / SUM(Sales)` — not a stored column |

## Calculations & derivations

- **`Profit Ratio`** — `SUM(Profit) / SUM(Sales)`; a calculation in the
  datasource, not a stored column.
- Aggregations are applied at query time via VDS (`function: SUM`); the
  datasource stores raw line-level values.

## Known limitations & gotchas

- **API Access must be enabled** for VDS queries; requires a site admin or
  content owner with "Download Full Data" permission. A 401 on introspection
  means API Access is off, not bad credentials.
- **Extract refresh cadence** means data is up to ~26h old after the nightly
  refresh.
- The **`Returns` logical table** only contains returned orders — joining
  naive can drop non-returned lines; use a left join on Order ID.
- `%null%` values appear in categorical domains — they represent unattributed
  rows, not real members.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.derived.json` → `freshness.anchor` · Owner: Analytics COE ·
Last reviewed: 2026-09-28