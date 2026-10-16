---
name: tableau-semantics
description: Use this skill to access a local semantic model for Tableau workbooks and datasources. This will accelerate your work with Tableau artifacts by providing a head start on understanding the schema, layout, fields, parameters, filters, and lineage of the artifacts before you touch it. These instructions help you avoid duplicate exploratory work and avoid common pitfalls that would otherwise be undocumented. This skill does not contain the entire Tableau data catalog, only assets that have been approved and curated for agents.
license: Apache 2.0
metadata:
  authors: "ip-agent-skills@action.co"
  version: "0.1.0"
  tags: ["tableau", "semantics", "semantic model", "governance", "metadata", "catalog", "BI", "business intelligence"]
---

# Tableau Semantics

A governed, per-asset **semantic model** for Tableau workbooks and datasources.
When a model exists for an asset, the agent reads it **before** interacting
with the live asset — it starts prepared instead of discovering the dashboard's
meaning at runtime. Both `query-tableau-data` and `view-tableau-dashboard`
reference this layer so semantics stay consistent across the two access paths.

**Read it first — mandatory when a model exists.** Skipping it means re-deriving
schema, layout, filters, parameters, and lineage through live calls: slower, lossier,
and it re-introduces the pitfalls the model already records. The model is a head start,
not a substitute — static facts come from the model, dynamic values are always read
live ([docs/READING_THE_MODEL.md](docs/READING_THE_MODEL.md)).

## The two-part model

A semantic model is **two files per asset**, stored side by side (same base
name, different suffix, so they sort next to each other):

| File | Author | Content |
| ---- | ------ | ------- |
| `<Asset>.md` | human + agent | **Behavioral documentation**: what the dashboard is for, who uses it, what each KPI means, canonical filters/parameters, how worksheets drive each other, gotchas |
| `<Asset>.derived.json` | machine-generated | **Derived semantic model**: the static metadata snapshot pulled from the Embedding, REST, and Metadata APIs — schema, fields, layout, parameters, filters, lineage, freshness anchor |

The `.md` is the human-owned definition of intent; the `.derived.json` is the
machine-owned snapshot of fact. The queries that produce the derived file are 
documented in [docs/DERIVATION.md](docs/DERIVATION.md), so any agent can regenerate it.

## Layout

The skill ships the **derivation tooling**, the **docs**, and a **`your-site/`** folder
that holds the models. `your-site/` is a **placeholder** for one Tableau site — rename it
to the site's content URL when you adopt the skill (add a sibling folder per extra site).
The convention is documented in [docs/WRITING.md](docs/WRITING.md).

```text
tableau-semantics/
├── SKILL.md                  # this runbook
├── README.md                 # human-facing overview + getting started
├── .env.template             # REST/Metadata credentials — copy to .env (see below)
├── docs/                     # deep-dives — read the one you need (table below)
├── scripts/                  # derivation tooling (below)
└── your-site/                # the semantics — rename this to your site's content URL
    ├── datasources/
    │   └── <Datasource>/
    │       ├── <Datasource>.md             # behavioral (human + agent)
    │       └── <Datasource>.derived.json   # derived (machine)
    └── workbooks/
        └── <Workbook>/
            ├── <Workbook>.<View>.md             # behavioral (human + agent)
            └── <Workbook>.<View>.derived.json   # derived (machine)
```

**Finding a model.** Match the asset you were handed to a file under your site folder.
Datasources and workbooks each get a **folder per asset** — datasources
(`<site>/datasources/<Datasource>/`), workbooks (`<site>/workbooks/<Workbook>/`) — so a
large catalog stays navigable. Every model is a **pair**: the `.md` (behavioral) beside
its `.derived.json` (machine).

**Supporting files:**

| Path | What it is |
| ---- | ---------- |
| `README.md` | Human-facing overview, install, and the getting-started flow |
| `.env.template` | Copy to `.env` (gitignored) and fill in `TABLEAU_SERVER_URL`, `TABLEAU_SITE_NAME`, and a PAT (`PAT_NAME`/`PAT_VALUE`). **Required for the REST + Metadata derivation** — datasource models and the identity/lineage enrichment of workbook models. Same credentials as `query-tableau-data`. |
| `scripts/derive-workbook.sh` | One-shot workbook derivation: `--site <site> --url <viz-url> --name <Workbook>.<View>`; embeds the viz via `view-tableau-dashboard` and writes `<site>/workbooks/<Workbook>/<Name>.derived.json`. |
| `scripts/derive-workbook.js` | The browser-eval body the script runs (carries inline slug helpers). |
| `scripts/derive-utils.ts` | Canonical slug helpers (host-free slug, name slug). |

**`docs/` — read the one you need:**

| File | Use it when |
| ---- | ----------- |
| `READING_THE_MODEL.md` | **Mandatory before interpreting any `.derived.json`** — each section, the nulls, filters vs visible controls. |
| `DERIVATION.md` | Regenerating a derived model or checking freshness — the exact REST / GraphQL / Embedding calls. |
| `BOOTSTRAP.md` | A URL is handed to you and **no model exists** — the create-from-scratch flow. |
| `WORKBOOK_TEMPLATE.md` | Writing or editing a workbook model (`<site>/workbooks/<Workbook>/…`). |
| `DATASOURCE_TEMPLATE.md` | Writing or editing a datasource model (`<site>/datasources/<Datasource>/…`). |
| `WRITING.md` | Conventions for writing and maintaining any model — **including the site-folder naming rule**. |
| `README.md` | The docs index. |

Only the **canon** is documented: assets enter the model when someone cares
enough to document them. Undocumented assets are not in the model — agents
explore them the normal way.

## Agent workflow

1. **Load — mandatory if the model exists.** Before interacting with a workbook
   or datasource, check `<site>/workbooks/<Workbook>/<Workbook>.<View>.md` or
   `<site>/datasources/<Datasource>/<Datasource>.md` (+ the sibling `.derived.json`)
   and read it before any live call. Report its key facts to the user: what the asset
   is, its freshness, and the static/dynamic split below. Read
   [docs/READING_THE_MODEL.md](docs/READING_THE_MODEL.md) before interpreting the
   JSON — it defines each section and null (e.g. `structure.visibleControls` is the
   filters/parameters a human actually sees, *not* the full filter list).
2. **Address by URL or slug.** The model carries the full canonical URL
   (`asset.url`, `structure.sheets[].url`) — the easiest match when a user
   hands you a URL — plus a host-free slug (`asset.urlSlug`, e.g.
   `Superstore-Overview_…/Overview`) for portable cross-site addressing. The
   ideal workflow is the user handing you the URL directly.
3. **Bootstrap when no model exists.** If a model is absent for the asset,
   don't stop — create one. Run the flow in
   [docs/BOOTSTRAP.md](docs/BOOTSTRAP.md): derive the machine half
   (`./scripts/derive-workbook.sh --site <site> --url <url> --name <Workbook>.<View>`), draft the behavioral `.md` from **live
   observation** (filters, parameters, and especially the mark-driven
   `Action (...)` selection actions), then **confirm the behavioral details
   with the user** before relying on the model. Do not silently commit a
   bootstrapped model.
4. **Check freshness.** Compare the model's `freshness.anchor` (the source
   asset's `updatedAt`) to the asset's current `updatedAt` via the REST API
   (see [docs/DERIVATION.md](docs/DERIVATION.md) §2). If the model is stale,
   flag it, regenerate the derived file, and commit the updated model. A
   `null` anchor (e.g., Tableau Public) means no detectable refresh schedule —
   treat the model as orientation and verify live. This works because schema,
   layout, fields, and visuals are static relative to the data; drift is
   expected and refreshed on demand. The `asset.note` / `freshness.note` fields
   explain which values your real environment populates.
5. **Prepare.** Use the model to know the sheets, fields, filters, parameters,
   mechanics, and lineage before opening the viz or writing a query.
6. **Interact.** Drive the viz via `view-tableau-dashboard` or query via
   `query-tableau-data`.
7. **Fact-check live.** The model is a head start, not a substitute. **Dynamic
   values are always read live** (see below). If anything in the model
   contradicts what you observe, trust the live system and note the drift.

## Static vs dynamic — read the model, verify live

The snapshot holds the **mostly static** facts: schema, layout, parameters,
dashboard mechanics, lineage, identity, and freshness. It does **not** hold values
that change on every refresh — filter/domain values, range values, current parameter
values, row counts. **Always pull those live**; never trust a sample.

The section-by-section guide (what each key and null means) is mandatory before you
rely on a field: [docs/READING_THE_MODEL.md](docs/READING_THE_MODEL.md).

## Lineage fallback

If a task needs data that is not reachable through the dashboard itself (not
formatted that way, not surfaced), use the lineage recorded in the derived
model (workbook → embedded datasource → published datasource → table/column)
to continue exploration at the source datasource.

## Docs

- [docs/READING_THE_MODEL.md](docs/READING_THE_MODEL.md) — **mandatory before interpreting any model**: each section, the nulls, and filters vs visible controls
- [docs/DERIVATION.md](docs/DERIVATION.md) — the exact REST, GraphQL, and Embedding queries that produce the derived model; run these to refresh a stale model
- [docs/BOOTSTRAP.md](docs/BOOTSTRAP.md) — create a model from scratch when none exists (derive, verify live, confirm with the user)
- [docs/WRITING.md](docs/WRITING.md) — how to write and maintain semantic models
- [docs/WORKBOOK_TEMPLATE.md](docs/WORKBOOK_TEMPLATE.md) — behavioral model template for a workbook
- [docs/DATASOURCE_TEMPLATE.md](docs/DATASOURCE_TEMPLATE.md) — behavioral model template for a datasource
- [docs/README.md](docs/README.md) — documentation index