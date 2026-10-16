// overview-state-ranking — Superstore Overview: rank every US state and
// Canadian province by Profit Ratio and by Sales, with the headline KPIs.
//
// VISIBLE showcase: widens the Profit Ratio slider (every state appears) and
// visibly clicks through a curated set of states on the Sale Map — each
// selection narrows the KPI cards / segment / product charts, then the
// selection is cleared. The full per-state ranking is read from the map's
// underlying data via the paged reader, then reconciled to the headline.
//
// Returns: { headline, states: [{ name, sales, profit, ratio }], totalStates,
//            complete, note, reconciliation, cycled: [state names driven visibly] }

const MAP = "Sale Map";
const KPI = "Total Sales";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// --- widen the Profit Ratio slider so the low tail isn't clipped -----------
// A failed widening leaves the map (and its underlying rows) clipped, so the
// ranking is not a complete picture — record that instead of hiding it.
let originalRatioRange = null;
let sliderWidened = false;
try {
  const d = await helpers.describeFilter("AGG(Profit Ratio)", { worksheet: MAP });
  if (d && d.filterType === "range" && d.domain && d.domain.min !== undefined && d.domain.max !== undefined) {
    originalRatioRange = { min: num(d.minValue), max: num(d.maxValue) };
    await helpers.applyRangeFilter(MAP, "AGG(Profit Ratio)", {
      min: Number(d.domain.min),
      max: Number(d.domain.max),
    });
    sliderWidened = true;
  }
} catch {
  // leave sliderWidened = false — the ranking may be clipped
}

// Everything below mutates the viz (slider, marks); the finally restores the
// slider range and clears the marks even if a read or the showcase throws.
let under = null;
let states = [];
let headline = {};
const cycled = [];
try {
  // --- per-state sales/profit from the map's underlying data ---------------
  // helpers.readUnderlyingData pages the underlying reader (no arbitrary cap);
  // `under.complete` is trustworthy and drives the completeness flag below.
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

  // --- headline KPIs from the Total Sales card -----------------------------
  const kpiData2 = await helpers.readVizData(KPI, { maxRows: 200 });
  for (const r of kpiData2.rows || []) {
    const mn = r["Measure Names"];
    const mv = r["Measure Values"];
    if (mn !== undefined && mv !== undefined) {
      headline[String(mn)] = num(mv);
    }
  }
} finally {
  // clear the marks (default state)
  try {
    const wb = await workbook;
    const mapWs = wb.activeSheet.worksheets.find((w) => w.name === MAP);
    if (mapWs && mapWs.clearSelectedMarksAsync) {
      await mapWs.clearSelectedMarksAsync();
    }
  } catch {
    // best-effort cleanup
  }
  // restore the Profit Ratio slider to its original applied range
  if (originalRatioRange) {
    try {
      await helpers.applyRangeFilter(MAP, "AGG(Profit Ratio)", originalRatioRange);
    } catch {
      // best-effort cleanup
    }
  }
}

// --- reconcile the per-state total against the headline --------------------
// If the state sales don't add up to the headline Sales, the read missed rows
// (or the slider stayed clipped) — never present the ranking as complete.
const readComplete = under ? under.complete !== false : false;
const stateSalesTotal = states.reduce((a, s) => a + s.sales, 0);
const salesKey = Object.keys(headline).find((k) => /sum:Sales:/i.test(k));
const headlineSales = salesKey ? num(headline[salesKey]) : 0;
const reconciles =
  !headlineSales || Math.abs(stateSalesTotal - headlineSales) / headlineSales < 0.01;

const complete = readComplete && sliderWidened && reconciles;
const reasons = [];
if (!readComplete) reasons.push(`underlying read incomplete (${under?.rowCount ?? "?"} of ${under?.totalRowCount ?? "?"} rows)`);
if (!sliderWidened) reasons.push("Profit Ratio slider could not be widened — low-margin states may be clipped");
if (!reconciles) reasons.push(`state sales ${stateSalesTotal.toFixed(0)} do not reconcile to headline ${headlineSales.toFixed(0)}`);

return {
  headline,
  states,
  totalStates: states.length,
  complete,
  note: complete ? undefined : reasons.join("; "),
  reconciliation: { stateSalesTotal, headlineSales, reconciles, rowCount: under?.rowCount, totalRowCount: under?.totalRowCount },
  cycled: cycled.map((c) => c.name),
};
