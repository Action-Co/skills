# Tabby demo launcher

Runs the Superstore demo on Tableau Public. No Tableau sign-in, no `.env` file, and no AI agent required.

## Running the demo

1. Open this `demo` folder in Finder.
2. Double-click **Start Tabby Demo.command**. The Tabby demo window opens on the welcome page.
3. The Superstore Overview dashboard loads and runs in the background while the welcome page shows its progress. Choose **View Superstore Overview** when you're ready to show it.
4. Use the side panel to pick a demo:
   - **Executive summary** runs all six Superstore dashboards side by side, then shows the report. Once it's ready, **Download** next to the Report tab saves it as HTML, PDF or Excel, styled with the Action brand. PDF needs Google Chrome.
   - **Overview, Customers, Shipping, Commission Model, Product, Performance** each open one dashboard and drive it on screen. **Run again** replays it. Above each dashboard is its title, a short description of what it shows, and who uses it.
   - **Welcome** goes back to the intro.

   The menu button at the top left hides or shows the side panel. The upper right shows what's on screen now. Each menu group (**Superstore demos**, **Ask Tabby**) collapses with a click on its heading.
5. If an AI agent is set up, ask Tabby questions. Tabby answers from the dashboards that are open and drives them on screen while it works.
   - The **Ask Tabby** button in the lower right opens the chat beside the current dashboard, and Tabby answers about that dashboard. A "Looking at …" tag above the question box shows which one; select its × to ask about anything instead. Pick another dashboard while the chat is open and the tag follows, with a divider in the conversation where the dashboard changed.
   - **New chat** in the side panel opens Ask Tabby as a full page: a question box with sample questions to start from. The side chat closes while the full page is showing.
   - On the full page, **Add dashboards** above the question box lists every Superstore dashboard. Pick one or more and Tabby answers from them together; one that isn't open yet loads in the background. Remove one with its ×.
   - The expand button in the chat switches between the side chat and the full page, keeping the same conversation. The dashboards keep running underneath.
   - Past chats are listed under **Ask Tabby** in the side panel. Pick one to open it full page and ask a follow-up.
   - Ask Tabby for a report ("make a report on profit by region I can share") and it builds an Action-branded report with **Open report**, **PDF** and **Excel** buttons in the chat. Tabby drafts reports in `reports/` (ignored by git).
   - To delete a chat, hover over it in the side panel and choose the trash icon, or use the trash icon at the top of an open chat. Tabby asks before deleting.
   - **Stop** ends an answer early.
6. When you're done, press Return in the Terminal window. That closes the dashboards.

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
- `app/server.ts`: the demo window's local server (127.0.0.1 only). It runs the view-tableau-dashboard CLI for the page, and runs the AI agent for Ask Tabby.
- `app/index.html`: the demo window: welcome page, side panel, dashboard area and Ask Tabby chat. Action-branded.
- `opening-prompt.md`: the agent's instructions for every chat. Plain text, shared by every agent.
- `dashboards.json`: the description and audience shown above each dashboard, keyed by the dashboard's name in `scripts.json`. Edit with any text editor. A dashboard without an entry shows its title only.
- `tabby-demo.conf`: which agent to use.
- `agents/`: agent-specific config, such as `claude-settings.json`, which pre-approves the dashboard commands.
- `lib/common.sh`: shared launcher setup.

The demo list comes from the `daily-executive-summary` workflow in `view-tableau-dashboard/scripts.json`, so dashboards added there appear in the menu automatically.

Ask Tabby chats are saved in `plugins/tableau-analytics/skills/view-tableau-dashboard/temp/chats.json` (ignored by git). Delete that file to clear every chat at once.

The executive summary sets `TABLEAU_VIZ_NO_OPEN=1` so the workflow shows its dashboards and report inside the demo window instead of opening browser tabs. The view-tableau-dashboard skill honors that variable in `openBrowser()`.

## Adding another AI agent

1. In `Start Tabby Demo.command`, add a line to `AGENTS`: `"id|Name|command"`. The launcher uses it to detect the agent and passes the id to the server.
2. In `app/server.ts`, add an adapter to `AGENT_ADAPTERS` under the same id. An adapter runs one chat message with the agent in headless mode and reports `turn`, `delta`, `tool`, `done` and `error` events (see `claudeAgent`). It should:
   - load the skills in `plugins/tableau-analytics`
   - use `opening-prompt.md` as its instructions
   - resume the agent's own conversation id for follow-ups
   - pre-approve the `tableau-viz.sh` commands if the agent supports that
3. Put any agent-specific config in `agents/`.

Then set `AGENT=<id>` in `tabby-demo.conf`, or leave it on `auto`.
