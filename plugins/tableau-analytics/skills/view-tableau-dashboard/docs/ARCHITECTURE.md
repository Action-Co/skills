# Architecture — View Tableau Dashboard

Behavioral overview of how `view-tableau-dashboard` works, and where each file's intent
lives. This is a map for agents who want to modify or extend the skill; you do not need it
to operate the CLI.

## Systems diagram

```text
[Human] watches the tab and sees --intent toasts
    |
    v
[Browser Tab]  (one per session — always a real, visible tab)
  - embed-tableau.html: derives the Embedding API lib from the viz origin,
    mounts <tableau-viz>, wires lifecycle events
  - state machine: connecting -> loading -> interactive | error
  - instant snapshot on firstinteractive
  - background metadata loader (columns + visual specs) -> `meta` cache
  - serialized eval executor + scheduled scripts
    ^                                   |
    | WebSocket (session-routed)        | WebSocket
    v                                   v
[Bridge Daemon]  (Bun.serve on 127.0.0.1:<port>, token-guarded)
  - static host: embed page, executor bundle, scripts/, artifacts/
  - WS relay: sessionId -> tab socket; requestId -> agent socket
  - per-session store: state, snapshot, metadata progress, scriptResult
  - heartbeat / closure detection -> session flips to disconnected
    ^
    | WebSocket (per command / wait / subscribe)
    v
[Agent CLI]  (tableau-viz — start/wait/eval/run/meta/ls/status/…)
```

One bridge daemon per port, N tabs (sessions), N CLI invocations. Sub-agents share the
server; each drives its own session. The eval is the primitive: agent-authored JS is the
single entry point for interacting with the viz — no DOM automation, no command catalog.

## Static vs dynamic metadata

- **Static** (schema, layout, per-worksheet columns/visual specs): cached in the background
  as `meta`. Read it at ~0ms; it never changes with interaction.
- **Dynamic** (filters, parameters, selected marks, domains, data): **never cached** —
  always read live via evals/helpers. The instant snapshot carries current filter/parameter
  state at load; everything after that is a live read.

The `wait` snapshot is the agent's cheap confirmation: workbook name, sheets, zones,
parameters, filters. It is for *dynamic* state — the schema facts it contains are also in
the semantic model (`tableau-semantics`), which the workflow reads first.

## File map

| File | Intent |
| --- | --- |
| `tableau-viz.sh` | wrapper: resolves Bun, installs deps on first run, wires corporate CA, execs the CLI |
| `src/cli.ts` | the CLI (start/wait/eval/run/meta/ls/status/summary/describe/filter/scripts/open-site/stop) |
| `src/bridge.ts` | the bridge daemon: `Bun.serve`, static host (embed/executor/scripts/**artifacts**), WS relay, per-session store, token guard, heartbeat |
| `src/session.ts` | CLI-side session registry (`temp/sessions.json`), port probe/reclaim, id minting, URL handling |
| `src/embed-tableau.html` | the embed page: library injection, `<tableau-viz>` mount, event wiring, watchdog |
| `src/client/executor.ts` | in-page executor (bundled): WS connect, state machine, serialized eval loop, safe serializer, helper library, `meta` scope |
| `src/client/snapshot.ts` | instant-snapshot assembly (pure, unit-tested) |
| `src/client/metadata-loader.ts` | background metadata cache + guardrails |
| `src/protocol.ts` | Zod-validated WS envelopes (see `docs/PROTOCOL.md`) |
| `scripts/` + `scripts.json` | reusable eval steps (e.g. `explore` = `return meta`) |

For the full wire contract see `docs/PROTOCOL.md`; for the Embedding API surface the evals
wrap, see `docs/EMBEDDING_API.md`.