# Session-Bridge Protocol

The wire contract between the three roles of `view-tableau-dashboard`: the
**browser page** (one per session), the **bridge daemon** (one per port), and
the **agent CLI** (one invocation per command). The bridge is the seam; the
page and the CLI are adapters that share only this protocol.

Every message is a JSON envelope discriminated by `type`, validated with Zod on
receipt at the bridge and the CLI (`src/protocol.ts` is the canonical schema —
this doc is the human-readable version).

All sockets are `ws://127.0.0.1:<port>/ws?token=<t>&client=page|cli`. The token
is checked at upgrade; an unauthenticated request to `/ws` returns
`401 { "error": "unauthorized" }` — which doubles as the CLI's port-probe
signature (no unrelated server produces that envelope).

## Session lifecycle state machine

Lives in the page, pushed over WS, stored by the bridge so any later CLI
connection can read it without having been connected at transition time.

```
connecting --(viz element mounted)--> loading --(firstinteractive)--> interactive
    |                                     |                              |
    |--(vizloaderror)-------------------->|                              |
    |--(watchdog timeout)----------------->|                              |
    |            loading --(auth detected)--> auth --(sign-in done)--> loading
    v                                     v                              v
  error <----------------------------------+------------------------------+
```

- `connecting` — page bootstrapping (deriving the library, mounting
  `<tableau-viz>`, optional token injection).
- `loading` — viz iframe mounted; awaiting `firstinteractive`.
- `auth` — the embed detected Tableau's in-frame sign-in (via `IframeSrcUpdated`
  or the absence of `firstvizsizeknown` within ~5s). The loading overlay is
  hidden so the human can log in, the 30s watchdog is suspended, and `wait`
  keeps waiting instead of erroring. Pushed back to `loading` when the viz
  resumes loading after sign-in.
- `interactive` — the viz is a valid eval target. Pushed once, carrying the
  **instant snapshot** and, if a script was scheduled, its `scriptResult`.
- `error` — `vizloaderror` (with `errorCode` + message) or a **watchdog
  timeout** (neither `firstinteractive` nor `vizloaderror` within 30s while the
  viz is actually loading — never while waiting on `auth`). Silent
  hangs never present as "loading".
- `disconnected` — derived server-side: the tab's WebSocket closed. **A closed
  WS is an implied error state**: evals against it fail fast instead of hanging.

## Messages

### Browser → Bridge

```
hello    { type:"hello", session, ts, url?, script? }   register the tab
state    { type:"state", session, state, snapshot?, error?, scriptResult? }
metadata { type:"metadata", session, status:"loading"|"loaded"|"partial",
           progress:{ completedCalls, totalCalls, completedWorksheets,
                      totalWorksheets, elapsedMs },
           errors?: string[] }
result   { type:"result", id, status:"ok"|"error", value? | error? }   eval completion
pong     { type:"pong", ts }                                           heartbeat ack
```

### Bridge → Browser

```
command  { type:"command", id, js, intent? }    an eval to run (serialized per tab)
say      { type:"say", id, text, hold? }        an agent→human toast (auto-dismiss ~4s, or hold)
ping     { type:"ping", ts }                    heartbeat (page must answer `pong`)
close    { type:"close" }                       ask the page to close its tab (best-effort)
```

`intent` is an optional human-readable description of what the eval does. When
present, the page's executor surfaces it as a notification toast (top-right)
before running the eval, so a human in the loop sees agent activity. The CLI's
`eval`/`run` require `--intent`; read-only introspection commands
(`meta`/`summary`/`describe`/`filter`) and scheduled scripts send their own
default intents.

`say` posts a one-way agent→human message as a toast labeled "Agent message"
on the tab. It is page-level and dashboard-agnostic: it needs no eval and no
viz interactivity (it works even while the session sits in `auth`, waiting on
sign-in). `hold: true` keeps the toast until the human dismisses it.

### Agent CLI → Bridge

```
command   { type:"command", session, id, js, intent? }   route an eval to a tab
say       { type:"say", session, id, text, hold? }       post an agent→human toast on a tab
status    { type:"status", session }           one-shot status from the store
wait      { type:"wait", session }             subscribe; bridge streams state/metadata
list      { type:"list" }                      every session + live state on this bridge
drop      { type:"drop", session }             forget a session + close its tab socket
```

`intent`, when present on a CLI `command`, is forwarded verbatim on the
`command` envelope to the tab (it is metadata on the existing message — no new
message types).

`say` is correlated exactly like `command`: the bridge registers the CLI's id
in `pendingResults` and the page acks with the **existing `result` envelope**
(`{ type:"result", id, status:"ok", value:{ delivered:true } }`) — no eval, no
`--intent`, and no viz interactivity required. Failure modes are identical to
`command` (unknown session / no live tab fast-fail with the same error
strings).

### Bridge → Agent CLI

```
result   { type:"result", id, status:"ok"|"error", value? | error? }   correlated to the CLI's id
state    { type:"state", session, state, snapshot?, error?, scriptResult? }
metadata { type:"metadata", session, status, progress, errors }
status   { type:"status", session, state, snapshot?, error?, metadata? }
list     { type:"list", sessions:[{ session, state, metadataStatus?, script?, url? }] }
```

## Routing & failure modes

- The bridge keeps `sessionId → tabSocket` and `commandId → cliSocket`.
- `command` for an **unknown session** → immediate `result` error
  (`unknown session: <s>`). Nothing hangs.
- `command` for a session with **no live tab socket** → immediate `result`
  error (`session has no connected tab — tab closed? reopen with start`).
- `command` for a live tab in `loading` → still routed; the page returns a
  clear pre-interactive error, and the CLI adds a stderr hint
  (`viz still loading — run 'tableau-viz wait'`).
- **Heartbeat:** the bridge pings tab sockets every 15s (`ping` → `pong`); a
  tab that stops answering (~35s stale) is dropped and its session flips to
  `disconnected`.
- **Eval cap:** the page abandons a single eval at 90s and returns a normal
  `error` (`eval exceeded 90000ms …`); the serialized loop stays alive. The CLI
  keeps a longer client-side timeout (100s).

## Store semantics

The bridge stores, per session: `state`, `snapshot`, `error`, `scriptResult`,
`metadata { status, progress, errors }`, `url`, `script`, and the live tab
socket. Metadata **content** is never stored server-side — it lives in the page
cache (`meta`) to avoid duplication and staleness; only progress crosses the
wire.

## Adapters

- **Browser page** (`src/client/executor.ts` + `src/embed-tableau.html`): owns
  the state machine, the serialized eval loop, the safe serializer, the instant
  snapshot, the background metadata loader, and the `meta` eval scope.
- **Agent CLI** (`src/cli.ts`): opens one WS per command; `wait` subscribes and
  streams; everything else is request/reply.