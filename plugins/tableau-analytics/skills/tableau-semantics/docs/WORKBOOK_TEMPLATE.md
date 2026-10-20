# Workbook Semantic Model — Template

This template governs how behavioral information about Tableau workbooks is stored
as Markdown. Each workbook may contain multiple views (worksheets and dashboards)
with individual rules, designs, and modes of interaction. Workbooks are therefore
grouped by folder, and each view is described in its own file.

Sample path: `your-site/workbooks/WorkbookName/WorkbookName.ViewName.md`

**Behavioral model**: `your-site/workbooks/WorkbookName/WorkbookName.ViewName.md`
The human-owned definition of what this dashboard is for and how it is meant to be used.

**Derived model**: `your-site/workbooks/WorkbookName/WorkbookName.ViewName.derived.json`
The machine-generated facts (schema, fields, layout, lineage, freshness).

> **How to write this file:** follow [WRITING.md](WRITING.md). Keep the
> markdown lean, specific, and true to this workbook. Delete the example lines
> and the "What goes here" notes as you fill them in.
>
> **What does NOT go here:** field lists, sheet lists, timestamps, LUIDs,
> domain values, row counts — those are in the derived model or read live.
> This file is the *meaning*, not the inventory.
>
> **Addressing this view:** one line with the canonical slug (the path after
> `/views/`, e.g. `Superstore-Overview_…/Overview`). The model's machine half
> carries the full canonical URL (`asset.url`, `structure.sheets[].url`) for
> direct URL matching plus this host-free slug (`asset.urlSlug`) for portable
> addressing — the agent combines the slug with a user-provided site origin at
> runtime (the ideal workflow is the user handing you the URL).

---

## Purpose

**One paragraph:** what is this dashboard for, who uses it, and what decision
does it inform?

- **Audience:** who reads this dashboard
- **Domains:** which business domains rely on this dashboard
- **Decision it supports:** what someone decides from it
- **Refresh cadence / expectations:** how fresh the data is expected to be

## Frequently asked questions (FAQ)

The questions this dashboard is known to answer. Write each the way a user
would actually ask it — the agent matches a live question against these to
recognize that *this* dashboard answers it, and to know how to get the answer
without further instruction. One row per question, with the worksheet(s) and
any driving steps required:

| Question | How to answer it |
| -------- | ---------------- |
| *"How are we doing this quarter?"* | *read the headline KPI card — Measure Names/Values, read by column name* |
| *"Which accounts are most at risk?"* | *filter X, then read the Y worksheet; select the mark on the source sheet, never applyFilterAsync the Action filter* |

Only write questions that are genuinely answerable from this dashboard, and
keep the "how" short — point at the worksheet and the driving steps, not a
full walkthrough. These are the questions the demo scripts encode; if a
reusable script already answers one, reference it by name.

## Key visuals & KPIs

For each headline card or chart, say what it *means* and how it is
*calculated* (when it is not obvious from the field names):

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| KPI name | what it represents | e.g. SUM of closed-won expected amount, latest quarter |
| chart name | what it represents | e.g. count of opportunities by stage |

## Filters & Parameters

Which filters/parameters are **canonical** — the ones users actually drive —
and how do they interact? If they appear listed as "dashboard objects" in the
Embedding API, they are visible to human users and meant for their direct usage.

- **Filter/Parameter name** — what it controls; default state; how it interacts with other filters
- **Filter/Parameter name** — e.g. sets the comparison period for the delta cards; does not affect the pipeline table

## Interactions (Action Filters)

Some worksheets are interactive and can be configured to apply filters to other
sheets and drive other actions on the dashboard. They appear listed as "dashboard
objects" in the Embedding API with names like `Action (Field)`.

When present, you perform the interaction by selecting marks on these worksheets.
Some minimalist dashboards offer no obvious filters and are meant to be driven by
mark selection.

## Dashboard mechanics — the "driving model"

The behavioral half of this file: not just *what* controls exist, but how to get
somewhere with them. Write a recipe per task, question, or domain — for each, which
filters, parameters, and mark selections to drive, and what changes as a result.

- **To model next-quarter commission** — set the **Commission Rate** parameter to the target rate, then read the OTE / quota-attainment worksheet.
- **To forecast churn** — set the **Churn Rate** parameter and compare the forecast worksheet against actuals.
- **To drill into a region** — select the region mark on the map; the KPI cards and pipeline table filter to it (an `Action (Region)` selection action on the target sheets).

Also capture the mechanical details the agent must know:

- **Worksheet drivers** — which sheets drive which others.
- **Selection actions** — `Action (…)` filters on target sheets; drive these by mark selection, never by `applyFilterAsync`.
- **Filter propagation** — which quick filters cascade across sheets vs. stay local to one sheet.
- **KPI-card shape** — cards built on Measure Names / Measure Values return one row per measure; read by column name, never assume `rows[0]` is the answer.
- **Reset semantics** — how to return to a clean state (e.g. clear mark selection; the `Action (…)` filters return to `isAllSelected: true`).

If none of this applies (a fully static dashboard), say so explicitly so the agent
does not go looking for behavior that is not there.

## Data & lineage

Point to the derived model for the full lineage (`WorkbookName.derived.json`). Note
anything the agent should know about the data source that is not obvious:

- **Primary datasource(s):** names — full detail in the derived model
- **Grain:** one row per ...
- **Known data quirks:** e.g. the "NA" region includes Mexico; "%null%" rows are unattributed

## Gotchas & aliases

Known traps, aliases, and things that look wrong but are right:

- e.g. `Billing Country` shows legacy aliases (`USA`) next to current ones (`United States`); always read the "relevant" domain live.
- e.g. KPI cards are Measure Names rows — read by column name, not `rows[0]`.
- e.g. the relative-date filter defaults to the last full quarter; the period is not visible in the snapshot — read it live.

---

**Provenance:** Source: semantic model · behavioral documentation ·
Freshness: see `WorkbookName.derived.json` → `freshness.anchor` ·
Owner: owner name · Last reviewed: date
