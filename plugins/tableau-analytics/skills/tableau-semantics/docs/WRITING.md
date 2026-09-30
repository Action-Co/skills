# Writing & Maintaining Semantic Models

This guide defines how to write, review, and maintain the semantic models in
`site/<site>/`. It applies to both halves of a model — the behavioral
markdown (`.md`) and the derived snapshot (`.derived.json`).

---

## 1. The two-file division of labor

A semantic model is two files with the same base name:

| File | Owned by | Holds |
| ---- | -------- | ----- |
| `<Name>.md` | **humans** (with agent help drafting) | the *meaning*: purpose, KPIs, mechanics, gotchas, canonical filters |
| `<Name>.derived.json` | **machines** (generated from APIs) | the *facts*: schema, fields, layout, parameters, lineage, freshness anchor |

Rules that follow:

- **Never hand-edit the derived file's content.** Regenerate it with the
  queries in [DERIVATION.md](DERIVATION.md). Hand edits will be lost on the
  next refresh and create false confidence.
- **Never duplicate derived facts in the markdown.** No field lists, sheet
  lists, LUIDs, or timestamps in the `.md`. If the markdown needs a fact,
  reference the sibling derived file.
- **Definitions are human-owned; documentation is agent-generated.** An agent
  may draft the markdown from the derived facts and from interviewing the
  owner, but a human must own the final definitions of *what the numbers
  mean*. LLM-bootstrapped semantic definitions tend to encode the same
  ambiguities they were meant to remove.

### What the derived file contains

- A **workbook** model lists **referenced fields only** — the fields the
  workbook's worksheets actually use, enriched from the datasource catalog.
  It deliberately does **not** dump the full datasource schema: the full
  catalog belongs in the **datasource** model (`site/<site>/datasources/`),
  and the workbook model's lineage (datasource id + name) is the bridge.
- **Filter classification is already encoded**: `structure.filters` groups
  selection actions (`Action (...)` — driven by mark selection) from applied
  filters, and `structure.visibleControls` lists the quick-filter /
  parameter-control dashboard objects — the controls a human user actually
  sees and references. The notes are in the JSON; **do not re-explain filter
  groups or visible controls in the behavioral markdown**.

## 2. Static vs dynamic discipline

The whole point of the model is to snapshot what is **mostly static** and
leave what is **dynamic** to live queries:

- **Static — safe to commit:** schema and field catalog (roles, types,
  aggregations), visual layout (sheets, zones, worksheet composition),
  parameters and their types, dashboard mechanics, lineage, identity +
  freshness anchor.
- **Dynamic — always read live, never trusted from the model:**
  filter/domain values (states, countries, account lists), range values,
  current parameter values, row counts. These change with every data refresh.

The derived model may carry a **sample** of dynamic values for orientation
(e.g., a handful of categorical members). It must be labeled a sample, and the
agent must confirm the real values live.

> **Test:** if a value can change between two data refreshes, it is dynamic —
> leave it out of the committed model (or sample it, labeled).

## 3. What enters the canon

- **Only the canon.** Document assets someone chose to document because they
  are trusted sources of truth. Do not derive the whole site; sandboxes and
  one-off experiments stay out.
- An asset enters the canon when a human cares enough to write its
  behavioral markdown. Until then it simply is not in the model.
- Keep the model **small, reviewed, and trustworthy**. A curated set beats a
  sprawling one.

## 4. Writing behavioral markdown

Start from the templates:

- Workbook: [WORKBOOK_TEMPLATE.md](WORKBOOK_TEMPLATE.md)
- Datasource: [DATASOURCE_TEMPLATE.md](DATASOURCE_TEMPLATE.md)

Conventions:

- **Write for a reader who has never seen the dashboard.** The agent reads
  this file cold; every abbreviation and internal name needs its meaning.
- **State the decision.** What does a user decide from this asset? That is
  the anchor of the whole file.
- **KPIs: meaning + calculation.** A KPI card is meaningless without both
  ("what it represents" and "how it is calculated").
- **Write down the onboarding.** The mechanics — "click an account to filter
  everything" — are usually passed verbally from human to human. Writing them
  down is the highest-value thing this file does.
- **Gotchas pay off.** Aliases (`USA` vs `United States`), `%null%` rows,
  Measure-Names-shaped KPI cards, relative-date periods that are invisible in
  snapshots — each is hours of agent probing saved.
- **Keep it lean.** A good model is a page or two, not a datasheet. If a
  section balloons, the facts probably belong in the derived file.

## 5. Generating the derived model

Run the queries in [DERIVATION.md](DERIVATION.md) against the live asset and
save the combined result as `<Name>.derived.json`. The fastest path for
workbooks is the reusable derivation:

```bash
./scripts/derive-workbook.sh --url <viz-url> --name <Name>
```

It embeds the workbook via `view-tableau-dashboard`, runs
[`derive-workbook.js`](../scripts/derive-workbook.js), and writes
`site/workbooks/<Name>.derived.json`. Then optionally enrich the `null`
REST/Metadata-only fields (§2–§3) when a PAT is available.

Manual sequence:

1. Auth via `.env` (see `.env.template`).
2. **Embedding pass** (visual layer, the default for workbooks): `derive-workbook.sh`
   pulls sheets, zones, parameters, **grouped filters + visible controls**,
   **referenced fields** (enriched from the datasource catalog — the workbook
   model intentionally lists only the fields the worksheets use), datasource +
   logical tables, and domain samples. This is the **only** place the
   performance-flagged `getDataSourcesAsync()` is called — at model-build
   time, never at runtime.
3. **REST pass** (identity + `updatedAt` freshness anchor) and **Metadata API
   pass** (lineage + field formulas): fill the nulls the Embedding API cannot
   provide. See `DERIVATION.md` §2–§3.
4. Merge into the derived JSON shape shown in `DERIVATION.md` §5.

## 6. Freshness, drift, and maintenance

- **Freshness anchor:** the model records the source asset's `updatedAt`.
- **Detection:** before relying on a model, compare the anchor to the asset's
  current `updatedAt`. If the asset is newer, the model is **stale**.
- **No anchor is a contract, not a bug:** `freshness.anchor: null` means the
  asset has no detectable refresh schedule — the REST API was unavailable
  (e.g., **Tableau Public**) or the data is static. Treat the model as
  orientation and verify live; the URL origin (`public.tableau.com` vs a
  Cloud/Server host) tells you which case applies. The datasource
  `extractUpdateTime`, when present, is the best available data-freshness
  signal. See [READING_THE_MODEL.md](READING_THE_MODEL.md).
- **Drift is expected, not a bug.** Schema changes are rare but happen; when
  they do, regenerate the derived file, review the diff, and commit — like
  any docs-as-code artifact. Do **not** build background sync machinery.
- **What to do on staleness:** flag it to the user, regenerate the derived
  file, update the markdown if meaning changed, commit the update. An agent
  can always fetch fresh data itself using the derivation queries — the
  snapshot is an accelerator, never a wall.
- **Schedule:** on-demand refresh (agent detects staleness) is the default.
  Teams may add a periodic review cadence; that is a process choice, not a
  system requirement.

## 7. Review checklist

Before committing a model, verify:

- [ ] The behavioral markdown states the **purpose and the decision** it informs.
- [ ] Every KPI/chart has **meaning + calculation**.
- [ ] **Mechanics** (what drives what) are written down.
- [ ] **Gotchas and aliases** are captured.
- [ ] The derived file was **generated, not hand-edited**, and matches the current `updatedAt`.
- [ ] The workbook model's `fields` are **referenced fields only** — no full-schema dump; the full catalog belongs in the datasource model.
- [ ] **Filter groups + visible controls** are in the derived file — do not re-explain them in the markdown.
- [ ] **Dynamic values** are samples at most, labeled as such.
- [ ] No credentials, no site-internal paths, no duplicate derived facts in the markdown.
- [ ] Both files share the base name and sit in the right `site/<site>/` folder.