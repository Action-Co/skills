# Tabby demo launcher

Runs the Superstore demo on Tableau Public. No Tableau sign-in, no `.env` file.

## Running the demo

1. Open this `demo` folder in Finder.
2. Double-click **Start Tabby Demo.command**.
3. A Terminal window opens with Claude, and a browser tab opens with the Superstore Overview dashboard. Claude describes the dashboard and suggests what to ask next.
4. Type questions into the Terminal window. Try: "Run the daily executive summary across all six Superstore dashboards."
5. When you're done, type `/exit` (or close the Terminal window).

If something is missing, a dialog tells you what to ask for.

## One-time setup (someone technical, once per Mac)

1. Install Claude Code: <https://docs.claude.com/en/docs/claude-code/overview>
2. Install Bun: `curl -fsSL https://bun.sh/install | bash`
3. Run `claude` once in Terminal and sign in.
4. Clone the repo and check out the demo branch.
5. Optional: install Google Chrome. Tableau Public works in other browsers, but the dashboard skill prefers Chrome.

The first launch installs the dashboard components (about a minute). Later launches start straight away.

## What the launcher does

- Checks for Claude Code and Bun, and shows a dialog if either is missing.
- Installs the dashboard skill's dependencies on first run.
- Starts Claude with the `tableau-analytics` plugin loaded from this repo (`--plugin-dir`), so demoers don't install plugins and always run this branch's version.
- Loads `tabby-demo-settings.json`, which pre-approves only the dashboard commands so no permission prompts interrupt the demo.
- Sends `opening-prompt.md` as the first message.
- Stops the dashboard bridge when Claude exits.
