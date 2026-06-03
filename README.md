<!-- HERO IMAGE -- Marketing team: replace the srcset URLs below with the final banner asset -->
<!--
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://action.co/path/to/dark-banner.png">
  <source media="(prefers-color-scheme: light)" srcset="https://action.co/path/to/light-banner.png">
  <img alt="Agent Skills by The Action Company" src="https://action.co/path/to/light-banner.png" width="500">
</picture>
-->

# Agent Skills by The Action Company

[![skills.sh](https://img.shields.io/badge/skills.sh-install-purple)](https://skills.sh/Action-Co/skills)

**Agent skills that give AI coding agents the domain expertise to explore, query, and interact with the systems that power modern analytics.**

Built by **[The Action Company](https://action.co)**, an interdependent consultancy that helps organizations make better decisions in complex, fast-moving environments. We partner with data and leadership teams who are surrounded by information and seeking clarity — using advanced analytics, applied AI, and conscious leadership to turn fragmented details into shared understanding, decisive action, and decision systems that help teams see patterns sooner, align on what matters, and respond to changing conditions.

[Learn more about our approach](https://action.co/approach/) · [Explore our services](https://action.co/services-hero/) · [Meet the Actionauts](https://action.co/about/)

---

## Quickstart

```bash
npx skills add Action-Co/skills
```

From the installer, select the skills you want to add to your agent.

---

## Why Agent Skills?

Most AI agents can query a database. Few can navigate the semantic layers, business logic, and curated data models that teams have already built on top of that database.

These skills bridge that gap. They are **CodeAct** implementations — lightweight SDKs, documentation, and working code that agents import and execute directly. This gives agents:

- **Composition via control flow** — loop over catalogs, filter results programmatically, and chain operations in a single code block
- **Self-debugging from execution feedback** — observe typed exceptions, read error messages, and correct the next attempt without human intervention
- **State as variables** — hold catalog metadata, schemas, and query results as objects across turns, referencing them by name rather than re-fetching

For large enterprise environments, agents can apply the **Recursive Language Model (RLM)** pattern: decomposing discovery into sub-tasks (scope → inventory → lineage → introspect), calling themselves recursively on progressively narrower slices of the catalog. This keeps the context window lean while allowing `O(n)` semantic work across the entire site — the pattern that outperforms context compaction and sub-agent delegation in the research.

For a deeper look at why composable, code-first agent tooling outperforms monolithic platform approaches, see our article on [The Real Meaning of Headless BI](https://action.co/the-real-meaning-of-headless-bi/).

---

## Available Skills

### Tableau

| Skill | Description |
|-------|-------------|
| **[Query Tableau Data](./skills/tableau/query-tableau-data/)** | Explore the Tableau data catalog, trace lineage, and query published data sources via the VizQL Data Service. Implements a REPL-first Code Execution pattern with a Python SDK for authentication, inventory, lineage tracing, schema introspection, and data retrieval. |

---

## Stay Updated

Subscribe to our **[Analytics Advantage](https://action.co/connect/)** newsletter for the latest insights, analysis, and new skill releases from The Action Company.

---

## Support

If you need help or encounter issues with these skills, search for existing issues or open a new one in the [GitHub Issue Tracker](https://github.com/Action-Co/skills/issues).

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on reporting bugs, suggesting new skills, and submitting pull requests.

---

## Further Reading

- **[Our Approach](https://action.co/approach/)** — How we think about data aptitude, compelling data messages, and organizational transformation
- **[The Action Library](https://action.co/library/)** — Articles, interviews, and thought leadership from the Actionauts
- **[The Real Meaning of Headless BI](https://action.co/the-real-meaning-of-headless-bi/)** — Why composable analytics, not monolithic platforms, is the future of AI-powered data work
- **[Connect With Us](https://action.co/connect/)** — Book a chat or drop us a message

---

## License

These skills are distributed under the Apache 2.0 license. Each skill packages its own license file for to make it available to end users after installation. See the [LICENSE](./LICENSE) file for details.

---

*Reducing complexity to actionable insights.*
