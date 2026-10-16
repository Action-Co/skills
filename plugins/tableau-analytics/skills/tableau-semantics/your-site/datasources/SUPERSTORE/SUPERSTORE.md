# Superstore Datasource — Semantic Model

> **Datasource:** `Superstore Datasource` — an Excel-direct connection to
> `Sample - Superstore.xlsx` (tables Orders, People, Returns), published in the
> `Samples` project. Machine facts live in the sibling
> `SUPERSTORE.derived.json`.
>
> **Address:** `SuperstoreDatasource` — canonical page in `asset.webpageUrl` of
> the derived JSON; on this site it is
> `…/site/getaction/datasources/128808841`.

## Purpose

The published order-level sales dataset behind the Superstore demo workbooks:
one row per order line for a fictional US/Canada retailer, covering orders,
customers, products, geography, and returns. It is the source of truth for the
Superstore dashboards (Overview, Customers, Product, Shipping, Order Details,
Performance, What If Forecast) and for ad-hoc analysis the dashboards do not
surface.

- **Source system:** `Sample - Superstore.xlsx` (Excel-direct connection; no extract)
- **Consumers:** the Superstore workbooks (via embedded copies of this schema)
  and ad-hoc analyst queries via `query-tableau-data`
- **Trust level:** sample / demo data — not certified, not a production source of truth
- **Decision it supports:** any commercial question the Superstore dashboards
  answer — margin by region/state, customer value, product performance,
  shipping timeliness, target attainment
- **Refresh cadence / expectations:** a live Excel-direct connection with no
  extract — values track the workbook file; treat as static demo data

## Grain & scope

- **Grain:** one row per order line item (`Order ID` × `Product`) in the
  **Orders** table; `Row ID` is the unique row identifier.
- **Related tables:** **Returns** (join on `Order ID`, via the hidden
  `Order ID (Returns)`) and **People** (regional manager lookup, via `Person` /
  `Region (People)`).
- **Time coverage:** `Order Date` and `Ship Date`; the workbook models observe
  order dates spanning roughly 2023–2026.
- **Rows / volume (order of magnitude):** ~10K order lines (per the workbook
  models) — read exact counts live.

## Key fields

| Field | Meaning | Notes |
| ----- | ------- | ----- |
| Row ID | Unique row identifier | Hidden; per-line surrogate key |
| Order ID | Unique order identifier | Repeats across the lines of one order; join key to Returns |
| Order Date / Ship Date | Order placed / shipped | `Days to Ship` is a *workbook* calc (Ship Date − Order Date), not in this datasource |
| Ship Mode | Shipping class | Standard Class, Second Class, First Class, Same Day |
| Customer ID / Customer Name | Customer identity | `Customer ID` is hidden |
| Segment | Customer class | Consumer, Corporate, Home Office |
| Region / State/Province / City / Postal Code / Country/Region | Geography | Region = Central/East/South/West; the map covers US + Canada |
| Category / Sub-Category | Product taxonomy | Furniture, Office Supplies, Technology |
| Product Name / Product ID / Manufacturer | Product identity | `Product ID` hidden; `Manufacturer` available |
| Sales | Revenue of the order line | REAL, SUM |
| Quantity | Units on the line | INTEGER, SUM |
| Discount | Discount applied to the line | REAL, SUM |
| Profit | Profit of the order line | REAL; can be negative |
| Profit Ratio | Margin of the line | Calculated field — see below |
| Returned / Returns | Return status | From the Returns table; `Order ID (Returns)` hidden |
| Person / Region (People) | Regional manager | From the People table; `Region (People)` hidden |

## Calculations & derivations

- **`Profit Ratio`** — `SUM([Profit]) / SUM([Sales])`; a calculated field in the
  datasource, not a stored column. This is the margin metric the Overview and
  Product dashboards read.
- **`Profit (bin)`** — a bin over `[Profit]` (formula `[Profit]`); an authoring
  helper, not a measure to query directly.
- Workbooks add their own calcs on top of this schema (e.g. `Days to Ship
  Actual`, `Days to Ship Scheduled`, `Order Profitable?`) — those are **not**
  fields of this datasource.

## Known limitations & gotchas

- **Live Excel-direct connection, no extract** — there is no `extractUpdateTime`;
  freshness tracks the workbook file, and the derived model's `freshness.anchor`
  is the datasource's `updatedAt`.
- **`%null%` values appear in categorical domains** — they represent
  unattributed rows, not real members. Read domains live.
- **Hidden fields exist in the schema** — `Row ID`, `Customer ID`, `Product ID`,
  `Order ID (Returns)`, and `Region (People)` are hidden from the query surface
  but present in the metadata.
- **Querying requires VDS API access** — this is a published datasource; VizQL
  Data Service queries need API access enabled (a 401 on introspection means
  access is off, not bad credentials).
- **Not certified, project `Samples`** — sample / demo data, not a governed
  source.
- **No downstream consumers on this site** — the published datasource has no
  downstream workbooks/sheets/dashboards (the workbooks embed their own copy of
  the schema), so lineage downstream is empty.
- **VDS-derived sections are incomplete** — `logicalTableRelationships`,
  `parameters`, and domain `samples` were unavailable at derivation time (the
  VDS API returned `429000 API usage limit reached`); re-run
  [DERIVATION.md](../../docs/DERIVATION.md) once the quota resets.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.derived.json` → `freshness.anchor` · Owner: Analytics COE ·
Last reviewed: 2026-10-07
