# Contributing to Action Skills

Thank you for your interest in contributing! These skills are built for real engineering with AI agents and your feedback and improvements help everyone in the community.

![Action Co. Avatar](./assets/avatar/64_action_stamp_avatar-cr@2x.png)

---

## The Prompt Request Pattern

This project follows the **Prompt Request** contribution model. Instead of hand-writing hundreds of lines of code for line-by-line review, contributors describe their **intent** — what they want to achieve — and use an AI coding agent to generate the implementation.

**How it works:**

1. Open a GitHub issue describing the desired outcome (this is your "prompt request")

2. Pick up an approved issue, feed it to your coding agent as a prompt, iterate until it works

3. Open a Pull Request that includes the **literal prompt(s)** you used alongside the generated code

**Why this model:**

- Maintainers review **intent and architecture alignment**, not syntax
- Contributors focus on **what** (product goals, constraints, acceptance criteria) rather than **how** (implementation details)
- The prompt trail creates **reproducibility** — anyone can re-run the same intent to understand or modify the output
- This is especially powerful for contributors who are new to code: you describe what you want in plain language and the agent helps you build it

Traditional code contributions are also accepted, but Pull Requests must still include a description of the intent and any prompts used during development.

---

## Opening an Issue (Prompt Request)

Open a GitHub issue describing the desired outcome clearly. Think of the issue body as a prompt you would give to a capable colleague. It should state the problem or goal, the relevant context, and any constraints.

A good prompt request includes:

- **What** you want to happen (desired outcome, not implementation steps)
- **Which skill or area** it affects
- **Why** it matters (the use case or problem you are solving)
- **Constraints** (e.g., must support Tableau Cloud and Server, must not break existing API, etc.)

**Good example:**

> "Add support for workbook-level filtering to the query skill. Users should be able to pass a filter parameter when querying a published datasource so the agent can narrow results before retrieving them. This would reduce query payload size on large datasources."

**Bad example:**

> "Fix bug." (no context, no desired outcome, no skill specified)

---

## Submitting a Pull Request

Before opening a PR, make sure there's an associated issue that describes the intent. The PR is the artifact; the issue is the prompt.

### What to include in your PR description

1. **Reference the issue** — `Closes #<issue-number>`

2. **The literal prompt(s)** you gave to your agent (the "prompt trail")

3. **What changed** — a brief summary of what the agent produced

4. **Any manual edits** — what you changed after the agent generated the code

### Example PR body

```markdown
Closes #42


**Prompt used:**
> "Add a `filter_project` parameter to `Session.inventory_datasources()`
> so agents can scope catalog discovery to a single Tableau project.
> The parameter should accept a project name string and pass it as a
> query parameter to the REST API. Update the return type and add a test."


**What changed:**
- Added `filter_project: str | None = None` to `inventory_datasources()`
- Passed it through to the REST API query parameters
- Added a test in `tests/test_inventory.py`


**Manual edits:**
- The agent initially used `urllib.parse.quote` which double-encoded spaces.
 I switched to `requests` parameter handling which the SDK already uses.
```

### PR checklist

Before submitting your PR, verify:

- [ ] Tests pass (`uv run pytest`)
- [ ] The PR includes the prompt(s) used to generate the code
- [ ] Documentation reflects your changes (README.md, SKILL.md, docs/)
- [ ] Commit messages are clear and descriptive
- [ ] You have not committed credentials, `.env` files, or `temp/` output

![Bar and Whiskers Chart](./assets/cover/Tableau%20Cover%20-%20(1440x168)%20-%20Transparent%20Background.png)

---

## Git Basics

If you are new to Git, here is the workflow, step by step.

### 1. Fork the repository

Click the **Fork** button on the [GitHub repository page](https://github.com/Action-Co/skills) to create your own copy under your GitHub account.

### 2. Clone your fork

```bash
git clone https://github.com/your-username/skills.git && cd skills
```

### 3. Create a new branch

Always work on a branch — never commit directly to `main`.

```bash
git checkout -b feature/your-change-name
```

Good branch names describe the change: `feature/snowflake-basics`, `fix/tableau-auth-timeout`, `docs/repl-examples`.

### 4. Make your changes

Edit files using your preferred editor or coding agent.

### 5. Stage and commit

```bash
# See what you changed
git status


# Add the files you changed
git add <file-path>
# Or add all changes in the current directory
git add .


# Commit with a clear message
git commit -m "add filter_project parameter to inventory_datasources"
```

Commit messages should be concise and describe **what** changed and **why**:

- Good: `add filter_project parameter to inventory_datasources`
- Good: `fix: handle 401 on datasource introspection gracefully`
- Bad: `updates` (too vague)
- Bad: `fixed stuff` (no information)

### 6. Push your branch

```bash
git push origin feature/your-change-name
```

### 7. Open a Pull Request

Go to the [original repository page](https://github.com/Action-Co/skills) on GitHub. You will see a banner prompting you to open a Pull Request for your branch. Click it, fill in the PR description following the template above, and submit.

---

## Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/skills.git && cd skills


# Install dependencies
uv sync --all-extras


# Activate the virtual environment
source .venv/bin/activate


# Run tests
uv run pytest
```

---

## Skill Structure Conventions

Each skill is a self-contained package. When adding or modifying a skill, follow this layout:

```
skills/<platform>/<skill-name>/
├── README.md            # Landing page for humans (design, HITL setup)
├── SKILL.md             # Agent entry point (workflow instructions)
├── pyproject.toml        # Runtime dependencies (no dev deps)
├── .env.template         # Template for environment variables
│
├── docs/                 # Deep-dive documentation
│   ├── README.md         # Documentation index
│   ├── REPL.md           # Complete REPL session example
│   └── sdk/              # SDK usage patterns & reference
│
├── scripts/              # Reusable scripts & workflows
├── temp/                 # Local exploration output (gitignored)
│
└── src/                  # Source code
   └── <package_name>/   # Importable Python package
       └── main.py       # Demo orchestrator / entry point
```

- **`README.md`** — Human-facing: skill overview, design rationale, setup instructions (especially HITL steps), and links to deeper docs
- **`SKILL.md`** — Agent-facing: entry point with workflow instructions, traversal patterns, and links to `docs/`
- **`docs/`** — Deep-dive material that agents pull as needed. Keep the README and SKILL.md as entry points, not monolithic dumps
- **Use `uv`** for dependency management and script execution
- **No dev dependencies in skill `pyproject.toml`** — test dependencies live at the workspace root

---

## Coding Standards

- **Python**: Write clean, typed code. Prefer explicit over clever. Add docstrings for public functions
- **Error handling**: Raise typed exceptions with actionable messages. Agents self-debug from these
- **Logging**: Use structured logging where appropriate. Agents read logs to diagnose issues
- **Tests**: New code should have tests. We follow red-green TDD when practical
- **Documentation**: Update both `README.md` and `SKILL.md` if your change affects the public interface or workflow

---

## Code of Conduct

We are committed to providing a welcoming and inspiring experience for everyone. Be kind, be constructive, and assume good intent. Disagreement is normal and healthy – personal attacks are not.

---

## License

By contributing to this repository, you agree that your contributions will be licensed under the Apache 2.0 license.

---

![Action Co. Cover](./assets/cover/Action%20-%20LinkedIn%20-%20Company%20Cover%20-%20(1129x192).png)
