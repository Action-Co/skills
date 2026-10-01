# Action Skills

This repository contains agent skills developed by [The Action Company](https://action.co) and shared publicly. Work here falls into two distinct modes. Determine which one applies before acting.

## 1. Demonstrating a skill

The user is walking through a skill we have built. The public skills live in `plugins/<plugin>/skills/`, **not** `.agents/`. When the user references a skill, look under `plugins/` first — do not assume it is missing if you don't see it in `.agents/`.

| Skill | Location |
|-------|----------|
| Query Tableau Data | `plugins/tableau-analytics/skills/query-tableau-data/` |
| View Tableau Dashboard | `plugins/tableau-analytics/skills/view-tableau-dashboard/` |
| Tableau Semantics | `plugins/tableau-analytics/skills/tableau-semantics/` |

More plugins will be added under `plugins/<domain>/` over time; check that directory for the current map. The `.agents/` folder holds internal skills for developing this repo and is not used during demos.

## 2. Developing a skill

The user is building or editing a skill in this repo. Follow `CONTRIBUTING.md`:

- Use the Prompt Request pattern (intent via issue, agent generates implementation)
- Follow the skill structure convention (`README.md`, `SKILL.md`, `docs/`, `scripts/`, `src/<package>/`)
- Use `uv` for dependency management; no dev deps in skill `pyproject.toml`
- Write clean, typed Python with tests; run `uv run pytest` before finishing
- Update both `README.md` and `SKILL.md` when the public interface or workflow changes
- Use `ip-agent-skills@action.co` as the author/owner email everywhere it appears: skill `SKILL.md` frontmatter (`metadata.authors`), plugin `.claude-plugin/plugin.json` (`author.email`), and the marketplace `.claude-plugin/marketplace.json` (`owner.email`). Never use personal emails in any of these files.
