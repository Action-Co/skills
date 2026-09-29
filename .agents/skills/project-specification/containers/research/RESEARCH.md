# Research Container

This container houses research findings, component-level design papers, and deep-dive audits that inform the project's skills and architecture.

All research documents below are linked for direct traversal. For cross-cutting context (stakeholders, DDD vocabulary, architecture decisions), see the [C1 Context documents](../../context/).

---

## Components

| Document | Description |
| -------- | ----------- |
| [VIEW_TABLEAU_DASHBOARD.md](components/VIEW_TABLEAU_DASHBOARD.md) | The view-tableau-dashboard session-bridge architecture: session as the deep module, static/dynamic metadata split, auth model, distribution |
| [EMBED_CODE.md](components/view-tableau-dashboard/EMBED_CODE.md) | Embed display upgrade design: fit-to-card CSS scaling (tabscale port), dark card theme, agent-intent notifications (toast pipeline), required `--intent` enforcement on eval/run |
| [SEMANTIC_MODEL.md](components/SEMANTIC_MODEL.md) | The tableau-semantics design: derived semantic model + behavioral documentation, freshness anchor, canon, lineage fallback |
| [COUNTRY_KPIS.md](components/view-tableau-dashboard/country-kpis/COUNTRY_KPIS.md) | Postmortem of the `country-kpis` evaluation run (Opportunity Overview dashboard): what went well/badly, root causes verified against the code, candidate skill improvements, authoring rules |
