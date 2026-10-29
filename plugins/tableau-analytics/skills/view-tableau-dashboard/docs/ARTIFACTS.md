# Serving Artifacts — ARTIFACTS.md

How to hand an agent-produced file (an HTML report, an exported JSON) to the
human, on the same localhost origin and browser as the viz tabs — and how to
build an interactive page that lets the human trigger scripts themselves.

## The mechanism

- Write the file to `artifacts/` under the skill directory (sibling to
  `docs/`, `scripts/`, `src/`). The directory is gitignored — `temp/` holds
  only the session registry — so the **end user decides** whether to keep or
  commit anything produced here.
- The bridge serves it at `http://127.0.0.1:<port>/artifacts/<name>`.
  Content-type is inferred from the file extension.
- **Safe names only:** single-segment, matching `[a-zA-Z0-9][a-zA-Z0-9._-]*` —
  no slashes, so no path traversal. Dotted names (`.env`) are rejected.
- Open it with:

```bash
./tableau-viz.sh open-artifact report.html
```

`open-artifact` opens the URL in the **same Chrome-first browser** as the viz
tabs (falling back to the OS default), so the demo finals live on the same
localhost origin and browser as the viz tabs — the human does not jump between
two browsers.

## Writing an artifact-producing eval

Artifacts are produced by an eval (see `docs/JS_EVALS.md` for the full eval
authoring guide) and written to disk by the CLI (`-o <file>`), or by a script
that returns the distilled result:

```bash
./tableau-viz.sh eval 'return helpers.readVizData("Table", { maxRows: 500 })' \
  --intent "Reading summary data for the report" -f json -o artifacts/table.json
```

Authoring rules for artifact evals:

- Evals take **no arguments** — discover values from the dashboard and loop.
- Start from a **known state** and **reset the viz to its default state** when
  done (clear filters/selections) so re-runs are reproducible.
- Loop the `"relevant"` domain and **survive empty readers** (a zero-row
  worksheet is empty data, not an error).
- **Aggregate in-page** and return the distilled result — never raw rows —
  and mind the serializer caps (depth 6, arrays 5000) and the ~90s in-page
  eval budget.

For the report HTML itself, write the file and `open-artifact` it; the
bridge does not transform your content.

## Branded reports: HTML, PDF and Excel

Reports for people should use the Action brand. Don't hand-style them: write
Markdown and let the CLI apply the brand.

```bash
./tableau-viz.sh report path/to/q3-margins.md --eyebrow "Tabby report" --pdf --xlsx -f json
```

- **Markdown shape:** a `# ` title (becomes the page headline), a short opening
  paragraph with the main finding, `## ` sections, and Markdown tables for the
  numbers. Write money as `$1,234` and percentages as `12.5%` so Excel gets
  real numbers. Raw HTML in the Markdown is escaped, and only http(s), mailto
  and relative links are kept.
- **HTML** (`artifacts/<name>.html`): Kanit, the Action palette, dark (Blue
  Raven) on screen and light when printed. Options: `--title`, `--subtitle`,
  `--eyebrow`, `--name`, `--open`.
- **PDF** (`--pdf`): printed by headless Google Chrome with the light theme.
  Fails with a clear message if Chrome isn't installed.
- **Excel** (`--xlsx`): every `## ` section that has a table gets its own sheet
  (prose-only sections stay on the sheet before them; a `<section>` in a
  hand-built report always gets one). Tables keep the brand table style: Blue
  Raven header row with white bold text, bold first column, thin Cool Grey
  borders, Kanit. Money and percentages become numbers with formats.
- **Logo:** the brand forbids redrawing the logo. Add the official
  `action_icon-white.svg` and `action_icon-raven.svg` (Drive *Logo* folder →
  SVG → Standard) to `assets/` and every report shows it; until then the page
  carries a labeled placeholder comment.

To export an HTML report that's already in `artifacts/` (for example the daily
executive summary):

```bash
./tableau-viz.sh export daily-executive-summary.html --as all   # or pdf, xlsx
```

The files land next to the HTML and are served at `/artifacts/<name>`.

## Interactive pages: let the human trigger scripts

A static artifact shows results. An **interactive page** goes further: the human
clicks a button and a registered script or workflow runs live on a dashboard,
with no agent in the loop. Because the page only triggers scripts already in
`scripts.json`, every run is **100% reproducible**. An agent can still run
alongside for ad-hoc questions, using the same CLI.

Reference implementation: the Tabby demo in this repo, `demo/app/`
(`index.html` is the page, `server.ts` is the local server). Read it before
building a new one.

### Why a page alone isn't enough

A web page can't launch programs, and the bridge only serves files from
`artifacts/` — it has no "run a script" endpoint. So an interactive page is
two pieces:

1. **The page** — plain HTML/CSS/JS. It shows the menu, embeds dashboards and
   shows progress.
2. **A small local server** (Bun works well; the skill already needs it). It
   serves the page and runs `tableau-viz.sh` on the page's behalf.

```
page (browser) ──fetch──▶ local server ──spawn──▶ tableau-viz.sh ──▶ bridge ──▶ viz tab
      ▲                                                                            │
      └───────────────────── <iframe src=tabUrl> ◀─────────────────────────────────┘
```

### The CLI calls a page needs

| Goal | Command | Use the output |
|------|---------|----------------|
| Open a dashboard and run its script | `start --url <view> --script <name> --no-open -f json` | `{ session, tabUrl }` — put `tabUrl` in an `<iframe>` |
| Know when it's ready | `wait --session <id> -f json` | Exit code 0 = interactive. Blocks up to 90s, so raise the server's request timeout |
| Run a whole workflow | `run <workflow> --intent "..."` with env `TABLEAU_VIZ_NO_OPEN=1` | Last `http…` line on stdout is the report URL |
| Per-dashboard progress | read the `run` stderr **as it streams** | `finished: <step> (ok\|error)`, `retrying <step> after:`, `retry collected: <step> (ok)`, `retry for <step> failed:` |
| Find a workflow step's tab | `temp/sessions.json` | Newest session whose `url` matches the step and was created after the run started |
| Clean up | `stop` | Closes every session and the bridge — call it when the page's server exits |

Notes:

- `--no-open` and `TABLEAU_VIZ_NO_OPEN=1` keep the CLI from opening browser
  tabs, because the page shows the dashboards itself.
- Build the page's menu from `scripts.json` (for example, the steps of a
  workflow) instead of hard-coding it, so new scripts show up automatically.
- For dashboards shown as small tiles, add `&toasts=compact` to the `tabUrl`:
  one small toast at a time in the bottom-right corner, and the status chip
  only shows errors and sign-in prompts.

### Security rules (keep these)

- Bind the page's server to **`127.0.0.1` only**, like the bridge.
- The page sends **ids, never code**. The server looks the id up in
  `scripts.json` and builds the command itself. Never pass JavaScript, shell
  text or file paths from a request to the CLI, and never add an `eval`
  endpoint — that would hand the eval surface to anything that can reach the
  port (see `docs/SECURITY.md`).
- Spawn with an argument array (`Bun.spawn([TABLEAU_VIZ, "start", ...])`), not
  a shell string.
- Validate ids in the route (for example `^[a-zA-Z0-9_-]+$`) and return 404
  for unknown ones.

### Pitfalls we hit

- **Tableau doesn't finish loading in a hidden iframe.** With
  `visibility: hidden` or `display: none` the viz stalls in `loading`. To load
  dashboards in the background, keep inactive views rendered but invisible:
  `opacity: 0; pointer-events: none`, plus the `inert` attribute.
- **A `visibility: visible` child shows through a hidden parent.** If a nested
  panel uses `visibility`, give its active state `visibility: inherit`,
  otherwise it covers the page and swallows clicks.
- **Create a view's element before marking it active.** If the element is
  created after the "show this view" step runs, the screen stays blank.
- **Don't overlap heavy runs.** Starting a workflow while another is still
  running puts a dozen embeds in one browser. Tabs drop, the workflow retries
  (minutes instead of ~20s), and the embed may show a false "sign in" prompt
  — it assumes sign-in is needed if nothing draws within 5s. Disable or ignore
  "run again" while a run is in progress (the server should return the
  current run instead of starting a second one).
- **Re-running creates new sessions.** `start` on a re-run opens a new tab;
  replace the old iframe so the old session disconnects.

### UX patterns that worked

- **Show progress, don't jump.** Load in the background and show a spinner,
  then a ready state; let the presenter choose when to open a dashboard or the
  report ("Report is Ready") instead of switching views automatically.
- **One status per dashboard.** On a grid, a spinner on each tile's title line
  that turns into a checkmark (or a muted "!" on failure) reads at a glance.
- **Keep the report tab reachable** while it builds, with a "being generated"
  message, so clicking it early is never a dead end.
- **Say what's on screen.** A "Now viewing … / Live" indicator and a
  "Run again" control make a live demo easy to narrate.
