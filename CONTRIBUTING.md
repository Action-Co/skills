# Contributing to Action Skills

Thank you for your interest in contributing! These skills are built for real engineering with AI agents and your feedback and improvements help everyone in the community.

![Action Co. Avatar](./assets/avatar/64_action_stamp_avatar-cr@2x.png)

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

## Plugin Marketplace Structure & Conventions

Each Plugin is a self-contained package that may contain skills and MCP client configurations.

When adding or modifying a plugin follow this layout:

```text
plugins/<plugin>/
├── .claude-plugin/
│   └── plugin.json        # only plugin.json lives inside .claude-plugin/
└── skills/
    └── <skill-name>/
        ├── SKILL.md       # agent entry point
        ├── README.md
        ├── docs/
        ├── scripts/
        ├── temp/          # gitignored
        └── src/
```

- **`README.md`** — Human-facing: plugin overview, design rationale, setup instructions (especially HITL steps), and links to deeper docs
- **`SKILL.md`** — Agent-facing: entry point with workflow instructions, traversal patterns, and links to `docs/`
- **`docs/`** — Deep-dive material that agents pull as needed. Keep the README and SKILL.md as entry points, not monolithic dumps
- **Use `bun`** for TypeScript dependency management and script execution
- **Use `uv`** for Python dependency management and script execution
- **No dev dependencies in skill `pyproject.toml`** — test dependencies live at the workspace root

---

## Versioning

Skills are versioned independently with [Semantic Versioning](https://semver.org/)
(`MAJOR.MINOR.PATCH`) in each `SKILL.md`'s `metadata.version`. A skill's
*interface* is what an agent or user relies on: the SKILL.md workflow, the CLI
surface, and the on-disk conventions.

- **PATCH** (`0.0.x`) — backward-compatible fixes (docs, typos, bug fixes).
- **MINOR** (`0.x.0`) — an interface change (CLI surface, file layout, SKILL.md
  contract) or a notable new capability; may be breaking.
- **MAJOR** (`x.0.0`) — a declared-stable interface that changes incompatibly.

While a skill is pre-1.0 (`0.y.z`) it may change at any time: bump the MINOR for
interface or feature changes and the PATCH for fixes.

Also bump `plugins/<plugin>/.claude-plugin/plugin.json` when any bundled skill
bumps, and `.claude-plugin/marketplace.json` only when the catalog/structure
changes. Bump in the same PR that changes the skill.

---

## Author and Ownership Metadata

Every public artifact in this repository must be attributed to The Action Company using the shared team email **`ip-agent-skills@action.co`**. This email is required everywhere an author or owner appears:

- **Skill** — the `authors` field in `SKILL.md` frontmatter:

  ```yaml
  metadata:
    authors: "ip-agent-skills@action.co"
  ```

- **Plugin** — the `author.email` field in `plugins/<plugin>/.claude-plugin/plugin.json`
- **Marketplace** — the `owner.email` field in `.claude-plugin/marketplace.json`

Do not use personal or contributor email addresses in any of these files. Keeping a single, consistent author identity ensures all skills, plugins, and the marketplace are clearly owned by The Action Company.

---

## PR checklist

Before submitting your PR, verify:

- [ ] Tests pass (`uv run pytest`)
- [ ] Documentation reflects your changes (README.md, SKILL.md, docs/)
- [ ] Commit messages are clear and descriptive
- [ ] All author/owner metadata uses `ip-agent-skills@action.co` (SKILL.md frontmatter, plugin.json, marketplace.json) — no personal emails
- [ ] You have not committed credentials, `.env` files, or `temp/` output

![Bar and Whiskers Chart](./assets/cover/Tableau%20Cover%20-%20%281440x168%29%20-%20Transparent%20Background.png)

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

Go to the [original repository page](https://github.com/Action-Co/skills) on GitHub. You will see a banner prompting you to open a Pull Request for your branch. Click it, fill in the PR description, and submit.

![Action Co. Cover](./assets/cover/Action%20-%20LinkedIn%20-%20Company%20Cover%20-%20%281129x192%29.png)
