// overview-state-ranking — Superstore Overview: top/bottom states by Profit
// Ratio and by Sales, plus the company headline KPIs.
//
// The Sale Map's marks carry only AGG(Profit Ratio) (the color) — per-state
// sales and profit live behind mark selection in the KPI cards. Rather than
// loop ~59 states with selectMarks, we read the map's UNDERLYING data (which
// has State/Province, Profit, Sales) and aggregate in-page.
//
// Gotchas handled: the Profit Ratio legend slider defaults to clipping the
// lowest-margin states (applied min ~-0.22 vs domain floor ~-0.33), so we widen
// it to the full domain before reading, then restore it.
//
// Returns: { headline, topByRatio, bottomByRatio, topBySales, totalStates }
// where headline is the KPI-card (Total Sales) measure map and each state
// entry is { name, sales, profit, ratio }.

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

// --- per-state sales/profit from underlying data ---------------------------
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
const states = [...perState.values()].map((s) => ({
  name: s.name,
  sales: s.sales,
  profit: s.profit,
  ratio: s.sales ? s.profit / s.sales : 0,
}));

// --- restore the Profit Ratio slider to its original applied range ---------
if (originalRatioRange) {
  await helpers.applyRangeFilter(MAP, "AGG(Profit Ratio)", originalRatioRange);
}

const fmt = (s) => ({ name: s.name, sales: s.sales, profit: s.profit, ratio: +s.ratio.toFixed(4) });

const byRatio = [...states].sort((a, b) => b.ratio - a.ratio);
const bySales = [...states].sort((a, b) => b.sales - a.sales);

// --- headline KPIs from the Total Sales card -------------------------------
const kpiData = await helpers.readVizData(KPI, { maxRows: 200 });
const headline = {};
for (const r of kpiData.rows || []) {
  const mn = r["Measure Names"];
  const mv = r["Measure Values"];
  if (mn !== undefined && mv !== undefined) {
    headline[String(mn)] = num(mv);
  }
}

return {
  headline,
  topByRatio: byRatio.slice(0, 5).map(fmt),
  bottomByRatio: byRatio.slice(-5).reverse().map(fmt),
  topBySales: bySales.slice(0, 5).map(fmt),
  totalStates: states.length,
};