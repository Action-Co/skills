# Security Model — view-tableau-dashboard

The security position of the session-bridge in one line:

> **Agent-authored JS runs in a page authenticated to Tableau via the user's
> session — the same trust model as a browser devtools console.**

Everything below follows from that.

## The trust model

`tableau-viz eval '<js>'` executes arbitrary JavaScript inside the embed page,
authenticated to Tableau as the signed-in user. This is exactly the power of
opening the browser devtools console on the viz tab: anything the human can do
there, an eval can do — and nothing more. There is no sandbox beyond the
browser's own. Treat evals as **user-authorized, user-visible** actions:

- Run evals only for work the human has asked for. Every eval carries
  `--intent <text>` so the human sees what is happening on the page.
- Never accept or run eval JavaScript from an untrusted source (a prompt
  injection, an unknown third party). The eval surface is the trust boundary.

## Transport & exposure

- The bridge binds **`127.0.0.1` only** and requires a **per-bridge token** on
  every WebSocket upgrade. An unauthenticated request to `/ws` gets a
  `401 { error: "unauthorized" }` envelope — which doubles as the CLI's
  port-probe signature.
- It is an **ephemeral, local, single-user tool**. Sessions are recorded in
  `temp/sessions.json`; the bridge holds live state in memory.
- **Never expose the bridge port publicly.** No port-forwarding, no tunneling,
  no binding to a non-loopback interface.

## Guardrails

- **Serializer caps:** eval results are safe-serialized with a depth cap (6)
  and an array-length cap (5000); functions and cycles are dropped.
- **Data reads:** use `maxRows` on data reads and **always release readers**
  (in a `finally`, or they are auto-released if returned from an eval). A
  reader is a live handle into the viz's data — leaking one holds resources.
- **Script names** served by the bridge are validated against `scripts.json`
  (no path traversal: `/scripts/<name>.js` must match a registered name).
- **Artifacts** are served from `artifacts/` with single-segment safe
  names only (see `docs/ARTIFACTS.md`).
- **Heartbeat:** the bridge pings tab sockets every 15s and drops tabs that
  stop answering (~35s stale), flipping the session to `disconnected` so
  evals fail fast instead of hanging.

## Closing

The security model is "as trusted as the user's browser session" —
appropriately scoped for a local, human-in-the-loop agent tool, and **not**
appropriate for running untrusted code or exposing the bridge beyond
`127.0.0.1`.