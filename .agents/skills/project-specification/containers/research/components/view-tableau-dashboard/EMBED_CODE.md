# View Tableau Dashboard — Embed Display Upgrade (Scaling Card + Agent-Activity Notifications)

**Status:** draft (design research — plan agreed, not yet implemented)
**Author:** Stephen Price + planning agent
**Last Updated:** 2026-09-29

---

## Purpose

Upgrade the `view-tableau-dashboard` embed page (`src/embed-tableau.html`) so any
embedded Tableau viz:

1. **Fits whatever surface it is shown on** — a laptop screen, a full-screen
   browser, or a tile in a terminal emulator with multiple agent tabs side by
   side — by **scaling** the rendered viz to fit a floating card while
   preserving aspect ratio (no distortion, no cutoff, no overflow).
2. **Reads as a polished, self-contained card** on a dark, teal-tinted
   background with a soft glow, instead of the current full-bleed
   "responsive reflow" embed with a plain status bar.
3. **Tells the human what the agent is doing** by surfacing each agent action
   as a transient notification banner (toast) in the corner of the page — and,
   crucially, **enforces that every eval carries an intent** so the human
   always has visual feedback when an agent drives the viz.

This document is the design research for the change. It is the seed for a
future implementation issue and is tracked against the
[VIEW_TABLEAU_DASHBOARD.md](../VIEW_TABLEAU_DASHBOARD.md) component.

---

## Background: how viz scaling actually works (the TabScale concept)

Research source: [TabScale](https://gitlab.com/jhegele/tabscale) (jhegele,
~2016). Its entire mechanism is **pure CSS transforms on the container that
wraps the viz** — no iframe resizing, no reflow:

- The iframe/viz is embedded at a **fixed native size** (e.g. 900×627px from
  the embed code or JS API options).
- The container gets `transform-origin` (the pivot point — TabScale's
  `scaleFrom` enum is literally transform-origin strings: `'0% 0%'`,
  `'50% 50%'`, …) and `transform: scale(k)`.
- `k` is recomputed on resize: `k = (viewport − containerOffset) / nativeSize`
  (TabScale scales to the window edge and only **down**, with
  `minScalePct`/`maxScalePct` clamps).

Key properties that make this attractive:

- CSS `transform` scale is **purely visual** — it does not change layout size,
  does not trigger reflow, and does not create scrollbars. The viz keeps its
  designed layout exactly; it is only drawn smaller/larger.
- Interaction still works: the browser transforms hit-testing with the element,
  so clicks/filters land correctly on the scaled viz.

**Difference from the current embed:** today `embed-tableau.html` sizes
`<tableau-viz>` to 100% of the viewport and calls `vizEl.resize()` on window
resize — that is *responsive reflow*, which lets Tableau re-layout the
dashboard (cramped, cut-off, or awkward for dashboards designed at large
sizes). The upgrade switches to *scaled render*: render at a fixed native
size, then CSS-transform scale to fit.

---

## Design: fit-to-stage scaling (no card — the viz IS the card)

### Layout

- `body` becomes a **very dark, teal-tinted background** (near-black base with
  a faint teal radial wash).
- **There is no `#card` element.** A `#viz-stage` fills the viewport minus
  margins (48px total), centering the viz. The dark background shows in the
  margins around the viz; the **viz itself carries the card chrome**:
  - `border-radius: 14px` on the native-size wrapper (with `overflow: hidden`,
    so the Tableau iframe's corners are clipped — verified by hit-testing),
  - a hairline border in a **per-tab color**,
  - a **box-shadow glow in the same per-tab color**, derived deterministically
    from the session id (a curated palette of ~7 "primary" hues), so
    side-by-side tabs/agents are identifiable at a glance.
- The current full-width `#status` bar is demoted to a small **status chip**
  (top-left) that **auto-hides after ~6s** on every non-error status change
  (errors persist); a new **toast stack** (top-right) shows agent activity.
- The **tab title** starts as "Tableau Session Bridge" and, once the viz is
  interactive, becomes "Tableau Session Bridge — <active sheet / workbook
  name>" (read live from `vizEl.workbook`; URL-derived as a fallback).

### Scaling math

Render `<tableau-viz>` at a fixed **native size** `(nativeW × nativeH)` and
uniformly scale it to fit the stage:

```
k = min(stageW / nativeW, stageH / nativeH)
```

Applied as `transform: scale(k)` with `transform-origin: center` on the
native-size wrapper. The wrapper's layout box stays at native size; the
transform draws it scaled and centered. (No internal padding — the viz fills
the stage edge-to-edge.)

### Decisions (locked)

| # | Decision | Rationale |
| - | -------- | --------- |
| D1 | **Native size defaults to 1920×1080**, overridable via `start --width/--height` (plumbed through `buildTabUrl` query params `viz-width`/`viz-height`). | Dashboards are authored at a designed size; a sensible default makes it work out of the box, and the override handles non-1080p designs. Auto-detection of designed size is not available from the Embedding API. |
| D2 | **Uniform scale, both directions** (shrink AND enlarge), aspect ratio preserved. | A viz built for a large screen must fit a laptop; a small viz must fill a large screen. Never distort. |
| D3 | **transform-origin center.** | The stage is centered; scaling about the center keeps the viz visually centered. |
| D4 | **Recompute on window resize AND a `ResizeObserver` on the stage.** | Works in any container: full browser, split panes, terminal tiles, iframes. `ResizeObserver` covers layout changes the window event misses. |
| D5 | **Remove the current `vizEl.resize()` reflow call.** | Reflow is what breaks big-screen dashboards; the whole point is scaled render, not responsive re-layout. |
| D6 | **Clamp `k` to a sane upscale bound (~1.5×)** to avoid visible blur on extreme upscales. | Pixelated text is worse than a slightly-unfilled stage. Lower bound is unbounded (scaling down is the common case). |
| D10 | **No card around the viz** — rounded corners + hairline border + glow live on the viz's own wrapper. | Feedback: "the viz itself does not need a card around it… it should just be the viz." Tighter, cleaner; the glow doubles as per-tab identity. |
| D11 | **Per-tab glow color** from a ~7-color palette, seeded by a hash of the session id (stable per tab). | Multiple tabs/agents side by side are identifiable by color; stable so a given tab keeps its identity across re-renders. |
| D12 | **Status chip auto-hides ~6s after a non-error status change** (errors persist). | Status is transient; it should get out of the way and not occupy real estate. |
| D13 | **Dynamic tab title:** "Tableau Session Bridge" → "Tableau Session Bridge — <viz name>" at `firstinteractive`. | The tab name starts with the bridge identity, then becomes the visualization name; no "v3" or internal version in user-facing labels. |

---

## Design: agent-activity notifications (intent → toast)

### The problem

Many dashboards change state in ways that are not obvious on screen (filters,
parameters, mark selections). When an agent drives the viz and a human is in
the loop, the human needs **visual feedback of what the agent is doing** — a
trail of actions — so they can trust and verify the agent's work.

### The pipeline

The CLI already routes every action as an `eval` (`command` envelope) over the
session-bridge WebSocket. We attach a human-readable **intent** to that
envelope and render it as a toast on the page:

```
CLI eval/run --intent "<text>"
  → command envelope { type:"command", session, id, js, intent? }
  → bridge: pass-through (store/route unchanged)
  → executor: before running the eval, call runtime.notify(intent)
  → page: toast stack (top-right, dark glass, accent border, slide-in,
          auto-dismiss ~4s, stacked for concurrent actions)
```

### Wire protocol changes (`src/protocol.ts`)

- `CliCommandSchema`: add `intent: z.string().optional()`.
- `CommandMessageSchema` (bridge → page): add `intent: z.string().optional()`.
- Bridge (`src/bridge.ts`): forward `intent` untouched when routing a CLI
  command to the tab socket. No new message types — it is metadata on the
  existing `command` envelope.

### Page seam

`embed-tableau.html` exposes `notify(intent)` on `window.__tableauRuntime__`
(next to the existing `setStatus`/`emit` seams). The toast UI lives entirely in
the page; the executor just calls the seam. This keeps the page's new UI
isolated from the executor's eval loop.

### Toast UX

- Fixed **top-right** stack.
- Dark glass card: translucent dark background, accent-tinted left border
  (teal), title-ish verb + intent text, small slide/fade-in.
- Auto-dismiss after ~4s; multiple toasts stack.
- The seam is designed so a **persistent activity trail / log** can be added
  later without touching the pipeline (the user's future logging work).

---

## Enforcement: intent is REQUIRED on eval/run

The agent habit must be enforced, not just documented — agents will otherwise
often forget the intent, and the human loses feedback.

### Decision (locked)

| # | Decision | Rationale |
| - | -------- | --------- |
| D7 | **`--intent <text>` is REQUIRED on `eval` and `run`** (commander `requiredOption`). | Fails **as early as possible** — before any bridge/tab contact — with a clear message ("required option '--intent <text>' not specified"). The agent self-corrects and forms the habit on the first miss. |
| D8 | **Read-only convenience commands that run an eval auto-derive a default intent** (`meta` → "Reading metadata cache", `describe` → "Reading dashboard summary & metadata", `filter` → "Reading filter <field>", `start --script X` → "Running script 'X'" — the last emitted by the page when the scheduled script fires). | These still notify (humans see read activity) without burdening the agent with an intent on every introspection call. `summary` emits **no** toast — it reads the bridge's stored snapshot and runs no eval on the page, so there is nothing to surface. |
| D9 | **No `--no-intent` escape hatch in this iteration.** | An opt-out would let the habit rot. Revisit only if silent diagnostics prove genuinely needed. |

### Skill/documentation changes

- `SKILL.md` — add a prominent correctness rule + operation note:
  *"Every `eval`/`run` MUST pass `--intent <text>` describing what the code
  does (e.g. `--intent "Filtering to country = Canada"`). The CLI fails fast
  if it is missing."* Update the eval examples to include `--intent`.
- `README.md` — document the new flag and the required-intent rule.
- `docs/PROTOCOL.md` — document the `intent?` field on the command envelopes.

---

## Deliverables / files touched

| File | Change |
| ---- | ------ |
| `src/embed-tableau.html` | Dark background, `#card` layout, status chip, toast stack UI, `notify` seam, scaling JS (native size + `transform: scale(k)` + `ResizeObserver`), remove `vizEl.resize()` reflow |
| `src/client/executor.ts` | On command with `intent`, call `runtime.notify(intent)` before running the eval |
| `src/protocol.ts` | `intent?: string` on `CliCommandSchema` + `CommandMessageSchema` (+ schema tests) |
| `src/bridge.ts` | Pass `intent` through on command routing |
| `src/cli.ts` | `--intent` required on `eval`/`run`; auto defaults for `meta`/`summary`/`describe`/`filter`; `start --width/--height` |
| `src/session.ts` | `viz-width`/`viz-height` query params in `buildTabUrl` |
| `SKILL.md` / `README.md` / `docs/PROTOCOL.md` | Required-intent rule + scaling/notification documentation |

---

## Verification

1. `bun test` (protocol/bridge tests gain `intent` cases) and `bunx tsc --noEmit`.
2. Smoke test in a CMUX browser tab:
   - `tableau-viz start --url <public view>` — card renders on dark
     background, viz fits within margins at any window size (resize the tab).
   - `tableau-viz eval --intent "Filtering to country = Canada" '…'` — toast
     appears top-right and auto-dismisses.
   - `tableau-viz eval '…'` **without** `--intent` — CLI fails fast with the
     required-option error.
   - Multiple quick evals — toasts stack.

---

## Future work (noted, not built)

- **Persistent activity trail / logging:** the `notify` seam already separates
  the pipeline from the UI; a collapsible recent-activity list or an on-disk
  action log can slot in later.
- **Auto-detect the dashboard's designed size** if the Embedding API ever
  exposes it (currently it does not).
- **Per-view native-size presets** in `scripts.json` / a config file for known
  dashboards (e.g. a 4K-authored dashboard always embeds at 3840×2160).

---

## Related

- [VIEW_TABLEAU_DASHBOARD.md](../VIEW_TABLEAU_DASHBOARD.md) — the embedding runtime component this upgrades
- [DESIGN_TESTING.MD](DESIGN_TESTING.MD) — the skill evaluation log this design was raised in
- [TabScale](https://gitlab.com/jhegele/tabscale) — the researched scaling technique