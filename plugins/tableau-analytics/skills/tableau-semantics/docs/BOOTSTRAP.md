# Bootstrapping a Semantic Model

How to create a semantic model for a workbook/view that has **no model yet**.
This is the flow an agent runs when the user hands it a URL and the model
lookup (`<site>/workbooks/<Workbook>/<Workbook>.<View>.md` + `.derived.json`) comes up empty.
It is a **drafting** flow: the agent builds both halves, then a human confirms
the behavioral details before the model is relied on.

Use `WORKBOOK_TEMPLATE.md` for the behavioral half, `DERIVATION.md` for the
machine half, and `WRITING.md` for the conventions. This file is the *how to
run the whole thing* and the *what to look out for*.

---

## 1. Auth-first — prove access before any fan-out

1. Open **one** tab first (the **driving tab**) via `view-tableau-dashboard`:
   `./tableau-viz.sh start --url <canonical-url>`. This establishes the
   partition-scoped session cookie.
2. `./tableau-viz.sh wait --session <id>`. On authenticated sites the embed
   auto-reveals Tableau's in-frame sign-in and the session reports an `auth`
   state; `wait` tolerates it. If it does not become `interactive`, tell the
   human to complete the sign-in in that tab (use the `say` primitive to
   nudge: `./tableau-viz.sh say 'Please sign in to continue' --hold`), then
   re-wait until `interactive`.
3. Only after the driving tab is interactive, run the derivations. Each opens
   its own tab that reuses the same cookie, so no further sign-in should be
   needed. If any later tab reports `auth`, stop and re-confirm with the user.

## 2. Derive the machine half

```bash
cd plugins/tableau-analytics/skills/tableau-semantics
./scripts/derive-workbook.sh --site <site> --url <canonical-url> --name <Workbook>.<View>
```

Writes `<Name>.derived.json` (start → wait → eval `derive-workbook.js` →
stop). After each run verify the JSON is complete: `sheets`, `zones`,
`visibleControls`, `parameters`, `filters` (selectionActions + applied),
`datasource`, `fields` (referenced only), `samples`, and the host-free
`asset.urlSlug`. Regenerate if the eval errored.

## 3. Verify live, then draft the behavioral `.md`

Draft `<site>/workbooks/<Workbook>/<Name>.md` from `WORKBOOK_TEMPLATE.md` — but
**ground every claim in observation, not assumption**:

- **KPIs**: read the data back (`helpers.readVizData`) to learn the columns
  and aggregations. KPI cards built on **Measure Names / Measure Values**
  return **one row per measure** — read by column name, never `rows[0]`.
- **Filters & parameters**: start from `structure.visibleControls` (what a
  human actually sees) and `structure.parameters`; read domains and current
  values live, never from `samples`.
- **Mark-driven interactivity (the highest-value part)**: find the
  `selectionActions` (`Action (...)`) in the derived JSON — they are driven by
  **mark selection** (`helpers.selectMarks`), **never** `applyFilterAsync`.
  Determine the source sheet → target sheets by selecting a mark on the source
  and confirming the `Action (...)` filter on the target flips to
  `isAllSelected: false` with `appliedValues`; then clear the marks
  (`clearSelectedMarksAsync`) and confirm the action filters return to
  `isAllSelected: true` (reset semantics).
- **Static views**: if the view is a standalone worksheet (no zones, no
  visible controls, empty `selectionActions`), state explicitly that it is
  static — do not send the next agent looking for behavior that is not there.

## 4. The confirmation gate (do not skip)

The `.md` is the **human-owned definition** of intent. After drafting:

1. Present the behavioral details to the human: purpose, KPI calculations,
   canonical filters/parameters, and the driving mechanics (which sheets drive
   which, selection actions, reset).
2. Flag anything **inferred rather than read from metadata** — the Embedding
   API does not expose calculated-field formulas, so e.g. a KPI formula or a
   forecast multiplier that you verified by live deltas is *observed*, not
   authoritative. Ask the owner to confirm those definitions.
3. Commit only after the human signs off. Until then the files are a draft.

## What to look out for

- **Selection actions are the tell.** A dashboard that responds to clicks shows
  filters literally named `Action (<fields>)` on the *target* sheets, present
  even with nothing selected (`isAllSelected: true`). Do not apply them as
  filters; drive the **source** sheet by mark selection.
- **`fields: []` on worksheet-type views is a derivation gap, not reality.**
  The metadata loader scopes to dashboards; standalone worksheets may come back
  with an empty `fields` list. Probe the live summary columns
  (`getSummaryColumnsInfoAsync` / `readVizData`) and document those in the
  `.md`; flag the gap to the maintainer.
- **`%null%` and aliases.** Categorical domains can contain `%null%` rows
  (filtering on them yields empty data) and legacy aliases. Use the `"relevant"`
  domain, read live.
- **Relative-date periods** are invisible in the snapshot — read
  `anchorDate` / `periodType` / `rangeN` / `rangeType` live
  (`tableau-viz filter "<field>"`).
- **Measure Names/Values cards** are the common KPI-card shape; `readVizData`
  returns one row per measure — always read by column name.
- **Parameters are workbook-global.** Every view's derived JSON lists every
  workbook parameter; only a few actually drive a given view. Probe live which
  ones matter (set one, read the data back, confirm it changed) and document
  only those.
- **URLs in the model, plus a portable slug.** The model carries the **full
  canonical URL** (`asset.url`, `structure.sheets[].url`) — the easiest match
  when a user hands you a URL — **and** a host-free slug (`asset.urlSlug`, the
  path after `/views/`) for portable cross-site addressing. Models derived from
  a **private** site carry that site's URL: strip to the slug before sharing a
  model outside your organization.
- **Placeholder notes, not fake values.** Identity and freshness fields that
  the Embedding-only pass cannot fill (`luid`, `owner`, `freshness.anchor`, …)
  stay `null` and carry a `note` field stating they are populated by your real
  environment's PAT-enabled REST/Metadata pass — never hard-code an owner name
  or a fake timestamp into an example model.

---

**Provenance:** Source: semantic model · bootstrap procedure · Owner: Analytics
COE · Last reviewed: 2026-10-01