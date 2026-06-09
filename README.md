# Agent Skills by The Action Company

[![skills.sh](https://img.shields.io/badge/skills.sh-install-purple)](https://skills.sh/Action-Co/skills)

**Agent skills that give AI coding agents the domain expertise to explore, query, and interact with the systems that power modern analytics.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Action-Co/skills/a0815cb921f5d741096dcd527df87eb339433920/assets/banners/GitHub%20Banner%20-%20Option%202.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Action-Co/skills/a0815cb921f5d741096dcd527df87eb339433920/assets/banners/GitHub%20Banner%20-%20Option%202.svg">
  <img alt="Agent Skills by The Action Company" src="https://raw.githubusercontent.com/Action-Co/skills/a0815cb921f5d741096dcd527df87eb339433920/assets/banners/GitHub%20Banner%20-%20Option%202.svg" width="500">
</picture>

Built by **[The Action Company](https://action.co)**, an interdependent consultancy that helps organizations make better decisions in complex, fast-moving environments. We partner with data and leadership teams that are surrounded by information and seeking clarity. Through advanced analytics, applied AI, and conscious leadership, we help transform fragmented details into shared understanding, decisive action, and decision systems that enable teams to spot patterns sooner, align on what matters, and adapt to changing conditions.

[Learn more about our approach](https://action.co/approach) · [Explore our services](https://action.co/services-hero) · [Meet the Actionauts](https://action.co/about)

---

## Quickstart

```bash
npx skills add Action-Co/skills
```

From the installer, select the skills you want to add to your agent.

---

## Why Agent Skills?

Most AI agents can query a database. Few can navigate the semantic layers, business logic, and curated data models that teams have already built on top of it.

These skills bridge that gap. They are [**CodeAct**](https://arxiv.org/abs/2402.01030) implementations — lightweight SDKs, documentation, and working code that agents import and execute directly. This gives agents:

- **Composition through control flow** — loop over catalogs, filter results programmatically, and chain operations in a single code block
- **Self-debugging through execution feedback** — observe typed exceptions, read error messages, and correct the next attempt without human intervention
- **Persistent state through variables** — hold catalog metadata, schemas, and query results as objects across turns, referencing them by name rather than re-fetching

For large enterprise environments, agents use **REPL-based state management** to decompose discovery into sequential steps (scope → inventory → lineage → introspection), loading catalog data into variables and printing only counts and filtered summaries. This keeps the context window lean — O(1) — while the agent does `O(n)` semantic work across the entire site. Research on [Recursive Language Models](https://arxiv.org/abs/2512.24601) shows that managing large inputs as REPL variables rather than loading them into the context window is key to scaling beyond context limits; this skill applies that same principle at the agent level without recursive model sub-calling. For a fully recursive implementation, see [alexzhang13/rlm](https://github.com/alexzhang13/rlm). Individual harnesses implement recursion differently — some use sub-agent delegation, others use the REPL alone.

For a deeper look at why composable, code-first agent tooling outperforms monolithic platform approaches, see our article on [The Real Meaning of Headless BI](https://action.co/the-real-meaning-of-headless-bi).

---

## Available Skills

### Tableau

| Skill | Description |
|-------|-------------|
| **[Query Tableau Data](./skills/tableau/query-tableau-data)** | Explore the Tableau data catalog, trace lineage, and query published data sources via the VizQL Data Service. Implements a REPL-first Code Execution pattern with a Python SDK for authentication, inventory, lineage tracing, schema introspection, and data retrieval. |

![Bar and Whiskers Chart](https://github.com/Action-Co/skills/blob/main/assets/cover/Tableau%20Cover%20-%20(1440x168)%20-%20Transparent%20Background.png?raw=true)

---

## Stay Updated

Follow us on **[LinkedIn](https://www.linkedin.com/company/19173296)** for the latest insights, analysis, and new skill releases from The Action Company.

---

## Support

If you need help or encounter issues with these skills, search for existing issues or open a new one in the [GitHub Issue Tracker](https://github.com/Action-Co/skills/issues).

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on reporting bugs, suggesting new skills, and submitting pull requests.

---

## Further Reading

- **[Our Approach](https://action.co/approach)** — How we think about data aptitude, compelling data messages, and organizational transformation
- **[The Action Library](https://action.co/library)** — Articles, interviews, and thought leadership from the Actionauts
- **[The Real Meaning of Headless BI](https://action.co/the-real-meaning-of-headless-bi)** — Why composable analytics, not monolithic platforms, is the future of AI-powered data work
- **[Connect With Us](https://action.co/connect)** — Book a chat or drop us a message

---

## License

These skills are distributed under the Apache 2.0 license. Each skill packages its own license file to make it available to end users after installation. See the [LICENSE](./LICENSE) file for details.

---

![Action Co. Cover](https://github.com/Action-Co/skills/blob/main/assets/cover/Action%20-%20LinkedIn%20-%20Company%20Cover%20-%20(1129x192).png?raw=true)
