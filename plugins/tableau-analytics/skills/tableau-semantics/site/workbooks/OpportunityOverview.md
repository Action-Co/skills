# Salesforce Dashboard Starters: Opportunity Overview — Semantic Model

> **Workbook:** Salesforce Dashboard Starters: Opportunity Overview
> (Tableau Public). Machine facts live in the sibling
> `OpportunityOverview.derived.json`.

## Purpose

Pipeline health dashboard for a Salesforce-backed sales organization — the
"how are we doing this quarter" view. Read by sales leadership and managers to
review the open pipeline, conversion, and where the near-term money is.

- **Audience:** sales leadership, regional managers
- **Decision it supports:** where to focus — which countries/industries are
  likely to close, and where the pipeline is at risk
- **Refresh cadence / expectations:** demo dataset; close dates span Q4 2017
  (Oct–Dec), filtered to the last 3 months by the default relative-date filter

## Key visuals & KPIs

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| Total Opportunities | Expected Amount (open + won), Open Opportunities, Sales (closed) | SUM(Expected Amount), COUNT of open opps, SUM(Sales) over the selected period |
| # of Wins / Win rate | Closed-won count and conversion | wins ÷ (wins + losses); shown per filter state |
| # of Losses / Loss rate | Closed-lost count | losses ÷ (wins + losses) |
| Expected Revenue (daily) | Pipeline + won revenue over time | SUM(Expected Amount) by Close Date; `Chart Type` parameter toggles Daily vs Historic |
| Geographic Distribution | Expected Amount by country/city | SUM(Expected Amount) on a map |
| Industry Size | Opportunities per industry, sized by count, shaded by win rate | CNTD(Opportunity ID) by Industry, shaded by AGG(Win rate) |

## Filters & parameters

- **Close Date (relative date)** — canonical time filter; default is **last 3
  months** (period is visible in the summary since v0.1.1 — `anchorDate`,
  `periodType: months`, `rangeN: 3`, `rangeType: last-n`).
- **Billing Country** — categorical; dashboard-level, applies to all 7
  worksheets. This is the per-country KPI driver.
- **Stage** — categorical; sales pipeline stage
  (Prospecting → Qualification → … → Negotiation/Review → Closed Won/Lost).
- **Salesperson (Full Name), Manager (Name (User)), Product, Industry** —
  categorical quick filters.
- **Chart Type (parameter)** — Daily | Historic for the expected-revenue chart.

## Dashboard mechanics — the "Driving model"

- **Worksheet drivers:** the **charts are clickable** — bars/marks on
  `Expected Revenue (daily)`, `Geographic Distribution`, and `Industry Size`
  drive the `Action (…)` filters that appear on the other worksheets. Selecting
  a mark filters the KPI cards and charts. Drive these by **mark selection**
  (`helpers.selectMarks`), never `applyFilterAsync` on the `Action (…)` filters.
- **Selection actions:** the dashboard's own title text says "★ Charts you can
  click to filter the view" — the intended UX is click-to-filter.
- **Filter propagation:** the quick filters (Close Date, Billing Country,
  Stage, Salesperson, Manager, Product, Industry) are **dashboard-level** —
  they cascade to all worksheets. Confirmed via `appliedWorksheets`.
- **KPI-card shape:** `Total Opportunities` is a **Measure Names / Measure
  Values** sheet — one row per measure (Open Opportunities, Sales, Expected
  Amount), all columns repeated per row. **Read by column name**
  (`rows[0]["SUM(Expected Amount)"]`), never `rows[0]` alone.
- **Reset semantics:** clear the country filter (`clearFilterAsync`) and clear
  any mark selections; `Action (…)` filters return to `isAllSelected: true`.

## Data & lineage

- **Primary datasource(s):** Salesforce Opportunity + related objects. The
  workbook model lists the **referenced fields** the worksheets actually use
  (`OpportunityOverview.derived.json` → `fields`); the full 438-field catalog
  belongs in the datasource semantic model
  (`site/datasources/Opportunities (Salesforce)`), reachable via lineage.
- **Grain:** one row per opportunity.
- **Known data quirks:**
  - `%null%` appears in the relevant domain of `Billing Country` (unattributed
    opportunities). Filtering on it yields an **empty reader with empty
    columns** — skip `%null%` when looping countries.
  - ~$549K of expected revenue has no billing country (incl. $535K already
    won) — the "unattributed" bucket shows as `(no country)` in aggregates.
  - Late-stage pipeline = `Negotiation/Review` + `Proposal/Price Quote` stages
    — the best proxy for near-term close odds.

## Gotchas & aliases

- KPI cards return **one row per measure** (Measure Names pattern) — read by
  column name, never positional index.
- The relative-date period **is now in the snapshot/summary** — read it there;
  if absent (older lib), read `anchorDate`/`periodType`/`rangeN`/`rangeType`
  live via `tableau-viz filter "Close Date"`.
- `Win rate`/`Loss rate` cards show `%null%` for a country with zero losses —
  treat as 0, not a data error.
- The `Chart Type` parameter swaps Daily/Historic — it changes which
  `Expected Revenue (…)` worksheet is active; re-read after changing it.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `OpportunityOverview.derived.json` → `freshness.retrievedAt` · Owner:
Analytics COE · Last reviewed: 2026-09-29