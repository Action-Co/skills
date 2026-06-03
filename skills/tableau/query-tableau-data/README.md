# Query Tableau Data

[![skills.sh](https://img.shields.io/badge/skills.sh-install-purple)](https://skills.sh/action-company/tableau-skills)

An agent skill by **[The Action Company](https://action.co)** that give AI analysts the ability to explore, understand, and query data inside Tableau Cloud and Server.

![Action Co. Avatar](../../../assets/avatar/64_action_stamp_avatar-cr@2x.png)

---

## The "Last Mile" Problem

When business users think about company data, they rarely think about a warehouse. They think about the dashboard they check every Monday, the data source their team curated with meaningful field names, or the view that already filters to their region. Tableau is the _last mile_ of analytics — the place where raw data is shaped into something consumable and actionable for people.

This visual and semantic context is enormously valuable, yet most AI analysts rarely incorporate it in their toolkit. They can query a database, but they can't explore what a business team has _already built_ on top of that database. They can't discover which data sources are certified, which views are most popular, or what calculations have been layered onto the raw tables.

This skill bridges that gap. It gives agents the ability to authenticate against Tableau, navigate the data catalog, introspect data source schemas, trace lineage between workbooks and their upstream sources, and ultimately query the data — all programmatically.

> _Note_: this skill requires initial human setup to authenticate to a Tableau environment, jump to the [README.md § HITL](./README.md#tasks-that-require-a-human-in-the-loop-hitl) section for more instructions.

---

## Installation

```bash
npx skills add action-company/skills
```

From the installer, select the Tableau skills you want to add to your agent.

---

## Tasks that Require a Human In The Loop (HITL)

The skill is designed so that agents do all the work. However, initial setup requires human action to authenticate to your Tableau site and enforce your permissions as a user.

### 1. Identify Your Tableau Environment

You need two values that identify your Tableau site:

| Variable | Where to Find It | Example |
|----------|------------------|---------|
| `TABLEAU_SERVER_URL` | The base URL of your Tableau Cloud or Server instance | `https://prod-useast-b.online.tableau.com` (Cloud) or `https://tableau.yourcompany.com` (Server) |
| `TABLEAU_SITE_NAME` | The site's content URL (subpath). Found in your browser URL after `/site/` when logged in. For the Default site on Server, leave empty. | `MarketingTeam` |

> **Tip**: On Tableau Cloud, your server URL includes the pod name (e.g., `prod-useast-b`, `prod-ca-a`). You can find this in your browser address bar when logged in.

### 2. Create a Personal Access Token (PAT)

PAT is the recommended authentication method. It avoids exposing passwords and can be revoked independently of your user account.

1. Log in to your Tableau Cloud or Server site
2. Click your profile icon (top-right) and select **My Account Settings**
3. Scroll to the **Personal Access Tokens** section
4. Enter a **Token Name** (e.g., `agent-skill`) and click **Create new token**
5. **Copy the secret immediately** — it is shown only once and cannot be retrieved later

| Variable | Value |
|----------|-------|
| `PAT_NAME` | The token name you entered (e.g., `agent-skill`) |
| `PAT_VALUE` | The secret string displayed in the creation dialog |

> **Expiration**: PATs expire after 15 consecutive days of non-use. On Tableau Cloud, site admins can configure expiration. On Server, they expire after one year by default. Regenerate if your agent starts getting 401 errors.

### 3. (Alternative) Username & Password

Only use this if PATs are unavailable in your environment. Multi-factor authentication (MFA) on Tableau Cloud **requires** PATs — username/password will not work.

| Variable | Value |
|----------|-------|
| `TABLEAU_USERNAME` | Your Tableau login username |
| `TABLEAU_PASSWORD` | Your Tableau login password |

### 4. (Advanced) API Versions

These are optional. The skill uses sensible defaults, but you can pin specific versions if needed:

| Variable | Description | Default |
|----------|-------------|---------|
| `TABLEAU_API_VERSION` | REST API version (e.g., `3.24`) | Latest supported |
| `TABLEAU_VDS_VERSION` | VizQL Data Service version (e.g., `20261.0`) | Latest supported |

### 5. Save Your Credentials

```bash
cd skills/query-tableau-data
cp .env.template .env
# Edit .env with your values from steps 1-2 above
```

The `.env` file is gitignored. Never commit credentials to the repository.

### 6. Verify Access

Ask your agent to run the authentication check:

```python
from query_tableau_datasource.config import SdkConfig
from query_tableau_datasource.session import Session
with Session(SdkConfig()) as session:
    print("AUTH OK")
```

If this fails, see [AUTH.md](./docs/api/AUTH.md) for troubleshooting.

![Bar and Whiskers Chart](../../../assets/cover/Tableau%20Cover%20-%20(1440x168)%20-%20Transparent%20Background.png)

---

## Design

This skill ships documentation ([docs/](./docs/) folder) and working code ([src/](./src/) folder) to bootstrap AI agents generating code-based solutions to interact with a Tableau environment. 

The provided code is minimal yet designed to be ergonomic for coding agents. It abstracts most of the complexities of authenticating to Tableau and reusing a session when making `HTTP` requests to the server. All other operations are modular so agents can compose them in a variety of ways to fit their needs.

Rather than calling predefined tools via JSON, the agent writes and executes code in a persistent session — holding state as variables, composing operations with control flow, and self-debugging from execution feedback.

This implementation enables AI agents to do the following:

- Use a `Read-Eval-Print-Loop (REPL)` to progressively explore the Data Catalog for datasources and views. This pattern is similar to giving agents a lightweight Jupyter notebook so they can navigate the largest Tableau sites without bloating their context window.
- Write reusable workflows as scripts (in the [scripts/](./scripts/) folder) so the next time data is needed agents can quickly retrieve it on-demand.
- Incorporate Tableau data in external applications as "Headless BI" by using the `src` code directly or modifying it according to the needs of the project.

> _Note_: For practical usage and agent instructions, see the [SKILL.md](./SKILL.md) file.


### Why CodeAct Instead of MCP?

We chose a [**CodeAct**](https://arxiv.org/abs/2402.01030) approach for this skill because it gives agents the composability, control flow, and self-debugging capabilities that rigid tool interfaces cannot provide. Here is how that decision maps to the existing tooling landscape:

MCP is an alternative way to interact with a Tableau environment but it relies on static tool definitions that make it hard for agents to reliably translate these tool calls into scripts or working application code. 

Additionally, MCP does not provide the control and data flow that you would get from a `REPL` or script. This means that tool responses are returned directly to the agent context window causing bloat and reducing reliability in long-running tasks.

MCP **code mode** has been posited as a way to bridge this gap but this skill demonstrates that coding agents do not require MCP at all and in fact perform better if they write code directly. This means that documentation, examples and some lightweight abstractions are all they need. Consider also that **code mode** only exposes tool signatures to the agent as functions they can call but does not give them full access to the source code so they can copy and modify it to meet their needs.

Ultimately, MCP adds avoidable overhead and limits the capabilities of coding agents. Concerns such as permissions belong in their own auth layer not a tool server. It would therefore be more effective to model agent tooling along the lines of a richer paradigm such as **CodeAct** than extend MCP into use case it is not suitable for.

---

### CodeAct

This skill is a [**CodeAct**](https://arxiv.org/abs/2402.01030) implementation. Instead of exposing Tableau operations as JSON tool definitions (the MCP pattern), it ships a lightweight SDK that agents import and execute directly. This matters because:

- **Composition via control flow.** Agents loop over datasources, filter results programmatically, and chain operations (inventory → lineage → introspect → query) in a single code block — impossible with one-tool-at-a-time JSON actions.
- **Self-debugging from execution feedback.** When a query fails (wrong field caption, expired token), the agent observes the typed exception, reads the error message, and corrects its next attempt — no human intervention needed.
- **State as variables.** Catalog metadata, schemas, and query results persist as objects across turns. The agent references them by name rather than re-fetching or parsing tool responses from its context window.

![CodeAct](../../../assets/diagrams/CodeAct.png)

> **Figure 1**: Code actions outperform JSON/text tool-calling by up to 20% across 17 LLMs by unifying actions into a single space with native control flow, data flow, and multi-tool composition.
>
> **Source**: [Executable Code Actions Elicit Better LLM Agents (Wang et al., 2024)](https://arxiv.org/abs/2402.01030)

These performance gains compound in multi-turn and long-running tasks. Because the agent holds state as variables in a persistent session, it can build on prior results across turns without re-fetching data or bloating its context window. When a query fails or returns unexpected results, the agent reads the execution feedback, adjusts its code, and retries — all within the same session. This closed feedback loop is what makes long-running exploration (traversing a large catalog, tracing lineage, iterating on a query) reliable in ways that one-shot JSON tool calls cannot match. It also sets up the recursive pattern used in the next section: when the catalog itself is too large to fit in context, the agent uses the same persistent session to decompose the problem into smaller, sequential steps.

![Multi-turn Code Execution](../../../assets/diagrams/multi_turn.png)

> **Figure 3**: Multi-turn interaction with execution feedback. The agent imports libraries, executes, observes errors, and self-debugs — closing the gap between intent and working code without demonstrations.
>
> **Source**: [Executable Code Actions Elicit Better LLM Agents (Wang et al., 2024)](https://arxiv.org/abs/2402.01030)

---

### REPL-Based State Management

Enterprise Tableau sites can have thousands of datasources, tens of thousands of views, and schemas with hundreds of fields. Dumping this into an agent's context window degrades reasoning on even simple tasks.

Instead, this skill treats catalog data as **environment state** — held in variables, never printed in full. The agent:

1. Loads inventory into a variable, prints only counts and filtered summaries
2. Decomposes discovery into sub-tasks (scope → inventory → lineage → introspect)
3. Ingests only the necessary data into context to make decisions

This keeps the context window lean while allowing the agent to do `O(n)` semantic work across the entire site.<sup>[1]</sup>

Research on [Recursive Language Models](https://arxiv.org/abs/2512.24601) demonstrates that managing large inputs as REPL variables — rather than loading them into the context window — is a key technique for scaling beyond context limits. This skill applies that same principle: the agent never dumps the full catalog into its reasoning context, instead probing and filtering as needed.

Notably, the RLM paper finds strong gains even at recursion depth 0 (no sub-calling) simply by offloading state to the REPL. The same applies here: because the agent operates inside a live coding environment, it avoids the overhead of editing files, running scripts, and parsing new output contexts. It iterates forward in the same session — like a Jupyter notebook — progressively filtering, exploring, and making decisions while the full catalog stays safely in variables.

> For a fully recursive implementation that adds programmatic sub-calling on top of this REPL pattern, see the author's reference implementation at [alexzhang13/rlm](https://github.com/alexzhang13/rlm).

![RLM_REPL](../../../assets/diagrams/RLM_REPL.png)

> **Figure 2**: From the RLM research: loading input as a REPL variable and writing code to peek and decompose. This pattern scales beyond model context limits by keeping the working set in variables rather than in the context window.
>
> **Source**: [Recursive Language Models (Zhang et al., 2026)](https://arxiv.org/abs/2512.24601)

> **Note 1 — `O(n)` in this context.** `O(n)` is Big O notation for *linear complexity*: the amount of semantic work the task itself requires grows in direct proportion to the input size (e.g., OOLONG in the RLM paper requires examining almost every line). This skill's REPL-based approach lets the agent match that task complexity through sequential exploration — decomposing, peeking, and iterating as needed — while keeping the context window constant (`O(1)`) rather than loading everything at once. Unlike compaction (which loses detail) or sub-agent delegation (which adds verbalization overhead), this approach scales reliably because the agent only holds the current step in memory, not the entire catalog.

---

## Further Reading

Built by **[The Action Company](https://action.co)**, an interdependent consultancy that helps organizations make better decisions in complex, fast-moving environments. We turn fragmented details into shared understanding, decisive action, and decision systems that help teams see patterns sooner, align on what matters, and respond to changing conditions.

- **[Our Approach](https://action.co/approach/)** — The ACT framework: Advance (data aptitude), Create (compelling data messages), Transform (your organization)
- **[The Action Library](https://action.co/library/)** — Thought leadership on Tableau, AI, and the future of analytics
- **[The Real Meaning of Headless BI](https://action.co/the-real-meaning-of-headless-bi/)** — Why composable, code-first agent tooling outperforms monolithic platform approaches
- **[Connect With Us](https://action.co/connect/)** — Book a chat, subscribe to our newsletter, or drop us a message

---

![Action Co. Cover](../../../assets/cover/Action%20-%20LinkedIn%20-%20Company%20Cover%20-%20(1129x192).png)
