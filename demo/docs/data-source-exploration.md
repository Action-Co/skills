# Tabby external data source exploration

Status: working draft. Research checked November 24, 2026.

Branch: `CTASK-4728_Tabby_Data_Source_Exploration`.

## Direction

Start with Our World in Data (OWID) to demonstrate Tabby answering questions
about public data beside an interactive chart. Continue using Tableau Public
for the existing Superstore demonstration.

Power BI, ThoughtSpot, and Snowflake remain candidates for later integrations.
They are deferred for this public demonstration because their setup,
entitlements, or evaluation deadlines introduce dependencies we do not need
for this first experiment. This is a demo selection decision, not a finding
that Tabby cannot connect to those products.

Snowflake is a data platform, rather than a direct equivalent of the Power BI
or ThoughtSpot visualization experience. A Snowflake connection would primarily
demonstrate querying a warehouse; displaying charts would be a separate concern.

## What this demonstration needs

- Visitors can explore without creating an account with the data provider.
- The source has no scheduled trial or evaluation expiry.
- No payment method or paid capacity is needed for the selected public source.
- Tabby can retrieve actual values and their definitions, units, and citations.
- An interactive visualization can sit beside the conversation.
- Setup can be reproduced without managing a customer tenant or warehouse.

These criteria concern the external data connection. Ask Tabby still needs
its existing authenticated AI assistant and that assistant's applicable plan;
choosing free data does not make the complete AI experience account-free or free.

## Why the commercial platforms are deferred

| Candidate | What remains useful | Why it is deferred for this demo |
| --- | --- | --- |
| Tableau Public | Existing public charts, free hosting, and the current Tabby integration. | Retained as the baseline; an additional source must demonstrate broader access. |
| Power BI | Semantic models, DAX queries, and embedded reports. | Personal free access differs from distributing reports. Secure customer embedding requires additional setup and production capacity; development tokens are limited. |
| ThoughtSpot | Data APIs and embeddable interactive analytics. | Developer Edition is advertised as free for one year, with up to 10 users and 25 million rows. It requires an instance and authentication configuration; it is not an indefinite public service. |
| Snowflake | Direct SQL access to governed data. | The trial lasts 30 days or until its usage balance is exhausted. We would manage an account, identity, permissions, compute, and eventual ongoing cost. |

Evidence:

- [Tableau Public overview](https://public.tableau.com/app/about).
- [Power BI free-user capabilities](https://learn.microsoft.com/en-us/power-bi/fundamentals/end-user-features)
  and [embedding development and production requirements](https://learn.microsoft.com/en-us/power-bi/developer/embedded/move-to-production).
- [ThoughtSpot pricing](https://www.thoughtspot.com/pricing)
  and [embedding authentication](https://developers.thoughtspot.com/docs/embed-auth).
- [Snowflake trial conditions](https://docs.snowflake.com/en/user-guide/admin-trial-account)
  and [authentication options](https://docs.snowflake.com/en/user-guide/security-authentication-overview).

### Corrections and unresolved details

Power BI's Publish to web can serve anonymous viewers. That does not establish
that a free author license can publish our own demonstration. Microsoft's
free-user guide, last updated September 24, 2026, explicitly excludes creating
Publish-to-web embed codes. The separate
[Publish to web guide](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-publish-to-web)
uses less specific licensing language for My Workspace. The earlier suggestion
that public viewing alone made Power BI a confirmed free equivalent was
incomplete. Do not plan around that assumption without verifying eligibility.

ThoughtSpot advertises a
[14-day trial without a credit card](https://www.thoughtspot.com/data-trends/best-practices/modern-data-stack).
Whether converting to the one-year Developer Edition requires payment
information has not been verified. Its permitted audience and authentication
features must also be checked before treating a shared demo identity as an
approved deployment pattern. A shared identity must not be assumed to bypass
the edition's user limit.

Individual visitor logins are not an unavoidable requirement of these products.
Application identities and embedding can remove a separate provider sign-in.
The remaining concern is our provisioning, licensing, and operating burden.

## Why start with Our World in Data

OWID supplies public interactive charts and direct CSV and metadata URLs.
There is no provider account or API key to distribute to presenters or visitors,
and this access is not a timed evaluation. The existing CSV analysis tool gives
Tabby a practical starting point for querying those values.

Use the hosted chart embed and the published data endpoints. Embedding a chart
is different from copying or bundling OWID's charting software, which has
separate reuse terms. Preserve attribution and check the original provider's
license for each selected dataset; public availability is not blanket permission
to redistribute all underlying data.

Sources: [chart and data reuse guidance](https://ourworldindata.org/faqs),
[Chart API](https://docs.owid.io/projects/etl/api/chart-api/).

Public access has no scheduled trial deadline, but continued availability and
unchanged data are not guaranteed. A cached data extract can support analysis
during an outage; it does not make the remotely hosted interactive chart work offline.

## Initial OWID integration

Implemented on this branch on November 24, 2026. The sidebar source picker keeps
one provider active at a time and retains the visible conversation across switches.
The following describes the implementation and its remaining boundaries.

### 1. Start with one chart

Use [Life expectancy](https://ourworldindata.org/grapher/life-expectancy)
as the initial candidate, subject to confirming its data reuse terms and the
requested years. A useful opening question is: "Compare life expectancy in the
United States, Canada, and Japan from 2000 to 2020."

Keep the initial catalog small and explicit. Store the chart slug, title,
supported selections, data URL, metadata URL, and source links together.

### 2. Reuse the chart-and-chat layout

The existing [page](../app/index.html) already displays an iframe beside the
Ask Tabby drawer. Add an OWID entry that opens the hosted chart directly.
It should not start a Tableau dashboard session or run a Tableau walkthrough.

Source handling in [the server](../app/server.ts) distinguishes OWID from the
existing Superstore catalog. Mixed-provider requests are rejected. Switching
providers starts a fresh assistant session while keeping chat history on screen.

### 3. Retrieve and query chart data

Fetch the selected chart's `.csv` and `.metadata.json` endpoints through the
local server. Cache a bounded extract with its retrieval time, source URL,
metadata, and content hash. Reuse [the CSV query tool](../tools/tabby-csv.sh)
for calculations rather than estimating values from chart pixels.

The adapter should validate the configured OWID host and chart, apply download
limits and timeouts, and report failures or missing values explicitly. The
backend should choose source files; messages from the browser should not grant
arbitrary file or URL access.

Update [the agent instructions](../opening-prompt.md) and relevant tool
permissions so both supported assistants use the OWID data path and cite it.

The [OWID adapter](../app/owid.ts) uses the existing CSV command permissions;
no additional assistant tool permission or dependency is needed. Extracts use
the normalized columns Entity, Code, Year, and Life expectancy (years).

### 4. Make the analysis scope explicit

Keep chart, country, and year selections in Tabby. Use those selections to
construct both the embed URL and the data query. OWID documents `country`,
`time`, and `tab` URL parameters, plus `csvType=filtered` for relevant data
downloads. Verify the returned countries and years; do not infer completeness
from a successful response alone.

An embedded chart is interactive, but Tabby cannot assume it sees changes made
inside that cross-origin iframe. Automatic state readback is unverified.
The first version should label its analysis scope and offer a way to reset the
chart to that comparison. Direct exploration inside the chart must not silently
change the scope Tabby claims to have analyzed. Two-way synchronization is a
separate investigation.

Live embeds and cached CSVs can also differ after a data revision. Record
retrieval times and refresh them together as closely as practical. If exact
reproducibility is required, investigate an archived chart paired with a
verified matching data extract; do not assume today's CSV matches an old chart.
OWID documents both [live and archived embeds](https://ourworldindata.org/new-feature-embed-archived-charts).

The first version resets the iframe to the applied comparison when sending a
question. Unapplied form edits disable sending. It displays missing-observation
warnings and appends source, scope, and retrieval time to completed OWID answers.
Its snapshot is a dated data extract, not a claim that the live chart is frozen
to the same revision.

### Dataset reuse evidence

On November 24, 2026, the chart's
[indicator metadata](https://api.ourworldindata.org/v1/indicators/1118466.metadata.json)
reported `nonRedistributable: false` and identified original-source licenses.
For 1950 onward, the chart's processing notes identify UN World Population
Prospects; its metadata lists CC BY 3.0 IGO. The historical sources and their
license links are retained in that indicator metadata. This records the evidence
reviewed, rather than assuming every OWID dataset has the same license.

### 5. Check the complete experience

Before calling the experiment working, verify:

- The chart opens beside chat without an OWID account or API key.
- Both supported assistants answer from the selected dataset rather than a
  Tableau session or general model knowledge.
- A country comparison and a follow-up year change use the expected values,
  units, and analysis scope, checked against an independent calculation.
- Missing years, unknown countries, metadata changes, and network failures
  produce clear limitations instead of invented answers.
- Source attribution, retrieval time, and data scope appear with the answer.
- Native chart exploration does not create a false claim of synchronized state.
- Existing Tableau and attached-CSV flows still work.

## Current boundary

This draft records the rationale and initial implementation. Vendor facts were checked
against the linked documentation on the research date. Repository inspection
established the existing iframe, chat-context, and CSV mechanisms. An end-to-end
OWID chart and a real Codex answer have been exercised in the browser. Automatic
browser state synchronization, matching archived extracts, offline chart hosting,
and live Claude verification remain outside the completed verification.
