# Tableau Semantics

A governed semantic layer for Tableau workbooks and datasources. Each
documented asset gets a **semantic model** — two files that prepare an agent
before it ever touches the live system:

- **Behavioral documentation** (`<Asset>.md`) — written by the humans who own
  the asset: what the dashboard is for, who uses it, what the KPIs mean, how
  the filters/parameters are meant to be used, the gotchas.
- **Derived semantic model** (`<Asset>.derived.json`) — a machine-generated
  snapshot of the mostly-static metadata (schema, fields, layout, parameters,
  lineage, freshness anchor) pulled once from the Embedding, REST, and
  Metadata APIs, so agents don't re-discover it on every session.

The two files share a base name (`SUPERSTORE.Overview.md` + `SUPERSTORE.Overview.derived.json`)
so they sit next to each other and vary only by suffix.

## Why this exists

Agents interacting with Tableau used to discover a dashboard's meaning at
runtime, on every session — slow, and re-learned each time. This skill
captures the hard-to-get, mostly-static metadata **once**, commits it, and
lets the agent read it instantly from the filesystem. Only truly dynamic
values (filter domain values, ranges, row counts) are left to live queries.

Both access paths share the same governed layer:

- `view-tableau-dashboard` — interactive driving of a live viz (Embedding API).
- `query-tableau-data` — catalog / lineage / introspection / query (REST,
  Metadata API, VDS).

## Layout

```text
tableau-semantics/
├── SKILL.md              # agent runbook (read first)
├── docs/                 # templates, writing guide, derivation queries
└── site/                 # one folder per Tableau site — rename to the real site
    ├── datasources/      # semantic models for published datasources
    └── workbooks/        # semantic models for workbooks/dashboards
```

Only the **canon** is documented: assets enter the model when someone chooses
to document them. Undocumented assets are not in the model — agents explore
them the normal way.

## Getting started

1. **Pick the assets to document** (the canon). Start with the workbooks and
   datasources your users actually rely on.
2. **Generate the derived model.** For workbooks, run the reusable derivation
   (embeds the viz via `view-tableau-dashboard` and writes the derived JSON):

   ```bash
   ./scripts/derive-workbook.sh --url <viz-url> --name <Name>
   ```

   Or run the REST / GraphQL / Embedding API queries in
   [docs/DERIVATION.md](docs/DERIVATION.md) and save the result as
   `<Asset>.derived.json`. Credentials come from `.env` (see `.env.template`).
3. **Write the behavioral documentation.** Copy
   [docs/WORKBOOK_TEMPLATE.md](docs/WORKBOOK_TEMPLATE.md) or
   [docs/DATASOURCE_TEMPLATE.md](docs/DATASOURCE_TEMPLATE.md), and fill in the
   intent: what the asset is for, how it's used, the gotchas. Follow
   [docs/WRITING.md](docs/WRITING.md).
4. **Commit both files** to the consuming repo — the models are governed
   artifacts, reviewed like docs-as-code.
5. **Keep them fresh.** When the asset changes, the model's freshness anchor
   goes stale; regenerate the derived file and update the docs.

## Docs

- `SKILL.md` — the agent runbook.
- `docs/WORKBOOK_TEMPLATE.md` / `docs/DATASOURCE_TEMPLATE.md` — behavioral
  model templates.
- `docs/WRITING.md` — how to write and maintain semantic models.
- `docs/DERIVATION.md` — the exact queries that produce the derived model.

## License

Apache 2.0. See `LICENSE`.