# Tabby handoff — November 25, 2026

## Resume here

Paste this into the next agent chat:

> Continue the Tabby work in `/Users/mayrasanchez/.codex/worktrees/tabby-css-extraction/skills`.
> Read `AGENTS.md`, `demo/docs/HANDOFF.md`, and `demo/docs/appearance.md`.
> Check the current branch, working tree, recent commits, and upstream before
> making changes. We finished the Settings/theme work on
> `codex/tabby-css-extraction`; the profile icon opens Settings directly, with
> no dropdown. Keep this branch separate from the external-data branch.
> Report the reconciled state and help me choose the next item from the
> outstanding work below. Do not create another branch, push, or merge unless
> I request it. Preserve any local changes and runtime data.

This file is a dated handoff, not a live status monitor. Reconcile it with Git
and the running app when resuming. It is included in the commit that saves the
completed Settings/theme work; `git log -1` identifies that checkpoint when
checked out at this handoff. Later work may have advanced the branch.

## Repository and branch state

- Repository: [Action-Co/skills](https://github.com/Action-Co/skills).
- Working directory: `/Users/mayrasanchez/.codex/worktrees/tabby-css-extraction/skills`.
- Current branch: `codex/tabby-css-extraction`.
- Parent branch: `CTASK-4728_Tabby_Data_Source_Exploration`.
- Branch point: `c4949ca` — World Bank demo and compact navigation; includes
  `448a287` — scoped OWID demo and stale Tableau-session recovery.
- Initial CSS-only extraction: `49deb35`, already pushed to
  `origin/codex/tabby-css-extraction` earlier in this chat.
- The subsequent Settings, themes, logo, profile navigation, and this handoff
  are being committed locally at the user's request. They have **not been
  pushed by this chat**. Remote freshness has not been rechecked for this
  handoff; compare the actual upstream before publishing anything.
- No merge is authorized. No pull request has been created by this chat.
  Check GitHub before assuming there is no externally created PR.
- The local branch description now covers CSS extraction, Settings appearance
  selection, and fixed company appearance. No branch rename was requested.

The original checkout at `/Users/Shared/GitHub/ACTION/skills` was left on the
external-data branch. Earlier it had local `demo/tabby-demo.conf` and
`TABBY_AIE_CONTEXT.md` changes; these were not brought into this worktree.
Recheck rather than discarding, copying, or stashing those files automatically.
That older context file is not the current implementation handoff.

## Completed and reviewed

The user tried the app, approved its current appearance, and authorized the
commit on November 25, 2026.

1. Extracted the original stylesheet from `demo/app/index.html` into
   `demo/app/styles.css`, initially byte-for-byte, and added its server route.
2. Added a Settings page. The **profile icon at the right of the Tabby brand
   row opens Settings directly**. There is no dropdown and no footer gear.
   The homepage has no theme selector.
3. Added six appearance presets: **Action Dark, PNC Bank, Aetna, Micron,
   Medical Company, Banking Company**. The named-company presets are demo
   interpretations, and the two sector presets are generic. Proprietary
   company fonts and company logos are not bundled.
4. Saved demo selections in browser local storage (`tabby.theme.v1`) and
   restored them before paint. Invalid or unavailable browser storage uses
   the demo default, Action Dark.
5. Added **fixed app appearance** with `TABBY_THEME=<id>`. It offers one
   read-only theme, serves only that theme's variables and metadata, ignores
   demo storage, and rejects invalid configuration rather than falling back
   to Action. This is not yet a complete company-only export.
6. Kept shared layout/component rules in one stylesheet and appearance values
   in CSS variables. No framework or new dependency was added. Bootstrap
   configuration and the theme controller are served in one script request.
7. Made the locally rendered World Bank chart use theme variables, so paths,
   dots, and legend colors update without rebuilding the chart.
8. Bundled the official, unmodified Action icon as `demo/app/logo.svg` to fix
   the missing image beside Tabby. It appears only in Action Dark. Provenance
   is recorded in [appearance.md](appearance.md).

Settings preserves the provider, analysis scope, conversation, and attachments.
It temporarily closes the chat drawer. Existing dashboard nodes stay mounted;
returning to a Tableau dashboard uses the existing health check.

## Relevant files

| File | Responsibility |
| --- | --- |
| `demo/app/index.html` | App UI, direct profile-to-Settings navigation, existing chat/data interactions |
| `demo/app/styles.css` | Shared layout, responsive rules, components, Settings cards |
| `demo/app/themes.css` | Complete appearance variables for each preset; shared by preview cards |
| `demo/app/themes.js` | Pre-paint preference restore, branding updates, appearance controls |
| `demo/app/appearance.ts` | Theme metadata, validated demo/fixed configuration, initial HTML and served theme CSS |
| `demo/app/server.ts` | Bun HTTP server, app resources, data/assistant integration |
| `demo/app/logo.svg` | Official Action pictogram |
| `demo/app/world-bank-chart.js` | Theme-aware local chart, year explorer, accessible table |
| `demo/app/appearance.test.ts` | Theme restore/isolation/completeness/contrast checks |
| `demo/app/index.test.ts` | Existing UI logic plus Settings/context-preservation checks |
| `demo/README.md` | Current launch and feature instructions |
| `demo/docs/appearance.md` | Design choices, source links, evidence, limitations |
| `demo/docs/data-source-exploration.md` | Earlier external-data implementation and research context |

## Validation already completed

- `bun test demo/app demo/tools`: **47 passed, 0 failed**, 407 expectations.
- Focused TypeScript check for `appearance.ts` and its tests passed.
- `git diff --check` passed before committing.
- An additional temporary HTTP smoke test passed: fixed PNC HTML/CSS and the
  combined bootstrap script exclude the Action preset and parse correctly.
- Browser: all six presets, radio arrow-key selection, refresh persistence,
  fixed PNC appearance, and the final direct profile-to-Settings navigation
  were checked. The official image loaded successfully.
- A live World Bank comparison retained its 2019 explorer selection, applied
  Canada/Japan/US 2000–2020 scope, and unsent chat draft through a PNC-to-Aetna
  theme change. Its existing paths changed color correctly.
- Theme CSS is about 4.5 KB and the browser controller about 3.8 KB before
  compression. These are file measurements, not latency benchmarks.

Do not represent this as completed external-data validation. A full assistant
response was not exercised as part of the theme review. The test browser did
not apply the requested narrow viewport; narrow-window review remains open.

## Run the demo

From this worktree, launch the standard demo:

```bash
bash 'demo/Start Tabby Demo.command'
```

It opens a Chrome app window at `http://127.0.0.1:4747/`, starts the dashboard
bridge (normally port 3000), and detects the configured assistant. Codex
(ChatGPT) was active during the last run. The profile icon opens Settings.
Press Return in the launcher's terminal to end the demo.

The demo was running when this handoff was prepared. Do not assume the process
will survive the weekend; check its port and working directory before reusing
it. The launcher normally restarts an older local demo and its dashboards.
Starting again may reset live dashboard state.

For fixed PNC app appearance:

```bash
TABBY_THEME=pnc bash 'demo/Start Tabby Demo.command'
```

Accepted IDs: `action-dark`, `pnc`, `aetna`, `micron`, `medical`, `banking`.
Use an unset `TABBY_THEME` for the normal six-preset demo. Changes to the host
configuration require a server restart; HTML/CSS edits require a browser refresh.

Chats, source caches, uploads, sessions, and generated reports are ignored
runtime files under the Tableau skill's `temp/` and `artifacts/` directories
and `demo/reports/`. They are not part of this commit. Preserve them; do not
include credentials, logs, or private chat contents in a new handoff.

## Outstanding work / choose on return

1. **Review pending external-data feedback.** The external-data branch still
   needs additional validation per the user. No result of that outside
   validation has been supplied in this chat. Tableau Public, OWID life
   expectancy, and World Bank GDP per capita are implemented; this does not
   establish that every live data/assistant path has been approved.
2. **Manually check narrow windows** and the profile icon/Settings layout in
   the actual Chrome app. The automated browser remained at 1280px.
3. **Measure performance** with a browser trace and a real presenter workload
   if further optimization is desired. Fonts can change text wrapping; CSS
   variables still incur style/paint work.
4. **Plan a complete company-only export.** App fixed mode is ready as a
   foundation. Reports, HTML/PDF/print branding, approved company assets, and
   export/package contents still need work. Embedded Tableau/OWID content has
   separate styling. Do not claim that fixed app mode removes Action from
   all downloadable outputs.
5. **Publish only when requested.** The new local commit needs a push if the
   user wants GitHub updated. Keep it on the existing branch. Coordinate with
   any later external-data fixes before a future merge; do not merge now.

No new feature was chosen as the next automatic implementation task. Start by
reconciling this checkpoint and asking which outstanding item the user wants
to address.

## Working preferences to preserve

- Follow the repository's current `AGENTS.md`; prefer installed Action
  marketplace-managed skills. Action skills are maintained in GitHub, not
  discovered or saved through Notion.
- Keep Tabby's layout and functionality while adapting appearance.
- Keep customization in Settings, reached directly from the profile icon.
- Keep the demo flexible; eventual customer packages should use their chosen
  styling without an Action fallback across the complete delivered experience.
- Use the current CSS extraction branch unless the user changes that decision.
- Do not create a new branch, merge, publish a PR, or push new commits merely
  because this handoff has been read.
