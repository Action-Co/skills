# Tableau Skills for AI Agents

[![skills.sh](https://img.shields.io/badge/skills.sh-install-purple)](https://skills.sh/Action-Co/skills)

**Agent skills by [The Action Company](https://action.co) that give AI agents the ability to explore, understand, and interact with data and visualizations within your Tableau environment.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Action-Co/skills/a0815cb921f5d741096dcd527df87eb339433920/assets/banners/GitHub%20Banner%20-%20Option%203.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Action-Co/skills/a0815cb921f5d741096dcd527df87eb339433920/assets/banners/GitHub%20Banner%20-%20Option%203.svg">
  <img alt="Agent Skills by The Action Company" src="https://raw.githubusercontent.com/Action-Co/skills/a0815cb921f5d741096dcd527df87eb339433920/assets/banners/GitHub%20Banner%20-%20Option%203.svg" width="500">
</picture>

---

## The "Last Mile" Problem

When business users think about company data, they rarely think about a warehouse. They think about the dashboard they check every Monday, the data source their team curated with meaningful field names, or the view that already filters to their region. Tableau is the _last mile_ of analytics — the place where raw data is shaped into something consumable and actionable for decision-makers.

This visual and semantic context is enormously valuable, yet most AI analysts rarely incorporate it in their toolkit. They can query a database, but they can't explore what a business team has _already built_ on top of that database. They can't discover which data sources are certified, which views are most popular, or what calculations have been layered onto the raw tables.

These skills bridge that gap. They give agents the ability to authenticate against Tableau, navigate the data catalog, introspect data source schemas, trace lineage between workbooks and their upstream sources, and ultimately query the data — all programmatically.

> For a deeper perspective on why decomposing analytics into composable, agent-ready components matters more than preserving monolithic platform boundaries, read our article on [The Real Meaning of Headless BI](https://action.co/the-real-meaning-of-headless-bi).

---

## Installation

```bash
npx skills add Action-Co/skills
```

From the installer, select the specific Tableau skills you want to add to your agent.

---

## Available Skills

| Skill | Description |
|-------|-------------|
| **[Query Tableau Data](./query-tableau-data/)** | Explore the Tableau data catalog and query published data sources via VizQL Data Service. Implements a REPL-first Code Execution pattern with a Python SDK for authentication, inventory, lineage tracing, schema introspection, and data retrieval. |

![Bar and Whiskers Chart](https://github.com/Action-Co/skills/blob/main/assets/cover/Tableau%20Cover%20-%20(1440x168)%20-%20Transparent%20Background.png?raw=true)

---

## How It Works

These skills are [**CodeAct**](https://arxiv.org/abs/2402.01030) implementations. Instead of exposing Tableau operations as rigid JSON tool definitions (the MCP approach), they ship a lightweight SDK that agents import and execute directly. The agent writes and runs Python code in a persistent session — holding state as variables, composing operations with control flow, and self-debugging from execution feedback.

Key patterns:

- **REPL-first exploration** — Agents progressively explore the data catalog in a Read-Eval-Print Loop, printing only counts and filtered summaries to keep the context window lean
- **Session-based SDK** — A single `Session` object handles authentication, HTTP reuse, and catalog operations across the entire workflow
- **REPL-based state management** — For large Tableau sites, agents decompose discovery into sequential steps (scope → inventory → lineage → introspect), loading catalog data into variables and printing only counts and filtered summaries. This keeps the context window lean while the agent progressively explores the full catalog

See the individual skill READMEs for full design rationale, research-backed arguments for CodeAct over MCP, and step-by-step setup instructions.

---

## Stay Updated

Follow us on **[LinkedIn](https://www.linkedin.com/company/19173296)** for the latest insights, analysis, and new skill releases from The Action Company.

---

## Further Reading

- **[Our Approach](https://action.co/approach)** — The ACT framework: Advance (data aptitude), Create (compelling data messages), Transform (your organization)
- **[The Action Library](https://action.co/library)** — Thought leadership on Tableau, AI, and the future of analytics
- **[The Real Meaning of Headless BI](https://action.co/the-real-meaning-of-headless-bi)** — Why the future of analytics belongs to ecosystems, not platforms
- **[Connect With Us](https://action.co/connect)** — Book a chat or drop us a message

---

## License

See the `LICENSE` file in each skill for details.

---

![Action Co. Cover](https://github.com/Action-Co/skills/blob/main/assets/cover/Action%20-%20LinkedIn%20-%20Company%20Cover%20-%20(1129x192).png?raw=true)
