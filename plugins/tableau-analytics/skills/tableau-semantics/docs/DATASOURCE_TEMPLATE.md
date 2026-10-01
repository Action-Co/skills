# Datasource Semantic Model — Template

Copy this file to `site/<site>/datasources/<DatasourceName>.md` and fill it
in. It is the **behavioral documentation**: the human-owned definition of what
this datasource holds, at what grain, and how it is meant to be used. The
machine-generated facts (fields, types, roles, logical tables, lineage,
freshness) live in the sibling `<DatasourceName>.derived.json` — do **not**
duplicate them here.

> **How to write this file:** follow [WRITING.md](WRITING.md). Keep the
> markdown lean, specific, and true to this datasource. Delete the `<...>`
> placeholders and the "What goes here" notes as you fill them in.
>
> **What does NOT go here:** field catalogs, data types, LUIDs, timestamps,
> domain values, row counts — those are in the derived model or read live.
> This file is the *meaning*, not the inventory.

---

## Purpose

**One paragraph:** what is this datasource, who consumes it, and what is it
the source of truth for?

- **Source system:** <e.g. Salesforce, Snowflake, an extract refreshed nightly>
- **Consumers:** <which workbooks/dashboards/teams query it>
- **Trust level:** <certified / governed / known-good but unofficial>

## Grain & scope

- **Grain:** <one row per ... e.g. one row per opportunity line item>
- **Time coverage:** <e.g. full history back to 2015; daily snapshots>
- **Rows / volume (order of magnitude):** <e.g. ~2M rows; grows ~5k/day — read exact counts live>

## Key fields

Only the fields that carry *meaning* — the ones analysts care about and the
ones that are easy to get wrong:

| Field | Meaning | Notes |
| ----- | ------- | ----- |
| <field name> | <what it represents> | <e.g. "regional rollup — 'NA' includes Mexico"> |
| <field name> | <what it represents> | <e.g. "calculated: expected amount × win probability"> |

## Calculations & derivations

- <e.g. "`Expected Amount` = SUM of open opportunity expected value">
- <e.g. "`Win Rate` is a table calc on the worksheet, not a stored field — query the underlying wins/losses and compute it">

## Known limitations & gotchas

- <e.g. "API Access must be enabled for VDS queries; requires a site admin or content owner with Download Full Data permission.">
- <e.g. "Extract refreshes nightly at 02:00 UTC — data is up to ~26h old.">
- <e.g. "Some columns are hidden; they exist in the schema but are excluded from views.">

---

**Provenance:** Source: <semantic model · behavioral documentation> ·
Freshness: see `<DatasourceName>.derived.json` → `freshness.anchor` ·
Owner: <owner name> · Last reviewed: <date>