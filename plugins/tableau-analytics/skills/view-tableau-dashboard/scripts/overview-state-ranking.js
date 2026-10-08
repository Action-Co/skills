// overview-state-ranking — Superstore Overview: rank every US state and
// Canadian province by Profit Ratio and by Sales, with the headline KPIs.
//
// VISIBLE showcase: widens the Profit Ratio slider (every state appears) and
// visibly clicks through a curated set of states on the Sale Map — each
// selection narrows the KPI cards / segment / product charts, then the
// selection is cleared. The complete 58-state ranking is then read from the
// map's underlying data (the same rows that render the map).
//
// Returns: { headline, states: [{ name, sales, profit, ratio }], totalStates,
//            cycled: [state names driven visibly] }

const MAP = "Sale Map";
const KPI = "Total Sales";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// --- widen the Profit Ratio slider so the low tail isn't clipped -----------
let originalRatioRange = null;
try {
  const d = await helpers.describeFilter("AGG(Profit Ratio)", { worksheet: MAP });
  if (d && d.filterType === "range" && d.domain && d.domain.min !== undefined && d.domain.max !== undefined) {
    originalRatioRange = { min: num(d.minValue), max: num(d.maxValue) };
    await helpers.applyRangeFilter(MAP, "AGG(Profit Ratio)", {
      min: Number(d.domain.min),
      max: Number(d.domain.max),
    });
  }
} catch {
  // widening is best-effort; ranking still works, worst-margin states may be clipped
}

// --- complete per-state sales/profit from the map's underlying data --------
const under = await helpers.readUnderlyingData(MAP, { maxRows: 20000 });
const perState = new Map();
for (const r of under.rows || []) {
  const name = r["State/Province"];
  if (!name) continue;
  const cur = perState.get(name) || { name, sales: 0, profit: 0 };
  cur.sales += num(r["Sales"]);
  cur.profit += num(r["Profit"]);
  perState.set(name, cur);
}
const states = [...perState.values()]
  .map((s) => ({
    name: s.name,
    sales: s.sales,
    profit: s.profit,
    ratio: s.sales ? s.profit / s.sales : 0,
  }))
  .sort((a, b) => b.sales - a.sales);

// --- VISIBLE showcase: click through a curated set of states on the map ----
const cycled = [];
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
// clear the selection so the viz is left as found
const wb = await workbook;
const dash = wb.activeSheet;
const mapWs = dash.worksheets.find((w) => w.name === MAP);
if (mapWs && mapWs.clearSelectedMarksAsync) {
  await mapWs.clearSelectedMarksAsync();
}

// --- headline KPIs from the Total Sales card -------------------------------
const kpiData2 = await helpers.readVizData(KPI, { maxRows: 200 });
const headline = {};
for (const r of kpiData2.rows || []) {
  const mn = r["Measure Names"];
  const mv = r["Measure Values"];
  if (mn !== undefined && mv !== undefined) {
    headline[String(mn)] = num(mv);
  }
}

// --- restore the Profit Ratio slider to its original applied range ---------
if (originalRatioRange) {
  await helpers.applyRangeFilter(MAP, "AGG(Profit Ratio)", originalRatioRange);
}

return {
  headline,
  states,
  totalStates: states.length,
  cycled: cycled.map((c) => c.name),
};