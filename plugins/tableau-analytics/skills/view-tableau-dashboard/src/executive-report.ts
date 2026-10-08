/**
 * executive-report.ts — render the Superstore "daily executive summary" HTML
 * from collected workflow scriptResults.
 *
 * The workflow (`run daily-executive-summary`) drives each Superstore public
 * view with its named script, collects the scriptResult per step, and hands the
 * results here. Each section answers its dashboard's question in plain prose
 * with the key numbers inline; failures are rendered as an inline error box so
 * the report still assembles.
 *
 * Styling uses the Action brand palette and mirrors the embed page
 * (`embed-tableau.html`): Cool Grey cards floating on the King Violet
 * background, with a per-section Action accent color.
 */

// ---------------------------------------------------------------------------
// value helpers
// ---------------------------------------------------------------------------

const money = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};

const money1 = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const pct = (n: unknown, digits = 1): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
};

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtRatio = (r: unknown): string => {
  const v = Number(r);
  return Number.isFinite(v) ? pct(v, 2) : "—";
};

/**
 * Turn a raw measure column name into a human label. Tableau's embedding API
 * returns Measure Names as LUID-qualified field ids
 * (e.g. `[federated.…].[sum:Quantity:qk]`); map the known calculated fields
 * to friendly names and generically de-qualify the rest.
 */
const friendlyMeasure = (name: unknown): string => {
  const s = String(name ?? "");
  if (s.includes("Calculation_9921103144103743")) return "Profit Ratio";
  if (s.includes("Calculation_9321103144526191")) return "Sales per Customer";
  if (s.includes("Sales per Customer (copy)")) return "Profit per Order";
  const m = s.match(/\[(?:federated\.[^\]]+\]\.)?(sum|avg|usr|min|max|cnt|count|median):(.+?):qk\]/);
  if (m) {
    const label = m[2].replace(/ \(copy\)$/, "");
    return m[1] === "avg" ? `Average ${label}` : label;
  }
  return s.replace(/^\[federated\.[^\]]+\]\.\[/, "").replace(/\]$/, "");
};

// ---------------------------------------------------------------------------
// shared scaffold
// ---------------------------------------------------------------------------

const errorBox = (err: unknown): string => `<div class="error">⚠ ${esc(err)}</div>`;

const bullet = (items: string[]): string =>
  items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "";

type Row = Record<string, unknown>;

const asObj = (v: unknown): Row | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;

const asArr = (v: unknown): Row[] =>
  Array.isArray(v) ? (v as Row[]) : [];

/** one section accent from the Action palette per dashboard */
const ACCENTS: Record<string, string> = {
  overview: "#00CCEA", // Blue Ice
  product: "#0094FF", // Serenity Sapphire
  customers: "#7B00F5", // Electric Lavender
  shipping: "#FF9900", // Golden Blaze
  performance: "#EC482D", // Command Crimson
  commission: "#F8227D", // Red Cerice
};

const table = (head: string[], rows: (string | number)[][]): string => {
  if (!rows.length) return "";
  const thead = `<tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td>${typeof c === "number" || c.startsWith("<") ? c : esc(c)}</td>`).join("")}</tr>`
    )
    .join("");
  return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
};

// ---------------------------------------------------------------------------
// per-dashboard renderers (prose + tables)
// ---------------------------------------------------------------------------

const renderOverview = (v: unknown): string => {
  const root = asObj(v);
  const head = asObj(root?.headline) ?? {};
  // Ratios (Profit Ratio, discounts) are fractions → %, Quantity is a count,
  // everything else is a dollar measure.
  const kpiChips = Object.entries(head)
    .map(([k, val]) => {
      const label = friendlyMeasure(k);
      let value: string;
      if (/ratio|discount/i.test(label)) value = pct(val, 1);
      else if (/quantity/i.test(label)) value = money1(val);
      else value = money(val);
      return `<div class="kpi"><div class="k">${esc(label)}</div><div class="v">${value}</div></div>`;
    })
    .join("");
  const kpiLine = Object.entries(head)
    .map(([k, val]) => {
      const label = friendlyMeasure(k);
      if (/ratio|discount/i.test(label)) return `${label} ${pct(val, 1)}`;
      if (/quantity/i.test(label)) return `${label} ${money1(val)}`;
      return `${label} ${money(val)}`;
    })
    .join(" · ");

  // The workflow now returns the FULL per-state list (cycled live on the map).
  // Derive the top/bottom rankings from it; fall back to the distilled
  // topByRatio/bottomByRatio/topBySales fields for older runs.
  const states = asArr(root?.states);
  const ranked = states.length
    ? states
        .map((s) => ({
          name: String(s.name ?? "—"),
          sales: Number(s.sales) || 0,
          profit: Number(s.profit) || 0,
          ratio: Number(s.profitRatio) || (Number(s.sales) ? (Number(s.profit) || 0) / Number(s.sales) : 0),
        }))
        .filter((s) => s.name !== "—")
    : [];
  const topRatio = ranked.length
    ? [...ranked].sort((a, b) => b.ratio - a.ratio).slice(0, 5)
    : asArr(root?.topByRatio);
  const bottomRatio = ranked.length
    ? [...ranked].sort((a, b) => a.ratio - b.ratio).slice(0, 5)
    : asArr(root?.bottomByRatio);
  const topSales = ranked.length
    ? [...ranked].sort((a, b) => b.sales - a.sales).slice(0, 5)
    : asArr(root?.topBySales);
  const totalStates = ranked.length || Number(root?.totalStates) || 0;

  const best = topRatio.map((s) => `${esc(s.name)} ${fmtRatio(s.ratio)} (${money(s.sales)} sales)`).join("; ");
  const worst = bottomRatio
    .map((s) => `${esc(s.name)} ${fmtRatio(s.ratio)} (${money(s.sales)} sales, ${money(s.profit)} profit)`)
    .join("; ");
  const leaders = topSales.map((s) => `${esc(s.name)} ${money(s.sales)}`).join("; ");

  const bestRows = topRatio.map((s) => [esc(s.name), pct(s.ratio, 2), money(s.sales), money(s.profit)]);
  const worstRows = bottomRatio.map((s) => [esc(s.name), pct(s.ratio, 2), money(s.sales), money(s.profit)]);
  const leaderRows = topSales.map((s) => [esc(s.name), money(s.sales), pct(s.ratio, 2)]);

  const allRows = ranked.length
    ? ranked
        .sort((a, b) => b.sales - a.sales)
        .map((s) => [esc(s.name), money(s.sales), money(s.profit), pct(s.ratio, 2)])
    : [];

  return `
    <p class="lead"><strong>Global company KPIs</strong> (all states/provinces, full date range): ${kpiLine || "—"}.</p>
    <div class="kpis">${kpiChips || "<div class='kpi'>—</div>"}</div>
    <p><strong>Best margins:</strong> ${best || "—"}.</p>
    ${table(["State", "Profit ratio", "Sales", "Profit"], bestRows)}
    <p><strong>Margin watchlist (bottom ${bottomRatio.length}):</strong> ${worst || "—"}.</p>
    ${table(["State", "Profit ratio", "Sales", "Profit"], worstRows)}
    <p><strong>Revenue leaders:</strong> ${leaders || "—"}.</p>
    ${table(["State", "Sales", "Profit ratio"], leaderRows)}
    ${allRows.length ? `<p><strong>Every state/province (cycled live on the map):</strong></p>${table(["State", "Sales", "Profit", "Profit ratio"], allRows)}` : ""}
    <p class="note">Ranked from ${money1(totalStates)} states/provinces (US + Canada).</p>`;
};

const renderProduct = (v: unknown): string => {
  const root = asObj(v);
  const regions = asObj(root?.regions) ?? {};
  const regionNames = Object.keys(regions);
  if (!regionNames.length) return errorBox("no region data returned");

  const blocks = regionNames.map((region) => {
    const cats = asObj(regions[region]) ?? {};
    const rows = Object.entries(cats).map(([cat, raw]) => {
      const m = asObj(raw) ?? {};
      const peak = asObj(m.peak);
      const trough = asObj(m.trough);
      return [
        String(cat),
        String(peak?.month ?? "—"),
        money(peak?.sales),
        String(trough?.month ?? "—"),
        money(trough?.sales),
      ];
    });
    return `<h3 class="region">${esc(region)}</h3>${table(
      ["Category", "Peak month", "Peak sales", "Trough month", "Trough sales"],
      rows
    )}`;
  });

  return `<p class="lead">Highest and lowest sales months per product category and region (sales aggregated across years by calendar month).</p>${blocks.join("")}`;
};

const renderCustomers = (v: unknown): string => {
  const root = asObj(v);
  const groups = asArr(root?.groups);
  if (!groups.length) return errorBox("no customer groups returned");

  const rows = groups.flatMap((g) =>
    asArr(g.top3).map((c, i) => [
      esc(g.category),
      esc(g.segment),
      i + 1,
      esc(c.name),
      money(c.sales),
      fmtRatio(c.ratio),
    ])
  );

  return `<p class="lead">The top 3 customers by sales for each category × segment.</p>${table(
    ["Category", "Segment", "Rank", "Customer", "Sales", "Margin"],
    rows
  )}`;
};

const renderShipping = (v: unknown): string => {
  const rows = asArr(v);
  if (!rows.length) return errorBox("no ship-mode results returned");

  const tableRows = rows.map((r) => [
    esc(r.shipMode),
    `${money1(r.delay)} day${Number(r.delay) === 1 ? "" : "s"}`,
    esc(r.orderId),
    esc(r.product),
    esc(r.shipStatus ?? ""),
  ]);

  return `<p class="lead">The greatest shipping delay per ship mode across the full date history (the Shipped Late line with the most days to ship).</p>${table(
    ["Ship mode", "Delay", "Order", "Product", "Status"],
    tableRows
  )}`;
};

const renderPerformance = (v: unknown): string => {
  const years = asArr(v);
  if (!years.length) return errorBox("no performance years returned");

  const lines = years.map((y) => {
    const up = asObj(y.biggestOvershoot);
    const down = asObj(y.biggestShortfall);
    const upTxt = up
      ? `${esc(up.cat)} ${(Number(up.delta) || 0) >= 0 ? "overshot" : "undershot"} target by ${money(Math.abs(Number(up.delta)))} (${money(up.actual)} actual vs ${money(up.target)} target)`
      : "no overshoot data";
    const downTxt = down
      ? (Number(down.delta) || 0) < 0
        ? `${esc(down.cat)} undershot by ${money(Math.abs(Number(down.delta)))}`
        : `no category net below target — smallest overshoot was ${esc(down.cat)} (${money(down.delta)} above)`
      : "no shortfall data";
    const sDown = asObj(y.sharpestDown);
    const sharpTxt = sDown
      ? `sharpest single miss: ${esc(sDown.cat)} · ${esc(sDown.segment)} in month ${esc(sDown.month)} (${money(sDown.delta)})`
      : "";
    return `<strong>${esc(String(y.year))}:</strong> ${upTxt}; ${downTxt}.${sharpTxt ? ` ${sharpTxt}.` : ""}`;
  });

  return `<p class="lead">Actual sales vs target by category for each year — the biggest overshoot and the biggest shortfall.</p>${bullet(lines)}`;
};

const renderCommission = (v: unknown): string => {
  const root = asObj(v);
  const rates = asArr(root?.compByRate);
  const quotas = asArr(root?.quotaSweep);
  if (!rates.length && !quotas.length) return errorBox("no commission results returned");

  const rateRows = rates.map((r) => [
    `${r.rate}%`,
    money(r.oteAvg),
    money(r.oteTotal),
    esc(asObj(r.topEarner)?.name),
    money(asObj(r.topEarner)?.total),
  ]);

  const quotaRows = quotas.map((q) => [
    money(q.quota),
    `${money1(q.clearedCount)} of ${money1(q.totalReps)} reps`,
    pct((Number(q.pctCleared) || 0) / 100, 1),
    asArr(q.topCleared)
      .slice(0, 3)
      .map((t) => `${esc(t.name)} (${pct(t.attainment, 1)})`)
      .join(", "),
  ]);

  return `
    <p class="lead">Compensation levers at a $50K base salary.</p>
    <p><strong>Commission rate (base $50K, quota $500K):</strong></p>
    ${table(["Rate", "OTE / rep", "Team OTE", "Top earner", "Total comp"], rateRows)}
    <p><strong>Quota attainment:</strong></p>
    ${table(["Quota", "Reps ≥ 100%", "% of team", "Top attainers"], quotaRows)}`;
};

// ---------------------------------------------------------------------------
// report assembly
// ---------------------------------------------------------------------------

export interface ReportCard {
  /** stable key — also used to look up the renderer */
  name: string;
  /** human title for the card */
  title: string;
  /** human subtitle for the card */
  subtitle: string;
  /** scriptResult value (status ok) */
  value?: unknown;
  /** scriptResult error (status error / wait failure) */
  error?: string;
}

const RENDERERS: Record<string, { title: string; sub: string; fn: (v: unknown) => string }> = {
  overview: { title: "Overview — global & state margins", sub: "Global KPIs, best/worst margins, revenue leaders", fn: renderOverview },
  product: { title: "Product — peak & trough months by region", sub: "Highest/lowest sales month per category and region", fn: renderProduct },
  customers: { title: "Customers — top accounts", sub: "Top 3 customers per category × segment", fn: renderCustomers },
  shipping: { title: "Shipping — worst delays by ship mode", sub: "Greatest days-to-ship delay per mode (full history)", fn: renderShipping },
  performance: { title: "Performance — actuals vs target", sub: "Biggest overshoot / shortfall per year", fn: renderPerformance },
  commission: { title: "Commission Model — compensation levers", sub: "OTE + top earner at 6/9/12%; quota attainment at $400k/$500k/$600k", fn: renderCommission },
};

export const WORKFLOW_REPORT_NAME = "daily-executive-summary.html";

export function renderExecutiveSummary(cards: ReportCard[]): string {
  const sections = cards
    .map((card) => {
      const def = RENDERERS[card.name];
      const title = def ? def.title : card.title;
      const subtitle = def ? def.sub : card.subtitle;
      const accent = ACCENTS[card.name] ?? "#00CCEA";
      const body = card.error !== undefined
        ? errorBox(card.error)
        : (def ? def.fn(card.value) : errorBox(`no renderer for step '${card.name}'`));
      return `
  <section id="${esc(card.name)}" class="card" style="--accent: ${accent}">
    <h2>${esc(title)}</h2>
    <p class="subtitle">${esc(subtitle)}</p>
    ${body}
  </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Superstore — Daily Executive Summary</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
    color: #d8e9f3; /* Cool Grey */
    line-height: 1.55;
    /* King Violet 7 base with a whisper of violet — mirrors embed-tableau.html */
    background:
      radial-gradient(1200px 800px at 18% -10%, rgba(93, 98, 132, 0.16), transparent 60%),
      radial-gradient(1000px 700px at 108% 112%, rgba(63, 70, 109, 0.22), transparent 55%),
      #141834;
  }
  header {
    background: linear-gradient(180deg, rgba(10, 17, 68, 0.94), rgba(10, 17, 68, 0.72));
    border-bottom: 3px solid #00CCEA; /* Blue Ice */
    padding: 26px 36px;
  }
  header h1 { margin: 0; font-size: 24px; letter-spacing: .2px; color: #fff; }
  header p { margin: 4px 0 0; color: #aebdff; font-size: 13px; }
  main { max-width: 1000px; margin: 0 auto; padding: 28px 32px 72px; }
  .card {
    background: #d8e9f3; /* Cool Grey — the same card surface as the embed */
    color: #0a1144; /* Blue Raven text on the light card */
    border: 1px solid rgba(216, 233, 243, 0.6);
    border-top: 5px solid var(--accent, #00CCEA);
    border-radius: 20px;
    padding: 22px 28px;
    margin: 20px 0;
    box-shadow:
      rgba(0, 0, 0, 0.4) 0px 2px 4px,
      rgba(0, 0, 0, 0.3) 0px 7px 13px -3px,
      rgba(0, 0, 0, 0.35) 0px 22px 70px 4px;
  }
  .card h2 { margin: 0 0 2px; font-size: 18px; color: #0a1144; }
  .card h3.region {
    margin: 14px 0 4px;
    font-size: 14px;
    color: #4655e4; /* Blue Maven */
    text-transform: uppercase;
    letter-spacing: .4px;
  }
  .subtitle { margin: 0 0 14px; color: #525676; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
  p { margin: 8px 0; font-size: 14px; }
  p.lead { font-size: 14px; color: #242b59; font-weight: 600; }
  ul { margin: 8px 0 8px 4px; padding-left: 22px; font-size: 14px; }
  li { margin: 6px 0; }
  .note { color: #525676; font-size: 12px; margin: 10px 0 0; }
  .error { color: #8d2b1b; background: #f7b5ab; border: 1px solid #ec482d; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 14px 0; }
  .kpi { background: #fff; border-radius: 14px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(10, 17, 68, 0.15); }
  .kpi .k { font-size: 11px; color: #50687a; text-transform: uppercase; letter-spacing: .5px; }
  .kpi .v { font-size: 18px; font-weight: 700; color: #0a1144; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; background: #0a1144; color: #d8e9f3; font-weight: 600; }
  td { padding: 7px 10px; border-bottom: 1px solid #c5ced6; }
  tr:nth-child(even) td { background: #e3eff6; }
  footer { color: #b5b7c6; font-size: 12px; text-align: center; padding: 16px 32px 28px; }
</style>
</head>
<body>
<header>
  <h1>Superstore — Daily Executive Summary</h1>
  <p>Live reads from the Superstore Tableau Public workbook · generated ${new Date().toLocaleString()}</p>
</header>
<main>${sections}</main>
<footer>Assembled by the view-tableau-dashboard daily-executive-summary workflow · demo data (Sample – Superstore)</footer>
</body>
</html>`;
}