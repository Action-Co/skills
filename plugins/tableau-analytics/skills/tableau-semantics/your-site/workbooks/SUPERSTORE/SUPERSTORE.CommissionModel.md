# Superstore — Commission Model — Workbook Semantic Model

The dashboard title prompts: "Enter new quota, commission rate and base salary
to estimate sales and compensation." Full machine facts (schema, fields, zones,
parameters, lineage) live in the sibling `SUPERSTORE.CommissionModel.derived.json`.

**Address:** `Superstore-Commissions/CommissionModel` — canonical URL in
`asset.url` of the derived JSON; combine this slug with a user-provided site
origin at runtime (ideal: the user hands you the URL).

## Purpose

Compensation-planning "what-if" for the sales organization. Four visible
parameter controls (New quota, Base salary, Commission rate, Sort by) let a
compensation analyst re-model the plan and instantly see how it reshapes
per-rep on-target earnings, quota attainment, projected commission, and total
compensation before committing to a new plan.

- **Audience:** compensation analysts and sales leadership
- **Decision it supports:** setting the next plan's base salary, commission
  rate, and quota — balancing total OTE against projected payout
- **Refresh cadence / expectations:** static plan model over the "Sales
  Commission" datasource; nothing here is time-filtered

## Frequently asked questions (FAQ)

| Question | How to answer it |
| -------- | ---------------- |
| If we change the commission rate, base salary, or quota, how does pay change? | Set the four parameters via `setParameter` (never filters); read the OTE card and CommissionProjection (per-rep total compensation). |
| How many reps would clear 100% of quota at a given quota? | Set New Quota, read QuotaAttainment — `AGG(% of quota achieved)` per rep. Achievement is fixed per rep, so only the quota moves attainment. |
| Who is the top earner / what is the maximum OTE? | Read CommissionProjection — max `AGG(Total Compensation)` per rep; OTE = Base Salary + Commission Rate × New Quota. |

## Key visuals & KPIs

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| Sales — total revenue | Total commissionable sales across the team | SUM of `Sales`; insensitive to all four parameters |
| Sales — % of quota achieved | Average attainment against the **proposed** quota | average of `Achievement (estimated)` / `New Quota` (equals total sales / rep count / New Quota); falls when New Quota rises |
| OTE — avg / total on-target earnings | What a rep earns at exactly 100% of the proposed quota | `Base Salary` + `Commission Rate` × `New Quota`; avg and sum across the 41 reps |
| QuotaAttainment (bars) | One bar per sales rep showing estimated achievement, colored by attainment band | bar = `Achievement (estimated)` (fixed per rep, their actual sales); color band = `Achieved Quota` (Below 50% / 50-75% / 75-100% / 100%+); label = `% of quota achieved`; order driven by `Sort by` |
| CommissionProjection (bars) | Stacked projection of each rep's pay: base plus commission | `Base (Variable)` = `Base Salary`; `Commission (Variable)` = `Achievement (estimated)` × `Commission Rate`; stack total = `Total Compensation` |

## Filters & parameters

There are **no quick filters** on this dashboard — all four visible controls
are parameter pickers, and they are the canonical controls.

- **New quota** — sets the proposed quota (`New Quota`). Re-bases `% of quota
  achieved`, the attainment bands, and OTE (commission at full quota). Does not
  change `Achievement (estimated)`. Range from 100,000, step 25,000.
- **Base salary** — sets the fixed `Base (Variable)` component of every rep's
  `Total Compensation` and of OTE. Default 50,000, step 1,000.
- **Commission rate** — percent commission applied to achievement
  (`Commission (Variable)` = achievement × rate). Also scales OTE. Range 1–100,
  step 0.1; default 18.4.
- **Sort by** — list control (`Names`, `% quota ascending`, `% quota
  descending`) that reorders the QuotaAttainment bars only. Default `Names`.

Two workbook parameters exist but are **not exposed** on this dashboard and
have no effect here: `New Business Growth` (0–1) and `Churn Rate` (0–0.25)
belong to other views in the workbook.

## Dashboard mechanics — the "Driving model"

This dashboard is **parameter-driven and otherwise static**. There are no
selection actions, no mark-selection behaviors, and no quick filters — the
derived model's `selectionActions` is empty and `visibleControls` lists only
the four parameter pickers. No worksheet drives another; all four worksheets
recompute from the same parameter set. The agent should drive changes through
`setParameter` and read results back — never `selectMarks` or
`applyFilterAsync`.

- **KPI-card shape:** the **Sales** and **OTE** cards are Measure Names /
  Measure Values tables returning **one row per measure**. Read each value by
  its column (`Measure Names` → `Measure Values`), never `rows[0]`.
- **CommissionProjection shape:** also a Measure Names table — it returns one
  row per (rep, measure) pair (`min:Base (Variable)` rows interleaved with
  `sum:Commission (Variable)` rows); sum the two per rep or filter by `Measure
  Names` before reading.
- **Reset semantics:** return to baseline by setting the four parameters back
  to their defaults (Base Salary 50,000, Commission Rate 18.4, New Quota
  500,000, Sort by Names).

## Data & lineage

- **Primary datasource(s):** `Sales Commission` (federated, not published, no
  extract). Full detail in `SUPERSTORE.CommissionModel.derived.json`.
- **Grain:** one row per **Sales Person** (41 reps) — a commission-plan/rep
  level model, not order-line data. `Sales Person` is the only dimension in
  use; `Order Date` and `Region` exist in the catalog but are not referenced by
  these worksheets.
- **Known data quirks:** `Achievement (estimated)` is a fixed per-rep value
  (their actual commissionable sales) — it never moves with the parameters;
  only the derived ratios, bands, OTE, and compensation do.

## Gotchas & aliases

- **Measure Names cards:** Sales, OTE, and CommissionProjection return one row
  per measure (per rep+measure for the projection). Read by column name /
  `Measure Names` filter, never `rows[0]`.
- **% of quota achieved is "new-quota relative".** The Sales KPI is average
  attainment against the **proposed** New Quota, not against any historical
  quota — it falls when you raise the quota even though real achievement is
  unchanged. This is expected, not a bug.
- **Commission is linear, uncapped.** Reps above 100% attainment still earn
  `rate × achievement` with no accelerator or cap (observed on reps at 200%+).
- **Commission Rate is a percent (1–100)**, not a 0–1 fraction — setting it to
  `0.1` would round to a ~0% plan, not 10%.
- **Parameters are integers vs floats:** New Quota and Base Salary step by
  1,000 / 25,000 integers; Commission Rate steps by 0.1; the Embedding API
  returns `18.399999999999999` for the default 18.4 — normalize before
  asserting values.
- **Rep count is dynamic (41).** OTE sum = avg × rep count; derive the count
  live from `QuotaAttainment` rather than hard-coding it.

---

**Provenance:** Source: semantic model · behavioral documentation · Freshness:
see `SUPERSTORE.CommissionModel.derived.json` → `freshness.anchor` · Owner:
Analytics COE · Last reviewed: 2026-10-01