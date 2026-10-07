# Superstore — What If Forecast (Worksheet) Semantic Model

> Behavioral documentation for the **What If Forecast** worksheet in the
> Superstore workbook. Machine facts (schema, filters, parameters, lineage,
> freshness) live in the sibling `SUPERSTORE.WhatIfForecast.derived.json`.
>
> **Address:** `Superstore-WhatIfForecast_17909193312070/WhatIfForecast` —
> canonical URL in `asset.url` of the derived JSON; combine this slug with a
> user-provided site origin at runtime (ideal: the user hands you the URL).

## Purpose

Scenario-planning worksheet: it compares **actual sales** against a **scenario
sales forecast** (a "what if" projection driven by growth and churn
assumptions) across region, segment, and month. Read by commercial planners to
answer: "if new business grows at `X%` and we churn at `Y%`, where would sales
land relative to today's actuals — and which regions/segments would fall short
of the scenario?"

- **Audience:** commercial planners, finance, regional sales managers
- **Decision it supports:** whether a growth/churn scenario is credible given
  recent actuals, and where the gap to the scenario concentrates
- **Refresh cadence / expectations:** static sample datasource; the forecast
  responds instantly to the two scenario parameters, not to a data refresh

## Frequently asked questions (FAQ)

| Question | How to answer it |
| -------- | ---------------- |
| If new business grows X% and churn is Y%, what would sales be? | Set New Business Growth and Churn Rate via `setParameter` (fractions, 0–1), read the worksheet; forecast = `SUM(Sales) × (1 + growth) × (1 − churn)`. |
| Which scenario is credible relative to current actuals? | Compare total forecast to `SUM(Sales)` actuals ACROSS scenarios — the multiplier is constant per cell, so the region ranking never changes within a scenario. |

> Note: this worksheet is documented for reference; it is not part of the
> `daily-executive-summary` demo workflow.

## Key visuals & KPIs

A monthly line view of actual vs scenario forecast, one pane per
Region × Segment, months rendered 1–12 (aggregated across the selected years).

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| Sales | Actual revenue for the cell | SUM(Sales) |
| Sales Forecast | Scenario projection of revenue | Observed behavior: exactly `SUM(Sales) × (1 + New Business Growth) × (1 − Churn Rate)`. At defaults (0.6 / 0.064) this is a constant 1.498× across every one of the 288 cells; reproduced after each parameter probe |
| Forecast gap | Over/under vs the scenario | `SUM(Sales) − SUM(Sales Forecast)`, exposed as the `AGG(SUM(Sales)-SUM(Sales Forecast))` column — negative wherever the forecast exceeds actuals |

## Filters & parameters

- **Order Date (range)** — canonical time window; drives the worksheet. Note it
  is shared with many other sheets in the workbook (see the derived JSON
  `filters.applied` `appliedWorksheets`), so narrowing it here narrows those
  sheets too.
- **Region** — categorical; defaults to all (Central / East / South / West).
  Confirmed live: restricting to one region drops the data to that region only.
- **YEAR(Order Date)** — categorical; defaults to all (2023–2026). Selects which
  years contribute to the month-of-year aggregates.
- **Measure Names** — locked to Sales + Sales Forecast only; not user-driven.
- **New Business Growth** and **Churn Rate** — the two parameters that actually
  drive this worksheet: they set the forecast multiplier. Both confirmed live
  (changing either changes the forecast data). The other workbook-level
  parameters (New Quota, Commission Rate, Base Salary, Sort by) do **not**
  affect this worksheet — verified by setting each and reading the data back
  unchanged. Full parameter catalog in the derived JSON.

## Dashboard mechanics — the "Driving model"

- **Standalone worksheet, not a dashboard.** No zones, no dashboard objects, no
  selection actions — `filters.selectionActions` is empty and no `Action (…)`
  filter appears on the sheet. **Static except for its own filters and the two
  scenario parameters**; there is nothing to select or drill into.
- **Read shape:** Measure Names / Measure Values — every row is one measure
  (Sales or Sales Forecast), so `readVizData` returns two rows per
  Region × Segment × month. Read by column name (`SUM(Sales)`, `SUM(Sales
  Forecast)`, `AGG(...)`), never `rows[0]`. Full-width read: 4 regions × 3
  segments × 12 months × 2 measures = 288 rows.
- **Reset semantics:** the four worksheet filters all default to their full
  domain; clearing them returns the 288-row view.

## Data & lineage

- **Primary datasource(s):** `Sample - Superstore` (federated). Full lineage in
  `SUPERSTORE.WhatIfForecast.derived.json`.
- **Grain:** one row per Region × Segment × month-of-year × measure (Sales /
  Sales Forecast).
- **Known data quirks:** MONTH(Order Date) is **month-of-year**, not a
  continuous time axis — all selected years are aggregated into months 1–12.
  The forecast covers all 12 months of every year (including past months), so
  narrowing the year/range trims little; confirmed a 2026-only range dropped
  only 4 of 288 rows.

## Gotchas & aliases

- **The forecast is not a statistical forecast** — it is a scenario multiplier
  on actuals. At default parameters it runs ~1.5× actual everywhere; the
  persistent gap is the scenario assumption, not a data problem.
- **The visual spec is unreadable through the Embedding API for this
  worksheet** — `getVisualSpec` / `getVisualSpecificationAsync` throw
  `Enum Mapping not found for: month`. Infer the chart structure from the
  summary columns and data shape instead.
- **Measure names are LUID-qualified field IDs** (e.g.
  `[federated.…].[sum:Sales:qk]`, `[…].[sum:Calculation_5421109230915137:qk]`
  for the forecast). Match on the `fieldId` suffix, never a bare display name.
- **Measure Names / Measure Values shape** — two rows per cell; read each
  measure by column name, never `rows[0]`.
- The forecast column is a calculated field; the exact formula was not read from
  metadata (no PAT pass) — the `SUM(Sales) × (1 + growth) × (1 − churn)`
  relationship is **observed**, verified across every cell and every parameter
  probe. A human owner should confirm the field definition.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.WhatIfForecast.derived.json` → `freshness.anchor` · Owner:
Analytics COE · Last reviewed: 2026-10-01