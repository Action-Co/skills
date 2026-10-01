---
name: tableau-semantics
description: Use this skill to access a local semantic model for Tableau workbooks and datasources. This will accelerate your work with Tableau artifacts by providing a head start on understanding the schema, layout, fields, parameters, filters, and lineage of the artifacts before you touch it. These instructions helpm you avoid duplicate exploratory work and avoid common pitfalls that would otherwise be undocumented. This skill does not contain the entire Tableau data catalog, only assets that have been approved and curated for agents.
license: Apache 2.0
metadata:
  authors: "ip-agent-skills@action.co"
  versions: "0.1.0"
  tags: ["tableau", "semantics", "semantic model", "governance", "metadata", "catalog", "BI", "business intelligence"]
---

# Tableau Semantics

A governed, per-asset **semantic model** for Tableau workbooks and datasources.
When a model exists for an asset, the agent reads it **before** interacting
with the live asset — it starts prepared instead of discovering the dashboard's
meaning at runtime. Both `query-tableau-data` and `view-tableau-dashboard`
reference this layer so semantics stay consistent across the two access paths.

## The two-part model

A semantic model is **two files per asset**, stored side by side (same base
name, different suffix, so they sort next to each other):

| File | Author | Content |
| ---- | ------ | ------- |
| `<Asset>.md` | human + agent | **Behavioral documentation**: what the dashboard is for, who uses it, what each KPI means, canonical filters/parameters, how worksheets drive each other, gotchas |
| `<Asset>.derived.json` | machine-generated | **Derived semantic model**: the static metadata snapshot pulled from the Embedding, REST, and Metadata APIs — schema, fields, layout, parameters, filters, lineage, freshness anchor |

The `.md` is the human-owned definition of intent; the `.derived.json` is the
machine-owned snapshot of fact. Neither is a substitute for the live system —
both are a head start. The queries that produce the derived file are documented
in [docs/DERIVATION.md](docs/DERIVATION.md), so any agent can regenerate it.

## Layout

Semantic models live under the skill, organized **per site** (Tableau
deployments often have more than one). Rename the `site/` folder to match the
customer's actual site when deploying; the shipped skill keeps the generic
name:

```text
tableau-semantics/
├── SKILL.md
└── site/                     # one folder per Tableau site — rename to the real site
    ├── datasources/          # semantic models for published datasources
    │   ├── <Datasource>.md
    │   └── <Datasource>.derived.json
    └── workbooks/            # semantic models for workbooks/dashboards
        ├── <Workbook>.md
        └── <Workbook>.derived.json
```

Only the **canon** is documented: assets enter the model when someone cares
enough to document them. Undocumented assets are not in the model — agents
explore them the normal way.

## Agent workflow

1. **Load.** Before interacting with a workbook or datasource, check
   `site/<site>/workbooks/<name>.md` or `site/<site>/datasources/<name>.md`
   (+ the sibling `.derived.json`). If it exists, read it first. Report its
   key facts to the user: what the asset is, its freshness, and the
   static/dynamic split below. To answer "what filters/parameters does the
   human user see and reference?", read `structure.visibleControls` — the
   quick-filter and parameter-control dashboard objects. The filter list is
   *not* the visible set (it includes hidden filters). See
   [docs/READING_THE_MODEL.md](docs/READING_THE_MODEL.md).
2. **Check freshness.** Compare the model's `freshness.anchor` (the source
   asset's `updatedAt`) to the asset's current `updatedAt` via the REST API
   (see [docs/DERIVATION.md](docs/DERIVATION.md) §2). If the model is stale,
   flag it, regenerate the derived file, and commit the updated model. A
   `null` anchor (e.g., Tableau Public) means no detectable refresh schedule —
   treat the model as orientation and verify live.
3. **Prepare.** Use the model to know the sheets, fields, filters, parameters,
   mechanics, and lineage before opening the viz or writing a query.
4. **Interact.** Drive the viz via `view-tableau-dashboard` or query via
   `query-tableau-data`.
5. **Fact-check live.** The model is a head start, not a substitute. **Dynamic
   values are always read live** (see below). If anything in the model
   contradicts what you observe, trust the live system and note the drift.

## Static vs dynamic — what the snapshot holds

The snapshot captures what is **mostly static**. It does not capture what
changes with every data refresh:

| Category | Example | In the snapshot? |
| -------- | ------- | ---------------- |
| Schema / field catalog | columns, roles, aggregations, data types | ✅ yes |
| Visual layout | sheets, zones, worksheet composition | ✅ yes |
| Parameters & their types | `Compare Region` | ✅ yes |
| Dashboard mechanics | filters, selection-driven actions | ✅ yes (`.md`) |
| Datasource lineage | workbook → datasource → table/column | ✅ yes |
| Workbook identity + freshness | name, LUID, `updatedAt` | ✅ yes |
| **Filter/domain values** | state list, country list, row counts | ⚠️ sample only — **verify live** |

**Rule:** filter domain values, range values, current parameter values, and
row counts change as often as the data refreshes — **always pull them live**,
never trust the snapshot. The model may carry a small sample for orientation;
the agent confirms it against the live system.

## Freshness anchor & staleness

- The source exposes the workbook's `updatedAt` via the REST API.
- The model records it as `freshness.anchor`.
- If the anchor is older than the asset's current `updatedAt`, the model is
  **stale** → regenerate the derived file from source (the queries in
  [docs/DERIVATION.md](docs/DERIVATION.md) are the exact calls) and commit.

This works because the *schema, layout, fields, and visual components* are
static relative to the *data*. Drift in the model is expected and acceptable —
the agent detects it and refreshes on demand.

## Lineage fallback

If a task needs data that is not reachable through the dashboard itself (not
formatted that way, not surfaced), use the lineage recorded in the derived
model (workbook → embedded datasource → published datasource → table/column)
to continue exploration at the source datasource.

## Docs

- [docs/README.md](docs/README.md) — documentation index
- [docs/WORKBOOK_TEMPLATE.md](docs/WORKBOOK_TEMPLATE.md) — behavioral model template for a workbook
- [docs/DATASOURCE_TEMPLATE.md](docs/DATASOURCE_TEMPLATE.md) — behavioral model template for a datasource
- [docs/WRITING.md](docs/WRITING.md) — how to write and maintain semantic models
- [docs/READING_THE_MODEL.md](docs/READING_THE_MODEL.md) — how to read a derived model JSON, including what the nulls mean
- [docs/DERIVATION.md](docs/DERIVATION.md) — the exact REST, GraphQL, and Embedding API queries that produce the derived model (refresh is always available)