# Tabby demo launcher

For the November 25, 2026 checkpoint and a copyable resume prompt, see the
[current handoff](docs/HANDOFF.md).

Runs the Superstore demo on Tableau Public, the Our World in Data life expectancy chart,
and the World Bank GDP per capita demo. These public sources need no provider sign-in
or `.env` file. Viewing charts does not
require an AI agent; Ask Tabby uses your configured assistant.

For the selection rationale and integration boundaries, see the draft
[external data source exploration](docs/data-source-exploration.md).

## Choosing a data source

The home page has a compact **Choose a demo** panel with all three sources.
In **Superstore**, choose a Tableau dashboard or the executive summary, then
select **Open**. Select **Open** beside **Life expectancy** or **GDP per capita**
to launch that chart and its analysis scope.
You can return to **Welcome** at any time to choose again.

**Welcome** stays at the top of the sidebar. The fixed **Data source** picker
underneath it switches between
**Tableau Public**, **Our World in Data**, and **World Bank**. One provider is active at a time.
The chart changes and the chat's **Using** label follows. Existing messages stay
in the chat, with a context divider before the next question. Switching providers
starts a fresh assistant session so prior-source data is not silently reused.
Returning to a Tableau dashboard checks its live session. Healthy dashboards
keep their filters; a missing or disconnected session is reopened automatically.

For **Our World in Data**, Life expectancy opens beside chat when an assistant
is available. The initial comparison is Canada, Japan, and the United States,
2000–2020. The country selector shows the selected names on one row. Open it to
search countries by name or code and select a result to add a country chip.
Remove a chip with its × button inside the dropdown. The picker also supports
arrow keys and Enter; Escape closes it. Select up to 10 countries and a year range, then choose
**Apply scope**.
Sending is paused while changes are unapplied or data is unavailable. A question
that needs other countries or years requires applying a new scope first.

The chart remains interactive. Its own country selectors, tabs, and timeline do
not update Tabby's analysis scope. **Reset chart to scope**, or send a question,
to restore the chart to the applied comparison. Answers query a dated CSV extract
and include their scope, retrieval time, source citation, and missing-data limits.
The live chart can be revised separately; identical revision matching is not guaranteed.

All three providers use the same inset chart container, rounded border, and
outer spacing. On smaller windows the shared spacing reduces to preserve room
for the visualization. The OWID demo scrolls vertically, with a minimum chart
height and extra space below it when chat is closed so its footer and controls
can scroll above the floating **Ask Tabby** button.

**Refresh data** retrieves a new extract and reapplies the scope. If refreshing
fails, answers remain paused until data and scope are ready. An offline interactive
chart and automatic readback of native chart selections are not supported.

OWID does not require a login or API key. Tabby embeds the hosted chart and queries
its published data, rather than redistributing OWID's charting software. Retain
the source citations when sharing results. See [OWID's reuse guidance](https://ourworldindata.org/faqs).

## World Bank GDP per capita

Choose **Open** beside **GDP per capita** on the home page, or **World Bank** in the sidebar.
It starts with Canada, Japan, and the United States for 2000–2020, using
[GDP per capita (constant 2015 US$)](https://data.worldbank.org/indicator/NY.GDP.PCAP.KD)
from World Development Indicators (source 2). This is inflation-adjusted output
per person, rather than household income or a purchasing-power-parity measure.

The compact searchable country selector supports up to ten countries. Change
countries or years, then select **Apply scope**. Unapplied edits pause answers.
The locally rendered chart and Tabby's SQL analysis use the exact same immutable
snapshot and applied scope. Hover the chart or use **Explore year** with the arrow
keys to inspect values; this does not change the scope. **View scoped data** opens
the accessible observation table. Missing values appear as gaps and explicit
missing observations, and are never interpolated or replaced by zero.

**Refresh data** retrieves the indicator metadata, country catalog, and every
observation page again. It verifies pagination and source update consistency.
Prior snapshots and extracts remain available to existing questions. Source
attribution, CC BY 4.0, units, retrieval time, and the World Bank update date are
shown with results. The source API requires no key or visitor account.

World Bank caches are saved in `view-tableau-dashboard/temp/world-bank/` (ignored
by git). They are separate from uploaded files and retained when a chat is deleted.
The active catalog is loaded on demand, with up to eight in-memory snapshots.
New data requests need network access; an already loaded chart uses local data.

## Settings and appearance

Select the **profile icon** beside the Tabby name at the top of the sidebar
to open **Settings** directly, then choose a theme under **Appearance**. The demo includes Action Dark, PNC Bank, Aetna, Micron,
Medical Company, and Banking Company. The company presets are interpretations
for demos, rather than approved brand packages; the medical and banking presets
are generic. The company-inspired presets do not bundle company logos or
proprietary fonts.

The selection applies immediately and is remembered in this browser. It does not
reload dashboards, reset chart selections, or restart the assistant. Settings
temporarily closes the chat drawer while preserving the conversation and scope.
Return to your dashboard or chat through the sidebar. The homepage has no theme
controls.

The app shell and Tabby's locally rendered World Bank chart follow the selected
theme. Embedded Tableau and OWID charts keep their own styling. Reports and
downloads still use the existing Action report generator.

For a copy with one fixed appearance, start with a theme ID in `TABBY_THEME`:

```bash
TABBY_THEME=pnc bash 'demo/Start Tabby Demo.command'
```

Valid IDs: `action-dark`, `pnc`, `aetna`, `micron`, `medical`, `banking`.
Without this variable the app offers all demo themes, defaulting to Action Dark.
With it, Settings shows only the chosen theme, read-only. The host serves only
that theme's CSS and metadata and renders it in the initial HTML. Old browser
preferences are ignored; invalid IDs stop startup instead of silently falling
back to Action. Switching configuration requires restarting the app server.

This fixed mode is an app appearance foundation, **not a complete company export**.
Before shipping a company-only package, the report generator, print/export
branding, approved assets, and package contents also need to be addressed.
See [the appearance implementation notes](docs/appearance.md).

## Running the demo

1. Open this `demo` folder in Finder.
2. Double-click **Start Tabby Demo.command**. The Tabby demo window opens on the welcome page.
3. The Superstore Overview dashboard loads and runs in the background while the home page shows its progress. Choose a source in **Choose a demo** and select **Open**. The Tableau row also lets you choose a dashboard or executive summary.
4. Use the side panel to pick a demo:
   - **Executive summary** runs all six Superstore dashboards side by side, then shows the report. Once it's ready, **Download → HTML** or **PDF** next to the Report tab saves it with the Action brand. HTML works without Chrome; PDF needs Google Chrome and an unrestricted Tabby host.
   - **Overview, Customers, Shipping, Commission Model, Product, Performance** each open one dashboard and drive it on screen. **Run again** replays it. Above each dashboard is its title, a short description of what it shows, and who uses it.
   - **Welcome** goes back to the intro.

   The menu button at the top left hides or shows the side panel. The upper right shows what's on screen now. Each menu group (**Tableau Public**, **Our World in Data**, **Ask Tabby**) collapses with a click on its heading. The source picker remains above the scrolling menu.
5. To ask Tabby questions, Ask Tabby needs an AI agent. The first time, choose **Set up Ask Tabby** in the lower left and pick **ChatGPT** or **Claude**. Tabby installs the agent (about a minute, no admin password) and opens a browser to sign in with that account. When the browser says you're signed in, come back to the Tabby window. Tabby then asks the agent a test question to make sure your account can really use it (signing in to ChatGPT doesn't mean the plan includes Codex), and Ask Tabby turns on by itself. This happens once per Mac.

   To change assistants later, choose **Switch AI assistant** in the lower left. The one in use is marked; one that's already installed and signed in switches right away, and one that isn't goes through the same install and sign-in. Past chats stay, and a follow-up in a past chat starts a new conversation with the new assistant. If switching fails, Ask Tabby keeps the assistant it had.

   Once an agent is set up, ask Tabby questions. For Tableau, Tabby answers from the selected dashboards and drives them on screen. For OWID, it queries the applied country/year extract beside the interactive chart.
   - The **Ask Tabby** button in the lower right opens the chat beside the current dashboard, and Tabby answers about that dashboard. A "Looking at …" tag above the question box shows which one; select its × to ask about anything instead. Pick another dashboard while the chat is open and the tag follows, with a divider in the conversation where the dashboard changed.
   - **New chat** in the side panel opens Ask Tabby as a full page: a question box with sample questions to start from. The side chat closes while the full page is showing.
   - On the full page, **Add dashboards** above the question box lists every Superstore dashboard. Pick one or more and Tabby answers from them together; one that isn't open yet loads in the background. Remove one with its ×.
   - The expand button in the chat switches between the side chat and the full page, keeping the same conversation. The dashboards keep running underneath.
   - Past chats are listed under **Ask Tabby** in the side panel. Pick one to open it full page and ask a follow-up.
   - Ask Tabby for a report ("make a report on profit by region I can share") and it builds an Action-branded report with **Open report**, **HTML**, and **PDF** buttons in the chat. HTML downloads a shareable `.html` file. PDF is created only when clicked; it is disabled if Chrome is unavailable or the host is sandboxed. Tabby drafts reports in `reports/` (ignored by git).
   - To analyze your own data, attach CSV files with the paperclip in the question box, or drag them onto the chat (up to 5 per question, 50 MB each). Each file shows its row and column count once it's uploaded. Ask a question about it, or send it with no question for a quick overview. Tabby can combine a file with the dashboards ("compare this target sheet with actual sales by region"), and the file stays available for follow-ups in that chat.
   - To delete a chat, hover over it in the side panel and choose the trash icon, or use the trash icon at the top of an open chat. Tabby asks before deleting.
   - **Stop** ends an answer early.
6. When you're done, press Return in the Terminal window. That closes the dashboards.

If something is missing, a dialog tells you what to ask for.

## Choosing the AI agent

`tabby-demo.conf` sets which agent runs alongside the demo:

- `AGENT=auto` (default): the first supported agent installed and signed in on this Mac, in this order: Claude Code, then Codex
- `AGENT=claude`: Claude Code
- `AGENT=codex`: Codex, OpenAI's coding agent. It signs in with a ChatGPT plan (Plus, Pro, Business, Enterprise or Edu).
- `AGENT=none`: no agent

If no agent is installed and signed in, the lower left says "Ask Tabby is off" and shows **Set up Ask Tabby**. The dashboards still work. Setup installs the chosen agent, runs its sign-in, and sets `AGENT=` to it in this file.

Setup installs:

- Codex with `bun install -g @openai/codex` (into `~/.bun/bin`) and signs in with `codex login`
- Claude Code with its installer, `curl -fsSL https://claude.ai/install.sh | bash` (into `~/.local/bin`), and signs in with `claude auth login`

On a ChatGPT Business or Enterprise plan, a workspace admin may need to turn on Codex before sign-in works.

While Tabby waits for sign-in, **Open the sign-in page** opens it again, and Tabby notices a sign-in finished anywhere (another browser tab, a Terminal window, another app) and carries on. If sign-in fails, **Sign in another way** opens a Terminal window that runs the agent's own sign-in; the presenter only signs in in the browser page it opens, with nothing to type, and Tabby continues by itself.

If Codex's browser sign-in doesn't open, choose **Sign in with a code** (in the setup dialog's error view, or "sign in with a code instead" while it waits). Tabby runs `codex login --device-auth` and shows a link and a one-time code to enter on the ChatGPT sign-in page; it works for 15 minutes and doesn't need the browser to reach back to this Mac.

Codex installed with npm or Bun is a small Node.js launcher. Macs without Node.js can still run it: Tabby puts a `node` link to its own Bun last on the PATH it gives agents (in `view-tableau-dashboard/temp/node-shim/`), so a real Node.js still wins when there is one.

Tabby looks for an agent that's already installed on the PATH the presenter's shell sets up (for example Codex installed with npm under nvm or Volta), so it doesn't install a second copy. Every setup step has a time limit (5 seconds to read the shell PATH, 5 minutes to install, 10 minutes to sign in) and shows how long it has been running; **Cancel** stops setup at any step, right away. Setup writes everything it runs and prints to `plugins/tableau-analytics/skills/view-tableau-dashboard/temp/tabby-setup.log` (ignored by git), and the dialog points to it when setup fails.

The test-question result is saved per agent in `view-tableau-dashboard/temp/tabby-agents.json` (ignored by git). An agent whose last test failed isn't turned on at launch; choosing it again in the dialog checks again. The same `AGENT_*` explanations appear in Ask Tabby when an answer fails for one of those reasons.

When setup fails, the dialog says why in plain language with an error code, and **Copy details** copies a report to send to whoever is helping: the error, which agents are installed and signed in, the macOS, Bun and Tabby versions, PATH, and the last 40 lines of the setup log. Home folder paths, emails and link parameters are removed from the report. Error codes:

| Code | Meaning |
|------|---------|
| `INSTALL_NETWORK` | The download was blocked or couldn't connect (VPN, firewall, proxy, certificates) |
| `INSTALL_TIMEOUT` | The install took over 5 minutes and was stopped |
| `INSTALL_DISK` | Not enough disk space |
| `INSTALL_PERMISSION` | The Mac blocked writing to the install folder |
| `INSTALL_NOT_FOUND` | The install finished but Tabby can't find the command |
| `INSTALL_FAILED` | Any other install failure; see the last output line |
| `SIGNIN_BUSY` | Another sign-in for the same agent is already waiting |
| `SIGNIN_NOT_ALLOWED` | The account signed in but isn't allowed to use the agent (for example, Codex not turned on for a ChatGPT workspace) |
| `SIGNIN_NO_PAGE` | The agent quit before giving a sign-in page; the message quotes what it said. For Codex, try **Sign in with a code** |
| `SIGNIN_NO_CODE` | Codex didn't give a sign-in code (a ChatGPT workspace admin may need to allow sign-in with a code) |
| `SIGNIN_TERMINAL` | Tabby couldn't open the Terminal window for "Sign in another way" |
| `SIGNIN_TERMINAL_FAILED` | The sign-in in the Terminal window stopped before opening a sign-in page; the message quotes it |
| `AGENT_NO_ACCESS` | Signed in, but the plan or workspace can't use the agent (for example, a ChatGPT plan without Codex, or Codex not turned on for the workspace) |
| `AGENT_LIMIT` | Signed in, but the plan has used up its allowance for now |
| `AGENT_SIGNED_OUT` | The agent's sign-in has expired |
| `AGENT_NETWORK` | The agent couldn't reach its service |
| `CHECK_TIMEOUT` | The test question got no answer within 90 seconds |
| `CHECK_FAILED` | Any other reason the test question failed; the message quotes the agent |
| `SIGNIN_TIMEOUT` | Sign-in wasn't finished within 10 minutes (15 for a sign-in code) |
| `SIGNIN_FAILED` | Any other sign-in failure |

### Codex notes

Codex has no plugin or system-prompt option, so the first message of each chat includes `opening-prompt.md` and points Codex at the skill guides in `plugins/tableau-analytics/skills/`. Follow-ups resume the same Codex conversation.

Codex runs in its `workspace-write` sandbox. The sandbox doesn't let Codex signal processes outside it, so view-tableau-dashboard treats a session whose bridge it can't signal (`EPERM`) as alive rather than dropping it. The sandbox limits Codex to the repo folder, with local network turned on so `tableau-viz.sh` can reach the dashboards. It never stops to ask for approval; a command the sandbox blocks fails instead. Codex sends whole messages rather than streaming them word by word, so answers appear in larger steps than with Claude Code.

Report creation does not launch Chrome from a chat agent. Both agents receive
`TABLEAU_VIZ_NO_PDF=1` and write HTML; Tabby adds the download controls. PDF printing
runs in the host app only when requested. This avoids the macOS Chrome startup
crash caused by restricted application registration. A host started in a known
sandbox disables PDF before launch; restart Tabby with its normal launcher to
enable it. HTML remains available if PDF fails or Chrome is missing.

## One-time setup (once per Mac)

1. Clone the repo and check out the demo branch.
2. Optional: install Bun ahead of time (`curl -fsSL https://bun.sh/install | bash`). Otherwise the first launch asks to install it.
3. Optional: set up an AI agent ahead of time. Otherwise the presenter can use **Set up Ask Tabby** in the demo window.
4. Recommended: install Google Chrome. The demo window opens as a clean app window in Chrome, and in the default browser otherwise.
5. The official Action pictogram is bundled as `app/logo.svg` and appears beside Tabby in Action Dark. Company demo themes do not display the Action logo.

The first launch installs Bun if needed (it asks first) and the dashboard components (about a minute each). Later launches start straight away.

## Files

- `Start Tabby Demo.command`: starts the demo window, installing Bun first if needed.
- `app/server.ts`: the demo window's local server (127.0.0.1 only). It runs the view-tableau-dashboard CLI for the page, picks and runs the AI agent for Ask Tabby, and installs and signs in to an agent for Set up Ask Tabby.
- `app/index.html`: the demo window: welcome page, side panel, dashboard area and Ask Tabby chat. Action-branded.
- `app/styles.css`: the demo window's shared layout, component states, animations, responsive rules, and Settings page. Served at `/styles.css`; linked from `app/index.html`.
- `app/logo.svg`: unmodified official Action icon from the [Logo library](https://drive.google.com/file/d/1RF4IVXnzM7S42KEu4MDz1NeQp-WgKwDW/view).
- `app/themes.css`: complete theme variables shared by the app and Settings previews; no repeated component rules.
- `app/themes.js`: applies the saved theme before paint and builds the Settings appearance choices.
- `app/appearance.ts`: validates the host's demo/fixed configuration and serves the permitted theme CSS, metadata, and initial branding.
- `app/owid.ts`: the fixed life expectancy data endpoints, bounded downloads, schema checks, country/year scope, immutable extracts, and answer provenance.
- `app/world-bank.ts`: the fixed GDP indicator, paginated downloads, country catalog, immutable scoped extracts, and answer provenance.
- `app/world-bank-chart.js`: the interactive chart, keyboard year explorer, and accessible data table, rendered from the applied extract.
- `opening-prompt.md`: the agent's instructions for every chat. Plain text, shared by every agent.
- `dashboards.json`: the description and audience shown above each dashboard, keyed by the dashboard's name in `scripts.json`. Edit with any text editor. A dashboard without an entry shows its title only.
- `tabby-demo.conf`: which agent to use.
- `agents/`: agent-specific config, such as `claude-settings.json`, which pre-approves the dashboard commands for Claude Code. Codex's settings are flags in its adapter in `app/server.ts`.
- `tools/tabby-csv.sh`: the agent's read-only tool for attached CSV files (`describe`, `head`, `sql`). It loads the files into an in-memory SQLite database, so the files are never changed. `tools/csv.ts` holds the parsing and type detection shared with the upload endpoint.
- `lib/common.sh`: shared launcher setup.

The demo list comes from the `daily-executive-summary` workflow in `view-tableau-dashboard/scripts.json`, so dashboards added there appear in the menu automatically.

Ask Tabby chats are saved in `plugins/tableau-analytics/skills/view-tableau-dashboard/temp/chats.json` (ignored by git). Delete that file to clear every chat at once.

CSV files attached in Ask Tabby are saved in `view-tableau-dashboard/temp/uploads/` (ignored by git), one folder per file. Deleting a chat deletes its files, and a file removed before sending is deleted right away.

OWID metadata and scoped CSV extracts are saved in `view-tableau-dashboard/temp/owid/`
(ignored by git). They are shared source caches, separate from uploaded personal
files, and are retained when a chat is deleted. Each extract is addressed by the
data/metadata hash and normalized scope; refreshing does not overwrite different
snapshots. The active catalog is loaded on demand and retained for the server's
lifetime, with up to eight snapshots available for scope requests.

The executive summary sets `TABLEAU_VIZ_NO_OPEN=1` so the workflow shows its dashboards and report inside the demo window instead of opening browser tabs. The view-tableau-dashboard skill honors that variable in `openBrowser()`.

## Adding another AI agent

1. In `app/server.ts`, write an adapter. An adapter runs one chat message with the agent in headless mode and reports `turn`, `delta`, `tool`, `done` and `error` events (see `claudeAgent` and `codexAgent`). It should:
   - load the skills in `plugins/tableau-analytics`
   - use `opening-prompt.md` as its instructions
   - resume the agent's own conversation id for follow-ups
   - pre-approve the `tableau-viz.sh` commands if the agent supports that
2. Add an entry to `AGENTS` in `app/server.ts`: its id, name, command, adapter, how to install it without an admin password, how to sign in, and how to check sign-in. AGENT=auto tries the entries in order.
3. To offer it in **Set up Ask Tabby**, add it to `SETUP_CHOICES` in `app/index.html` and to the list `openSetup()` shows.
4. Put any agent-specific config in `agents/`.

Then set `AGENT=<id>` in `tabby-demo.conf`, or leave it on `auto`.
