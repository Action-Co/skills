# Tabby demo launcher

Runs the Superstore demo on Tableau Public. No Tableau sign-in, no `.env` file, and no AI agent required.

## Running the demo

1. Open this `demo` folder in Finder.
2. Double-click **Start Tabby Demo.command**. The Tabby demo window opens on the welcome page.
3. The Superstore Overview dashboard loads and runs in the background while the welcome page shows its progress. Choose **View Superstore Overview** when you're ready to show it.
4. Use the side panel to pick a demo:
   - **Executive summary** runs all six Superstore dashboards side by side, then shows the one-page report.
   - **Overview, Customers, Shipping, Commission Model, Product, Performance** each open one dashboard and drive it on screen. **Run again** replays it.
   - **Welcome** goes back to the intro.

   The menu button at the top left hides or shows the side panel. The upper right shows what's on screen now.
5. If an AI agent is set up, talk to Tabby in the Terminal window. It answers from the dashboards that are open.
6. When you're done, press Return in the Terminal window (or type `/exit` if Tabby is running). That closes the dashboards.

If something is missing, a dialog tells you what to ask for.

## Choosing the AI agent

`tabby-demo.conf` sets which agent runs alongside the demo:

- `AGENT=auto` (default): the first supported agent installed on this Mac
- `AGENT=claude`: Claude Code
- `AGENT=none`: no agent

## One-time setup (someone technical, once per Mac)

1. Install Bun: `curl -fsSL https://bun.sh/install | bash`
2. Clone the repo and check out the demo branch.
3. Optional, to talk to Tabby: install a supported AI agent and sign in. Currently supported: Claude Code (<https://docs.claude.com/en/docs/claude-code/overview>).
4. Recommended: install Google Chrome. The demo window opens as a clean app window in Chrome, and in the default browser otherwise.
5. Optional: copy the official `action_icon-white.svg` from the Drive Logo folder to `demo/app/logo.svg` to show the Action pictogram in the side panel.

The first launch installs the dashboard components (about a minute). Later launches start straight away.

## Files

- `Start Tabby Demo.command`: starts the demo window and the agent.
- `app/server.ts`: the demo window's local server (127.0.0.1 only). It runs the view-tableau-dashboard CLI for the page.
- `app/index.html`: the demo window: welcome page, side panel and dashboard area. Action-branded.
- `opening-prompt.md`: the agent's first message. Plain text, shared by every agent.
- `tabby-demo.conf`: which agent to use.
- `agents/`: agent-specific config, such as `claude-settings.json`, which pre-approves the dashboard commands.
- `lib/common.sh`: shared launcher setup.

The demo list comes from the `daily-executive-summary` workflow in `view-tableau-dashboard/scripts.json`, so dashboards added there appear in the menu automatically.

The executive summary sets `TABLEAU_VIZ_NO_OPEN=1` so the workflow shows its dashboards and report inside the demo window instead of opening browser tabs. The view-tableau-dashboard skill honors that variable in `openBrowser()`.

## Adding another AI agent

In `Start Tabby Demo.command`:

1. Add a line to `AGENTS`: `"id|Name|command"`.
2. Add a `start_<id>` function that loads the skills in `plugins/tableau-analytics`, sends `opening-prompt.md` as the first message, and pre-approves the `tableau-viz.sh` commands if the agent supports that.
3. Put any agent-specific config in `agents/`.

Then set `AGENT=<id>` in `tabby-demo.conf`, or leave it on `auto`.
