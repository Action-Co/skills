# Documentation for Tableau Semantics

## Documentation Index

| Topic | Entry Point | When to Use | Description |
|-------|-------------|-------------|-------------|
| Behavioral model — workbook | [WORKBOOK_TEMPLATE.md](WORKBOOK_TEMPLATE.md) | Creating or editing a workbook semantic model (`site/<site>/workbooks/<name>.md`) | Template and field guide for the human-authored behavioral documentation: what the dashboard is for, KPI definitions, canonical filters/parameters, dashboard mechanics, gotchas. |
| Behavioral model — datasource | [DATASOURCE_TEMPLATE.md](DATASOURCE_TEMPLATE.md) | Creating or editing a datasource semantic model (`site/<site>/datasources/<name>.md`) | Template and field guide for the human-authored behavioral documentation for a published datasource: what it holds, grain, key fields, known limitations. |
| Writing & maintenance | [WRITING.md](WRITING.md) | Writing or reviewing any semantic model | Conventions for writing and maintaining semantic models: what belongs in `.md` vs `.derived.json`, the referenced-fields policy, how to keep models current, how to handle drift, review checklist. |
| **Bootstrapping a new model** | [BOOTSTRAP.md](BOOTSTRAP.md) | A URL is given and **no model exists yet** | The full flow for creating a semantic model from scratch: auth-first, derivation, live verification, the behavioral draft, the human confirmation gate, and the pitfalls to look out for (selection actions, Measure Names KPI cards, worksheet `fields` gap, host-free slugs). |
| Reading a model | [READING_THE_MODEL.md](READING_THE_MODEL.md) | Interpreting a derived model JSON before acting on it | How to read `<Name>.derived.json`: each top-level section, what the nulls mean (including `freshness.anchor: null` for Tableau Public / static datasets), filter groups vs visible controls, host-free slug addressing, and the static-vs-dynamic discipline. |
| Derivation queries | [DERIVATION.md](DERIVATION.md) | Regenerating a derived model (`<name>.derived.json`) or checking freshness | The exact REST API, Metadata API (GraphQL), and Embedding API calls that produce the derived semantic model — the source of truth for refreshing any model. |