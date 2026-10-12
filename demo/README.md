# Tabby demo launcher

Runs the Superstore demo on Tableau Public. No Tableau sign-in, no `.env` file, and no AI agent required.

## Running the demo

1. Open this `demo` folder in Finder.
2. Double-click **Start Tabby Demo.command**.
3. Pick how to run the demo:
   - **Talk to Tabby with (agent)**: appears for each supported AI agent installed on this Mac. The agent opens the Superstore Overview dashboard, describes it, and suggests what to ask next. Type questions into the Terminal window.
   - **Autopilot (no AI)**: opens all six Superstore dashboards, drives their filters and parameters on screen, and ends on the executive summary report.
   - **Open the Superstore dashboard (no AI)**: opens the Overview dashboard for a presenter-led walkthrough.
4. When you're done, press Return in the Terminal window (or type `/exit` in an agent session).

If something is missing, a dialog tells you what to ask for.

## One-time setup (someone technical, once per Mac)

1. Install Bun: `curl -fsSL https://bun.sh/install | bash`
2. Clone the repo and check out the demo branch.
3. Optional, for the conversational demo: install a supported AI agent and sign in. Currently supported: Claude Code (<https://docs.claude.com/en/docs/claude-code/overview>).
4. Optional: install Google Chrome. Tableau Public works in other browsers, but the dashboard skill prefers Chrome.

The first launch installs the dashboard components (about a minute). Later launches start straight away.

## Adding another AI agent

Each agent has a small adapter in `Start Tabby Demo.command`:

1. Add a line to `AGENTS`: `"id|Menu name|command"`.
2. Add a `start_<id>` function that loads the skills in `plugins/tableau-analytics`, sends `opening-prompt.md` as the first message, and pre-approves the `tableau-viz.sh` commands if the agent supports that.
3. Put any agent-specific config in `agents/` (for example, `agents/claude-settings.json`).

`opening-prompt.md` is plain text, so every agent uses the same one.
