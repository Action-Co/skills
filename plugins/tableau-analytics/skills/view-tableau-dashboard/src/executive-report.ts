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
 * Styling comes from the shared Action-branded shell in brand.ts (Kanit, the
 * Action palette, dark on screen and light in print/PDF).
 */

import { brandedPage, esc } from "./brand.ts";

// ---------------------------------------------------------------------------
// value helpers
// ---------------------------------------------------------------------------

/** A value the source did not provide — distinct from a real 0. */
const isMissing = (n: unknown): boolean => n === null || n === undefined || n === "";

const money = (n: unknown): string => {
  if (isMissing(n)) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};

const money1 = (n: unknown): string => {
  if (isMissing(n)) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const pct = (n: unknown, digits = 1): string => {
  if (isMissing(n)) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
};

const fmtRatio = (r: unknown): string => (isMissing(r) ? "—" : pct(r, 2));

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

const errorBox = (err: unknown): string => `<div class="error">${esc(err)}</div>`;

const bullet = (items: string[]): string =>
  items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "";

type Row = Record<string, unknown>;

const asObj = (v: unknown): Row | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;

const asArr = (v: unknown): Row[] =>
  Array.isArray(v) ? (v as Row[]) : [];

/** money, percent and count cells read better right-aligned */
const isNumeric = (c: string | number): boolean =>
  typeof c === "number" || /^[-−]?\$?[\d,.]+%?$/.test(c.trim());

const table = (head: string[], rows: unknown[][]): string => {
  if (!rows.length) return "";
  const numeric = head.map((_, i) => rows.every((r) => r[i] === undefined || r[i] === "—" || isNumeric(r[i])));
  const align = (i: number) => (numeric[i] && i > 0 ? ' align="right"' : "");
  const thead = `<tr>${head.map((h, i) => `<th${align(i)}>${esc(h)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (r) =>
        `<tr>${r.map((c, i) => `<td${align(i)}>${typeof c === "number" ? c : esc(c)}</td>`).join("")}</tr>`
    )
    .join("");
  return `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
};

// ---------------------------------------------------------------------------
// per-dashboard renderers (prose + tables)
// ---------------------------------------------------------------------------

const renderOverview = (v: unknown): string => {
  const root = asObj(v);
  const head = asObj(root?.headline) ?? {};
  // A usable Overview needs a headline and/or a state ranking. An empty object
  // (or one with neither) is not a valid executive answer.
  if (
    !Object.keys(head).length &&
    !asArr(root?.states).length &&
    !asArr(root?.topByRatio).length &&
    !Number(root?.totalStates)
  ) {
    return errorBox("no overview data returned");
  }
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
      if (/ratio|discount/i.test(label)) return `${esc(label)} ${pct(val, 1)}`;
      if (/quantity/i.test(label)) return `${esc(label)} ${money1(val)}`;
      return `${esc(label)} ${money(val)}`;
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

  const bestRows = topRatio.map((s) => [s.name, pct(s.ratio, 2), money(s.sales), money(s.profit)]);
  const worstRows = bottomRatio.map((s) => [s.name, pct(s.ratio, 2), money(s.sales), money(s.profit)]);
  const leaderRows = topSales.map((s) => [s.name, money(s.sales), pct(s.ratio, 2)]);

  const allRows = ranked.length
    ? ranked
        .sort((a, b) => b.sales - a.sales)
        .map((s) => [s.name, money(s.sales), money(s.profit), pct(s.ratio, 2)])
    : [];

  const scope = asObj(root?.scope);
  const regionScope =
    scope && typeof scope.region === "string"
      ? scope.region === "all"
        ? "all states/provinces"
        : `region: ${esc(scope.region)}`
      : "all states/provinces";
  const dateScope =
    scope && typeof scope.orderDate === "string"
      ? scope.orderDate === "all"
        ? "full date range"
        : `date scope: ${esc(scope.orderDate)}`
      : "current date scope";

  return `
    <p class="lead"><strong>Global company KPIs</strong> (${regionScope}, ${dateScope}): ${kpiLine || "—"}.</p>
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
      g.category,
      g.segment,
      i + 1,
      c.name,
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
  const obj = asObj(v);
  const rows = (obj && Array.isArray(obj.modes) ? obj.modes : asArr(v)).filter(
    (r) => r && typeof r === "object"
  );
  if (!rows.length) return errorBox("no ship-mode results returned");

  const tableRows = rows.map((r) => [
    r.shipMode,
    `${money1(r.delay)} day${Number(r.delay) === 1 ? "" : "s"}`,
    r.orderId,
    r.product,
    r.shipStatus ?? "",
  ]);

  return `<p class="lead">The greatest shipping delay per ship mode across the full date history (the Shipped Late line with the most days to ship).</p>${table(
    ["Ship mode", "Delay", "Order", "Product", "Status"],
    tableRows
  )}`;
};

const renderPerformance = (v: unknown): string => {
  const obj = asObj(v);
  const years = obj && Array.isArray(obj.years) ? obj.years : asArr(v);
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
    const sDownDelta = sDown ? Number(sDown.delta) || 0 : 0;
    const sharpTxt = sDown
      ? `sharpest single ${sDownDelta < 0 ? "miss" : "gain"}: ${esc(sDown.cat)} · ${esc(sDown.segment)} in month ${esc(sDown.month)} (${money(sDown.delta)})`
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
    asObj(r.topEarner)?.name ?? "—",
    money(asObj(r.topEarner)?.total),
  ]);

  const quotaRows = quotas.map((q) => [
    money(q.quota),
    `${money1(q.clearedCount)} of ${money1(q.totalReps)} reps`,
    isMissing(q.pctCleared) ? "—" : pct(Number(q.pctCleared) / 100, 1),
    asArr(q.topCleared)
      .slice(0, 3)
      .map((t) => `${t.name} (${pct(t.attainment, 1)})`)
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
  /** serialization losses reported by the page for this card's eval(s) */
  warnings?: string[];
  /** true when the eval may still be running (unsafe to retry) */
  uncertain?: boolean;
  /** session that produced the card (ownership evidence) */
  sessionId?: string;
  /** how many attempts were made */
  attempts?: number;
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

export type CardStatus = "ok" | "partial" | "error";
export interface CardOutcome {
  name: string;
  status: CardStatus;
  detail?: string;
}

/** Wrapped-array accessor: shipping/performance now return `{ modes|years }`. */
const cardArray = (value: unknown, key: string): Row[] => {
  const o = asObj(value);
  if (o && Array.isArray(o[key])) return asArr(o[key]);
  return asArr(value);
};

/** Does the value contain a usable executive answer for this dashboard? */
function analyzeValue(name: string, value: unknown): { usable: boolean; reason?: string } {
  const root = asObj(value);
  switch (name) {
    case "overview": {
      const head = asObj(root?.headline);
      const hasHead = !!head && Object.keys(head).length > 0;
      const hasRanking =
        asArr(root?.states).length > 0 ||
        asArr(root?.topByRatio).length > 0 ||
        asArr(root?.topBySales).length > 0;
      const usable = hasHead || hasRanking || Number(root?.totalStates) > 0;
      return { usable, reason: "no headline KPIs or state ranking returned" };
    }
    case "product": {
      const regions = asObj(root?.regions);
      const usable =
        !!regions &&
        Object.values(regions).some((cats) => {
          const c = asObj(cats);
          return (
            !!c &&
            Object.values(c).some((m) => {
              const mm = asObj(m);
              return !!(mm && (asObj(mm.peak) || asObj(mm.trough)));
            })
          );
        });
      return { usable, reason: "no peak/trough months returned" };
    }
    case "customers": {
      const groups = asArr(root?.groups);
      const usable = groups.some((g) =>
        asArr(asObj(g)?.top3).some((c) => !!asObj(c)?.name)
      );
      return { usable, reason: "no customers returned" };
    }
    case "shipping": {
      const rows = cardArray(value, "modes").filter((r) => r && typeof r === "object");
      const usable = rows.some((r) => {
        const row = r as Row;
        return !!row.shipMode && (!!row.orderId || Number.isFinite(Number(row.actualDays)));
      });
      return { usable, reason: "no ship-mode delays returned" };
    }
    case "performance": {
      const years = cardArray(value, "years");
      const usable = years.some((y) => {
        const yy = asObj(y);
        return !!(
          yy &&
          (asObj(yy.biggestOvershoot) ||
            asObj(yy.biggestShortfall) ||
            asObj(yy.sharpestUp) ||
            asObj(yy.sharpestDown))
        );
      });
      return { usable, reason: "no actual-vs-target analysis returned" };
    }
    case "commission": {
      const rates = asArr(root?.compByRate);
      const quotas = asArr(root?.quotaSweep);
      const usable =
        rates.some((r) => {
          const rr = asObj(r);
          return !!rr && (rr.oteAvg != null || !!asObj(rr.topEarner));
        }) || quotas.some((q) => Number(asObj(q)?.totalReps) > 0);
      return { usable, reason: "no compensation or quota results returned" };
    }
    default:
      return { usable: true };
  }
}

/** A limitation on an otherwise-usable card (incomplete data / failed cleanup). */
function incompleteReason(value: unknown): string | undefined {
  const o = asObj(value);
  const cleanup = o && Array.isArray(o.cleanup) ? (o.cleanup as string[]) : [];
  if (o && o.complete === false) {
    return String(
      o.note ??
        (cleanup.length ? `cleanup incomplete: ${cleanup.join("; ")}` : "incomplete data")
    );
  }
  if (cleanup.length) return `cleanup incomplete: ${cleanup.join("; ")}`;
  return undefined;
}

/** The text of a renderer error box (`<div class="error">⚠ …</div>`). */
function errorBoxText(html: string): string | undefined {
  const m = html.match(/class="error">⚠ ([^<]*)</);
  return m ? m[1] : undefined;
}

/**
 * Render the report and, alongside the HTML, report each card's outcome so the
 * workflow status reflects *usable analysis*, not just transport success: a
 * card with no usable answer or a renderer error box is "error"; an incomplete
 * value (`complete === false`), a failed cleanup, or a bounded (lossy) result
 * is "partial".
 */
export function renderExecutiveSummaryDetailed(cards: ReportCard[]): {
  html: string;
  outcomes: CardOutcome[];
} {
  const outcomes: CardOutcome[] = [];
  const sections = cards
    .map((card) => {
      const def = RENDERERS[card.name];
      const title = def ? def.title : card.title;
      const subtitle = def ? def.sub : card.subtitle;
      let body: string;
      let status: CardStatus = "ok";
      let detail: string | undefined;
      if (card.error !== undefined) {
        status = "error";
        detail = card.error;
        body = errorBox(card.error);
      } else if (!def) {
        status = "error";
        detail = `no renderer for step '${card.name}'`;
        body = errorBox(detail);
      } else {
        try {
          body = def.fn(card.value);
          const renderedError = /class="error"/.test(body);
          const analysis = analyzeValue(card.name, card.value);
          if (renderedError) {
            status = "error";
            detail = errorBoxText(body) ?? "renderer produced an error box";
          } else if (!analysis.usable) {
            status = "error";
            detail = analysis.reason ?? "no usable answer";
            body = errorBox(detail);
          } else if (card.uncertain) {
            status = "error";
            detail = `eval may still be running — ${card.error ?? "uncertain result"}`;
          } else {
            const reason = incompleteReason(card.value);
            if (reason) {
              status = "partial";
              detail = reason;
            } else if (card.warnings && card.warnings.length) {
              status = "partial";
              detail = `result was bounded: ${card.warnings.join("; ")}`;
            }
          }
        } catch (err) {
          status = "error";
          detail = `render failed: ${err instanceof Error ? err.message : String(err)}`;
          body = errorBox(detail);
        }
      }
      outcomes.push({ name: card.name, status, detail });
      const note =
        status === "partial" && detail ? `<p class="note">⚠ ${esc(detail)}</p>` : "";
      return `
  <section id="${esc(card.name)}" class="card">
    <h2>${esc(title)}</h2>
    <p class="subtitle">${esc(subtitle)}</p>
    ${body}
    ${note}
  </section>`;
    })
    .join("");

  const html = brandedPage({
    eyebrow: "Superstore · Tableau Public",
    title: "Daily executive summary",
    subtitle: "Live reads from the six Superstore dashboards",
    body: sections,
    footer: "Assembled by Tabby from the daily-executive-summary workflow · Sample – Superstore data",
  });
  return { html, outcomes };
}

export function renderExecutiveSummary(cards: ReportCard[]): string {
  return renderExecutiveSummaryDetailed(cards).html;
}