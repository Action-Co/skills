/**
 * executive-report.ts — render the Superstore "daily executive summary" HTML
 * from collected workflow scriptResults.
 *
 * The workflow (`run daily-executive-summary`) drives each Superstore public
 * view with its named script, collects the scriptResult per step, and hands the
 * results here. Each section answers its dashboard's question in plain prose
 * with the key numbers inline (no data dumps); failures are rendered as an
 * inline error box so the report still assembles.
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

// ---------------------------------------------------------------------------
// per-dashboard renderers (prose)
// ---------------------------------------------------------------------------

const renderOverview = (v: unknown): string => {
  const root = asObj(v);
  const head = asObj(root?.headline) ?? {};
  // Ratios (Profit Ratio, discounts) are fractions → %, Quantity is a count,
  // everything else is a dollar measure.
  const kpi = Object.entries(head)
    .map(([k, val]) => {
      const label = friendlyMeasure(k);
      if (/ratio|discount/i.test(label)) return `${label} ${pct(val, 1)}`;
      if (/quantity/i.test(label)) return `${label} ${money1(val)}`;
      return `${label} ${money(val)}`;
    })
    .join(" · ");

  const topRatio = asArr(root?.topByRatio);
  const bottomRatio = asArr(root?.bottomByRatio);
  const topSales = asArr(root?.topBySales);

  const best = topRatio.map((s) => `${esc(s.name)} ${fmtRatio(s.ratio)} (${money(s.sales)} sales)`).join("; ");
  const worst = bottomRatio
    .map((s) => `${esc(s.name)} ${fmtRatio(s.ratio)} (${money(s.sales)} sales, ${money(s.profit)} profit)`)
    .join("; ");
  const leaders = topSales.map((s) => `${esc(s.name)} ${money(s.sales)}`).join("; ");

  return `
    <p class="lead"><strong>Global company KPIs</strong> (all states/provinces, full date range): ${kpi || "—"}.</p>
    <p><strong>Best margins:</strong> ${best || "—"}.</p>
    <p><strong>Margin watchlist (bottom ${bottomRatio.length}):</strong> ${worst || "—"}.</p>
    <p><strong>Revenue leaders:</strong> ${leaders || "—"}.</p>
    <p class="note">Ranked from ${money1(root?.totalStates)} states/provinces (US + Canada).</p>`;
};

const renderProduct = (v: unknown): string => {
  const root = asObj(v);
  const regions = asObj(root?.regions) ?? {};
  const regionNames = Object.keys(regions);
  if (!regionNames.length) return errorBox("no region data returned");

  const lines = regionNames.map((region) => {
    const cats = asObj(regions[region]) ?? {};
    const parts = Object.entries(cats).map(([cat, raw]) => {
      const m = asObj(raw) ?? {};
      const peak = asObj(m.peak);
      const trough = asObj(m.trough);
      return `${esc(cat)} peaks in month ${peak?.month ?? "—"} (${money(peak?.sales)}) and troughs in month ${trough?.month ?? "—"} (${money(trough?.sales)})`;
    });
    return `<strong>${esc(region)}:</strong> ${parts.join("; ")}.`;
  });

  return `<p class="lead">Highest and lowest sales months per product category and region (sales aggregated across years by calendar month).</p>${bullet(lines)}`;
};

const renderCustomers = (v: unknown): string => {
  const root = asObj(v);
  const groups = asArr(root?.groups);
  if (!groups.length) return errorBox("no customer groups returned");

  const lines = groups.map((g) => {
    const top = asArr(g.top3)
      .map((c, i) => `${i + 1}. ${esc(c.name)} ${money(c.sales)} (${fmtRatio(c.ratio)} margin)`)
      .join("; ");
    return `<strong>${esc(g.category)} · ${esc(g.segment)}:</strong> ${top}.`;
  });

  return `<p class="lead">The top 3 customers by sales for each category × segment.</p>${bullet(lines)}`;
};

const renderShipping = (v: unknown): string => {
  const rows = asArr(v);
  if (!rows.length) return errorBox("no ship-mode results returned");

  const lines = rows.map((r) =>
    `<strong>${esc(r.shipMode)}:</strong> ${money1(r.delay)} day${Number(r.delay) === 1 ? "" : "s"} — order ${esc(r.orderId)} (${esc(r.product)})${r.shipStatus ? `, ${esc(r.shipStatus)}` : ""}`
  );

  return `<p class="lead">The greatest shipping delay per ship mode across the full date history (the Shipped Late line with the most days to ship).</p>${bullet(lines)}`;
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

  const rateTxt = rates
    .map((r) => `${r.rate}%: OTE ${money(r.oteAvg)}/rep (team ${money(r.oteTotal)}), top earner ${esc(asObj(r.topEarner)?.name)} at ${money(asObj(r.topEarner)?.total)}`)
    .join("; ");

  const quotaTxt = quotas
    .map((q) => `at ${money(q.quota)} quota ${money1(q.clearedCount)} of ${money1(q.totalReps)} reps clear 100% (${pct((Number(q.pctCleared) || 0) / 100, 1)})`)
    .join("; ");

  const defaultQuota = quotas.find((q) => Number(q.quota) === 500000);
  const topNames = asArr(defaultQuota?.topCleared)
    .slice(0, 3)
    .map((r) => `${esc(r.name)} (${pct(r.attainment, 1)})`)
    .join(", ");

  return `
    <p class="lead">Compensation levers at a $50K base salary.</p>
    <p><strong>Commission rate:</strong> ${rateTxt || "—"}.</p>
    <p><strong>Quota attainment:</strong> ${quotaTxt || "—"}.${topNames ? ` Top attainers at the $500K quota: ${topNames}.` : ""}</p>`;
};

const renderOrders = (v: unknown): string => {
  const root = asObj(v);
  const top10 = asArr(root?.top10);
  const list = top10.map((s, i) => `${i + 1}. ${esc(s.state)} ${money1(s.orders)}`).join("; ");
  return `
    <p class="lead">${money1(root?.totalOrders)} distinct orders across ${money1(root?.stateCount)} states/provinces.</p>
    <p><strong>Top states by order volume:</strong> ${list || "—"}.</p>`;
};

const renderForecast = (v: unknown): string => {
  const root = asObj(v);
  const base = root?.baseline && typeof root.baseline === "object"
    ? (root.baseline as Row).actualTotal
    : 0;
  const scenarios = asArr(root?.scenarios);
  if (!scenarios.length) return errorBox("no forecast scenarios returned");

  const byTotal = [...scenarios].sort((a, b) => Number(b.forecastTotal) - Number(a.forecastTotal));
  const best = byTotal[0];
  const worst = byTotal[byTotal.length - 1];

  const lines = scenarios.map((s) =>
    `${(Number(s.growth) * 100).toFixed(0)}% growth / ${(Number(s.churn) * 100).toFixed(0)}% churn → ${money(s.forecastTotal)} (${Number(s.upliftPct) > 0 ? "+" : ""}${s.upliftPct}% vs actual)`
  );

  return `
    <p class="lead">Baseline actual sales: ${money(base)}. The forecast is a scenario multiplier (sales × (1 + growth) × (1 − churn)), so the interesting comparison is across scenarios.</p>
    ${bullet(lines)}
    <p>The most aggressive scenario (${(Number(best.growth) * 100).toFixed(0)}% growth / ${(Number(best.churn) * 100).toFixed(0)}% churn) reaches ${money(best.forecastTotal)} (+${best.upliftPct}%), while the most conservative (${(Number(worst.growth) * 100).toFixed(0)}% / ${(Number(worst.churn) * 100).toFixed(0)}%) barely clears actuals at ${money(worst.forecastTotal)} (+${worst.upliftPct}%). ${best.topRegion ? `The ${esc(best.topRegion)} region leads in every scenario.` : ""}</p>`;
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
  orders: { title: "Order Details — order volume by state", sub: "Distinct orders, top states", fn: renderOrders },
  forecast: { title: "What If Forecast — scenario totals", sub: "Growth × churn scenarios vs actuals", fn: renderForecast },
};

export const WORKFLOW_REPORT_NAME = "daily-executive-summary.html";

export function renderExecutiveSummary(cards: ReportCard[]): string {
  const sections = cards
    .map((card) => {
      const def = RENDERERS[card.name];
      const title = def ? def.title : card.title;
      const subtitle = def ? def.sub : card.subtitle;
      const body = card.error !== undefined
        ? errorBox(card.error)
        : (def ? def.fn(card.value) : errorBox(`no renderer for step '${card.name}'`));
      return `
  <section id="${esc(card.name)}" class="card">
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
<title>Superstore — Daily Executive Summary</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0; background: #f3f5f8; color: #1c2733; line-height: 1.55;
  }
  header { background: #1c2733; color: #fff; padding: 24px 32px; }
  header h1 { margin: 0; font-size: 22px; letter-spacing: .2px; }
  header p { margin: 4px 0 0; color: #b9c4d1; font-size: 13px; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 32px 64px; }
  .card {
    background: #fff; border: 1px solid #e1e7ee; border-radius: 10px;
    padding: 20px 26px; margin: 18px 0;
  }
  .card h2 { margin: 0 0 2px; font-size: 17px; }
  .subtitle { margin: 0 0 12px; color: #6b7a8d; font-size: 12.5px; }
  p { margin: 8px 0; font-size: 14px; }
  p.lead { font-size: 14px; color: #33475b; }
  ul { margin: 8px 0 8px 4px; padding-left: 22px; font-size: 14px; }
  li { margin: 6px 0; }
  .note { color: #6b7a8d; font-size: 12px; margin: 10px 0 0; }
  .error { color: #9b2c2c; background: #fdeeee; border: 1px solid #f5c6c6; border-radius: 6px; padding: 8px 12px; font-size: 13px; }
  footer { color: #6b7a8d; font-size: 12px; text-align: center; padding: 12px; }
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