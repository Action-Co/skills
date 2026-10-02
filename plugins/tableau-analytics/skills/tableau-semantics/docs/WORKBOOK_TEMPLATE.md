# Workbook Semantic Model — Template

Copy this file to `site/<site>/workbooks/<WorkbookName>.md` and fill it in.
It is the **behavioral documentation**: the human-owned definition of what
this dashboard is for and how it is meant to be used. The machine-generated
facts (schema, fields, layout, lineage, freshness) live in the sibling
`<WorkbookName>.derived.json` — do **not** duplicate them here.

> **How to write this file:** follow [WRITING.md](WRITING.md). Keep the
> markdown lean, specific, and true to this workbook. Delete the `<...>`
> placeholders and the "What goes here" notes as you fill them in.
>
> **What does NOT go here:** field lists, sheet lists, timestamps, LUIDs,
> domain values, row counts — those are in the derived model or read live.
> This file is the *meaning*, not the inventory.

> **Addressing this view:** one line with the canonical slug (the path after
> `/views/`, e.g. `Superstore-Overview_…/Overview`). The model's machine half
> carries the full canonical URL (`asset.url`, `structure.sheets[].url`) for
> direct URL matching plus this host-free slug (`asset.urlSlug`) for portable
> addressing — the agent combines the slug with a user-provided site origin at
> runtime (the ideal workflow is the user handing you the URL). If the model is
> derived from a private site, keep only the slug here.

---

## Purpose

**One paragraph:** what is this dashboard for, who uses it, and what decision
does it inform?

- **Audience:** <who reads this dashboard>
- **Decision it supports:** <what someone decides from it>
- **Refresh cadence / expectations:** <how fresh the data is expected to be>

## Frequently asked questions (FAQ)

The questions this dashboard is known to answer. Write each the way a user
would actually ask it — the agent matches a live question against these to
recognize that *this* dashboard answers it, and to know how to get the answer
without further instruction. One row per question, with the worksheet(s) and
any driving steps required:

| Question | How to answer it |
| -------- | ---------------- |
| <"How are we doing this quarter?"> | <read the headline KPI card — Measure Names/Values, read by column name> |
| <"Which accounts are most at risk?"> | <filter X, then read the Y worksheet; select the mark on the source sheet, never applyFilterAsync the Action filter> |

Only write questions that are genuinely answerable from this dashboard, and
keep the "how" short — point at the worksheet and the driving steps, not a
full walkthrough. These are the questions the demo scripts encode; if a
reusable script already answers one, reference it by name.

## Key visuals & KPIs

For each headline card or chart, say what it *means* and how it is
*calculated* (when it is not obvious from the field names):

| Visual / KPI | Meaning | How it is calculated |
| ------------ | ------- | -------------------- |
| <KPI name> | <what it represents> | <e.g. SUM of closed-won expected amount, latest quarter> |
| <chart name> | <what it represents> | <e.g. count of opportunities by stage> |

## Filters & parameters

Which filters/parameters are **canonical** — the ones users actually drive —
and how do they interact?

- **<Filter/Parameter name>** — <what it controls; default state; how it interacts with other filters>
- **<Filter/Parameter name>** — <e.g. "sets the comparison period for the delta cards; does not affect the pipeline table">

## Dashboard mechanics — the "Driving model"

How does the dashboard *behave* when clicked? Which worksheets drive which
others? This is the knowledge a human usually hands you verbally — write it
down here so the agent does not have to probe. This section is the **driving
model**: the five criteria below are a checklist — if any apply to this
workbook, describe them. If none apply (a fully static dashboard), say so
explicitly so the agent does not go looking for behavior that is not there.

1. **Worksheet drivers** — which sheets drive which others (e.g. "clicking a country on the map filters the pipeline and KPI cards").
2. **Selection actions** — click behavior and the resulting `Action (…)` filters on target sheets; the agent must drive these by mark selection, never by `applyFilterAsync`.
3. **Filter propagation** — which quick filters cascade across sheets vs. stay local to one sheet.
4. **KPI-card shape** — cards built on Measure Names / Measure Values return **one row per measure**; the agent must read by column name, never assume `rows[0]` is "the answer".
5. **Reset semantics** — how to return to a clean state (e.g. clear mark selection; the `Action (…)` filters return to `isAllSelected: true`).

- **<Source sheet> → <target sheets>** — <e.g. "clicking a country on the map filters the pipeline and KPI cards">
- **<any selection-driven behavior>** — <describe>
- **<cross-sheet filter propagation>** — <describe if known>
- **<KPI-card shape>** — <e.g. "the top row of cards is one Measure Names sheet; read each measure by column name">



## Data & lineage

Point to the derived model for the full lineage
(`<WorkbookName>.derived.json`). Note anything the agent should know about the
data source that is not obvious:

- **Primary datasource(s):** <names — full detail in the derived model>
- **Grain:** <one row per ...>
- **Known data quirks:** <e.g. "the 'NA' region includes Mexico; '%null%' rows are unattributed">

## Gotchas & aliases

Known traps, aliases, and things that look wrong but are right:

- <e.g. "`Billing Country` shows legacy aliases (`USA`) next to current ones (`United States`); always read the 'relevant' domain live.">
- <e.g. "KPI cards are Measure Names rows — read by column name, not `rows[0]`.">
- <e.g. "The relative-date filter defaults to the last full quarter; the period is not visible in the snapshot — read it live.">

---

**Provenance:** Source: <semantic model · behavioral documentation> ·
Freshness: see `<WorkbookName>.derived.json` → `freshness.anchor` ·
Owner: <owner name> · Last reviewed: <date>