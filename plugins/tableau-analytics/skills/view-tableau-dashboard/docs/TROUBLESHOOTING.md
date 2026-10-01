# Troubleshooting

Failure modes, causes, and fixes for `view-tableau-dashboard`.

## Session / tab issues

- **"session has no connected tab — tab closed?"** — the tab's WebSocket closed; evals fail
  fast by design. Reopen with `start --url <url>` (or reuse another session via
  `--session`).
- **"viz still loading — run 'tableau-viz wait'"** — the eval ran before
  `firstinteractive`. `wait` first.
- **Bridge started by one command, orphaned by a crash** — `stop --port <port>` reclaims it
  (probe/401 signature finds it, `lsof` resolves the pid).

## Load / auth failures

- **Watchdog timeout / auth failure** — the viz neither loaded nor errored in 30s, or it
  redirected to Tableau's in-frame sign-in.
  - **Public:** public views need no session. Hidden views: `open-site` opens the origin to
    log in.
  - **Authenticated Cloud/Server:** the session cookie is `Partitioned` and cannot be
    reused from another origin — a human completes the embed's own in-frame sign-in in the
    tab (or the site provides a connected-app token).

## Eval issues

- **`eval exceeded 55000ms and was abandoned`** — a Tableau async call never resolved. The
  bridge is alive; retry with a bounded call (see `docs/JS_EVALS.md` — size the eval before
  you run it).
- **Empty reader / `invalid-parameter: 0 is invalid value for range: [0..0)`** — a
  worksheet has no rows under the current filter state; check `reader.pageCount` before
  paging (`helpers.readVizData` handles this).
- **`…does not look like a Tableau view URL (expected a /views/... path)`** — you passed a
  profile URL (`/app/profile/<user>/viz/<Workbook>`). Use the view URL:
  `https://<host>/views/<Workbook>/<Sheet>`.