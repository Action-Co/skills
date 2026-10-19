// overview-state-ranking — Superstore Overview: rank every US state and
// Canadian province by Profit Ratio and by Sales, with the headline KPIs.
//
// VISIBLE showcase: widens the Profit Ratio slider (every state appears) and
// visibly clicks through a curated set of states on the Sale Map — each
// selection narrows the KPI cards / segment / product charts, then the
// selection is cleared. The full per-state ranking is read from the map's
// underlying data via the paged reader, then reconciled to the headline.
//
// The company headline is read BEFORE any state is selected, so it is the full
// company figure — not the last state the showcase happened to click.
//
// Returns: { headline, states: [{ name, sales, profit, ratio }], totalStates,
//            complete, note, reconciliation, cleanup, cycled: [state names] }

const MAP = "Sale Map";
const KPI = "Total Sales";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const cleanupErrors = [];
const cleanupStep = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    cleanupErrors.push(label + ": " + (e && e.message ? e.message : String(e)));
  }
};

// --- capture the Region / Order Date scope so the headline label is honest --
// The Overview dashboard carries applied Region and Order Date filters; the
// script does not widen them, so the headline is only "full history" if those
// filters are all-selected. Record the observed scope rather than asserting it.
let scope = { region: "unknown", orderDate: "unknown" };
try {
  const filters = await helpers.getFilters();
  const pick = (name) => {
    const f = filters.find((x) => x.fieldName === name && x.filterType === "categorical");
    if (!f) return "unavailable";
    if (f.isAllSelected) return "all";
    return (f.appliedValues ?? [])
      .map((v) => (v && typeof v === "object" ? v.value : v))
      .join(", ");
  };
  scope = { region: pick("Region"), orderDate: pick("Order Date") };
} catch {
  // leave the unknown defaults
}

// --- capture + widen the Profit Ratio slider --------------------------------
// A failed widening leaves the map (and its underlying rows) clipped, so the
// ranking is not a complete picture — record that instead of hiding it.
let originalRatioRange = null;
let originalNullOption = null;
let sliderWidened = false;
try {
  const d = await helpers.describeFilter("AGG(Profit Ratio)", { worksheet: MAP });
  if (d && d.filterType === "range" && d.domain && d.domain.min !== undefined && d.domain.max !== undefined) {
    originalRatioRange = { min: num(d.minValue), max: num(d.maxValue) };
    originalNullOption = d.nullOption ?? null;
    await helpers.applyRangeFilter(MAP, "AGG(Profit Ratio)", {
      min: Number(d.domain.min),
      max: Number(d.domain.max),
      ...(originalNullOption ? { nullOption: originalNullOption } : {}),
    });
    sliderWidened = true;
  }
} catch {
  // leave sliderWidened = false — the ranking may be clipped
}

// Everything below mutates the viz (slider, marks); the finally restores the
// slider range (and null inclusion) and clears the marks even if a read throws.
let under = null;
let states = [];
let headline = {};
const cycled = [];
try {
  // --- per-state sales/profit from the map's underlying data ---------------
  // helpers.readUnderlyingData pages the underlying reader and compares the
  // rows read to the reader's authoritative totalRowCount.
  under = await helpers.readUnderlyingData(MAP, { maxRows: 200000 });
  const perState = new Map();
  for (const r of under.rows || []) {
    const name = r["State/Province"];
    if (!name) continue;
    const cur = perState.get(name) || { name, sales: 0, profit: 0 };
    cur.sales += num(r["Sales"]);
    cur.profit += num(r["Profit"]);
    perState.set(name, cur);
  }
  states = [...perState.values()]
    .map((s) => ({
      name: s.name,
      sales: s.sales,
      profit: s.profit,
      ratio: s.sales ? s.profit / s.sales : 0,
    }))
    .sort((a, b) => b.sales - a.sales);

  // --- company headline BEFORE any selection mutates the KPI card ----------
  // Reading it first (no selection) makes it the full-company figure. Reading
  // it after the showcase would return whichever state was last selected.
  const kpiData2 = await helpers.readVizData(KPI, { maxRows: 200 });
  for (const r of kpiData2.rows || []) {
    const mn = r["Measure Names"];
    const mv = r["Measure Values"];
    if (mn !== undefined && mv !== undefined) {
      headline[String(mn)] = num(mv);
    }
  }

  // --- VISIBLE showcase: click through a curated set of states on the map --
  const showcase = [...states.slice(0, 4), ...states.slice(-4)]; // top/bottom by sales
  for (const s of showcase) {
    try {
      await helpers.selectMarks(MAP, [{ fieldName: "State/Province", value: [s.name] }], "select-replace");
      const kpiData = await helpers.readVizData(KPI, { maxRows: 200 });
      const kpi = {};
      for (const r of kpiData.rows || []) {
        const mn = r["Measure Names"];
        if (mn !== undefined && r["Measure Values"] !== undefined) kpi[String(mn)] = num(r["Measure Values"]);
      }
      cycled.push({ name: s.name, sales: s.sales, profit: s.profit, kpi });
    } catch {
      // a single selection failure shouldn't stop the showcase
    }
  }
} finally {
  // clear the marks (default state) — independent of the slider restore
  await cleanupStep("clear map selection", async () => {
    const wb = await workbook;
    const mapWs = wb.activeSheet.worksheets.find((w) => w.name === MAP);
    if (mapWs && mapWs.clearSelectedMarksAsync) {
      await mapWs.clearSelectedMarksAsync();
    }
  });
  // restore the Profit Ratio slider to its original applied range + null mode
  if (originalRatioRange) {
    await cleanupStep("restore Profit Ratio slider", () =>
      helpers.applyRangeFilter(MAP, "AGG(Profit Ratio)", {
        ...originalRatioRange,
        ...(originalNullOption ? { nullOption: originalNullOption } : {}),
      })
    );
  }
}

// --- reconcile the per-state totals against the headline -------------------
// Raw currency tolerance 0.01 (the approved same-scope check). If the state
// totals don't add up to the headline, the read missed rows (or the slider
// stayed clipped) — never present the ranking as complete.
const readComplete = under ? under.complete !== false : false;
const stateSalesTotal = states.reduce((a, s) => a + s.sales, 0);
const stateProfitTotal = states.reduce((a, s) => a + s.profit, 0);
const salesKey = Object.keys(headline).find((k) => /sum:Sales:/i.test(k));
const profitKey = Object.keys(headline).find((k) => /sum:Profit:/i.test(k));
const headlineSales = salesKey !== undefined ? num(headline[salesKey]) : null;
const headlineProfit = profitKey !== undefined ? num(headline[profitKey]) : null;
const close = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 0.01;
const reconciles = close(stateSalesTotal, headlineSales) && close(stateProfitTotal, headlineProfit);

const complete = readComplete && sliderWidened && reconciles && cleanupErrors.length === 0;
const reasons = [];
if (!readComplete) reasons.push(`underlying read incomplete (${under?.rowCount ?? "?"} of ${under?.totalRowCount ?? "?"} rows)`);
if (!sliderWidened) reasons.push("Profit Ratio slider could not be widened — low-margin states may be clipped");
if (!reconciles) reasons.push(`state totals do not reconcile to headline (sales ${stateSalesTotal.toFixed(2)} vs ${headlineSales}, profit ${stateProfitTotal.toFixed(2)} vs ${headlineProfit})`);
if (cleanupErrors.length) reasons.push(`cleanup incomplete: ${cleanupErrors.join("; ")}`);

return {
  headline,
  states,
  totalStates: states.length,
  complete,
  note: complete ? undefined : reasons.join("; "),
  reconciliation: {
    stateSalesTotal,
    headlineSales,
    reconciles,
    stateProfitTotal,
    headlineProfit,
    rowCount: under?.rowCount,
    totalRowCount: under?.totalRowCount,
  },
  cleanup: cleanupErrors,
  scope,
  cycled: cycled.map((c) => c.name),
};
