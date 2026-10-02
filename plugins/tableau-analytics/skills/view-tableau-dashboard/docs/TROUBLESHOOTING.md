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
  - **Safari / blocked SSO popup:** if the human is on Safari, the in-frame sign-in's SSO
    popup is blocked (Safari blocks popups opened from cross-origin iframes), so the viz
    never authenticates. The console shows repeated `401` on `viewing` and
    `Unable to post message to https://<host>. Recipient has origin http://127.0.0.1:3000`
    (the auth broadcast hitting the local bridge instead of a Tableau window — expected
    noise for an embed, not the cause). Switch to Chrome, which the CLI prefers when
    installed. Safari users who just want to try the tool can use a Tableau Public sample
    (see `README.md`); enterprise teams should provision a connected-app token — contact
    Action to set that up.

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

## TLS / certificate issues

If the embed or the bridge fails to reach the Tableau origin with a certificate
error, the corporate CA is the usual cause:

- Bun/Node honor the `NODE_EXTRA_CA_CERTS` environment variable. Point it at your
  corporate CA bundle: `export NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.pem` before running
  `tableau-viz` (the wrapper passes it through).
- `tableau-viz.sh` has an optional corporate-CA search block near the top (it looks for a
  bundle at a couple of conventional paths and sets `NODE_EXTRA_CA_CERTS` if found). It is
  currently commented out so it can't misfire on machines without that layout. If a
  first-run failure turns out to be a CA problem, restore/adjust that block (or set the env
  var directly) so Bun trusts your root.

## Viz URL format (Cloud/Server slugs)

The embed needs the **canonical view URL**, and the CLI now normalizes any of the forms
below to it:

- **Canonical embed path:** `https://<host>/t/<site>/views/<Workbook>/<View>`
  (Tableau Public: `https://public.tableau.com/views/<Workbook>/<View>`).
- **Browser address-bar URL** (`https://<host>/#/site/<site>/views/<Workbook>/<View>?...`)
  is the web-UI route, **not** an embed path — the CLI rewrites it to `/t/<site>/views/...`.
  The share dialog's *Copy Embed Code* always gives the canonical form.
- **Multi-word sheet names are slugified** in the `/views/` path: spaces are removed, so the
  sheet "What If Forecast" is `WhatIfForecast`, "Commission Model" is `CommissionModel`, and
  "Order Details" is `OrderDetails`. A display-name URL (`.../views/Superstore/What%20If%20Forecast`)
  or a hand-built name 404s. **Never construct the view name from the display name** — read
  each sheet's `url` field from the workbook snapshot (`helpers.listSheets()` / the `wait`
  snapshot), or copy the share link.
- The CLI validates URLs but **cannot know the correct slug** — the `/views/...` segment is
  preserved as given. If a view 404s, check that the segment is the slug, not the display name.