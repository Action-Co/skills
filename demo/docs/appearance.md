# Tabby CSS extraction and Settings themes

Branch: `codex/tabby-css-extraction`. Based on
`CTASK-4728_Tabby_Data_Source_Exploration`, with the initial CSS extraction
committed as `49deb35`. Scope expanded on November 25, 2026 to include Settings
and appearance selection on the same branch. Keep it separate until reviewed;
external-data validation remains a separate concern.

## Behavior

The profile icon sits at the right of the Tabby brand row and opens Settings
directly, replacing the footer gear button. Click, Enter, or Space navigates
to Settings with no dropdown. Its Appearance fieldset contains native
radio controls with palette previews, supporting mouse, Tab, and arrow keys.
The homepage stays focused on choosing a data demo. Opening Settings preserves
the active provider, analysis scope, chat history, attachments, and running
requests. Existing dashboard elements remain mounted; returning to a Tableau
dashboard uses the existing session-health check.

Demo mode offers six themes. `tabby.theme.v1` stores only the theme ID in browser
local storage. Startup validates it against the offered list. Missing, blocked,
or invalid storage uses the demo default, Action Dark. Storage write failures
leave the theme usable and announce that it could not be saved.

`TABBY_THEME=<id>` enables fixed mode. The host validates the ID before serving
the app; invalid configuration fails startup. Initial HTML already identifies
the selected theme and company label. Only the selected CSS block and metadata
are served, and the browser never reads or writes the demo preference. Settings
displays that single appearance read-only. This prevents an app-level fallback
to Action when a saved demo choice is stale, storage is blocked, or JavaScript
has not yet run.

## Structure and performance

- `styles.css` holds shared geometry, responsive behavior, component rules, and
  Settings styling. Colors, shadows, body weight, and font family use variables.
- `themes.css` holds one complete declaration block per theme. The host serves
  all six in demo mode and only the chosen block in fixed mode. Preview cards
  reuse those same declarations in a local scope.
- `appearance.ts` contains names/descriptions and optional font/logo references,
  validates host configuration, and renders initial HTML and the bootstrap
  metadata. Colors are defined only in CSS.
- `themes.js` applies the saved theme before the stylesheets load, then creates
  the appearance cards once. Switching updates the root attribute, branding,
  radio state, and storage; it does not rebuild app views, fetch provider data,
  or reconnect chat. The host prepends its configuration to this script, keeping
  initialization to one script request. Action alone loads Kanit; other demos
  use system fonts.
- World Bank paths, dots, and legend swatches reference `--chart-1` through
  `--chart-10`, so existing SVGs recolor without resetting the year explorer.

There are no new packages, framework styles, generated palettes at runtime,
theme animations, or per-component style mutation loops. A switch still incurs
browser style/paint work, and a font change can alter text wrapping. Theme sizes
and browser behavior should be checked with the actual demo workload rather
than treating CSS variables as cost-free.

## Palette provenance

Reviewed November 25, 2026. Named-company palettes are demo interpretations;
hex values and UI typography are engineering choices, not verified official
design tokens. No external company logo has been recreated or bundled.
The Action icon is bundled unmodified as `demo/app/logo.svg` from the official
[white icon asset](https://drive.google.com/file/d/1RF4IVXnzM7S42KEu4MDz1NeQp-WgKwDW/view)
in Logo → SVG → Standard → Icon (retrieved November 25, 2026; source last modified
February 7, 2025). This replaces the previously missing optional local file.
It is displayed only for Action Dark and retains its original colors and proportions.

- Action Dark preserves the app's existing Action palette, body type, glow,
  and chart order. The installed Make action-brand skill provides the Action
  guidance; source skills are maintained in the
  [Action marketplace](https://github.com/Action-Analyticus/IP---Agent-Skills---Plugins-Market).
- [PNC corporate profile](https://www.pnc.com/content/dam/pnc-com/pdf/aboutpnc/Fact%20Sheets/CorporateProfile.pdf):
  orange/slate inspiration, adapted for readable UI controls.
- [Aetna external-partner logo guidelines](https://www.aetna.com/content/dam/aetna/pdfs/aetnacom/about-aetna-insurance/document-library/aetna-logo-guidelines.pdf),
  November 2023: violet inspiration. This is not a full UI brand specification.
- [Micron brand overview](https://www.micron.com/the-micron-brand):
  silicon-inspired orange and charcoal, reflecting the current brand direction
  rather than assuming its older blue identity.
- Medical Company and Banking Company are original generic sector presets.

The architecture follows [Bulma's CSS-variable theme pattern](https://bulma.io/documentation/features/themes/)
without adding Bulma or Sass to the app.

## Validation and remaining delivery work

Run `bun test demo/app demo/tools` from the repo root. Tests cover pre-paint
selection, stale/blocked storage, fixed-mode isolation, invalid configuration,
complete variable sets, UI text/button/focus contrast, and chart contrast.
Existing data, session, CSV, chat renderer, and download tests remain applicable.

Browser review should cover Settings navigation, all six choices, keyboard
selection, persistence across refresh, narrow windows, chat preservation, and
an existing dashboard/chart surviving a theme change. Check fixed mode separately
with a stored Action preference to confirm it still renders the selected company.

The present feature changes app appearance. Embedded providers and report
generation have separate styling. A future company-only export must propagate
the approved brand through reports and PDF/print, choose approved assets, and
package only the required resources. Fixed app mode alone must not be described
as a completed company-only export.

### Review evidence (November 25, 2026)

- All six choices and native radio arrow-key selection were exercised in the
  browser. A refresh restored the selected company theme.
- A live World Bank comparison retained its 2019 explorer selection, applied
  2000–2020 scope, and unsent chat draft through Settings and a PNC-to-Aetna
  switch. The existing chart path changed from PNC blue to Aetna violet.
- The fixed PNC instance showed one disabled choice, served only the PNC rule,
  and loaded no Action font. Automated startup checks additionally cover stale
  Action preferences and blocked storage.
- Theme CSS is 4,512 bytes and the controller is about 3.8 KB uncompressed;
  estimated gzip sizes are about 1.3 KB each. These are file measurements,
  not a promise about HTTP compression or switching latency.
- Browser review used a 1280px viewport. The test browser ignored a requested
  narrow viewport, so narrow-window layout still needs manual review. No
  browser performance trace or full assistant-response run was performed.
