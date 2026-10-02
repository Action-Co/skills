// product-peak-months — Superstore Product dashboard: for each Region, the
// peak and trough sales month per product category (Furniture / Office
// Supplies / Technology). Sales are aggregated across years by calendar month.
//
// Drives: the Region quick filter is the only visible control and cascades to
// both sheets; ProductView already returns one row per Category × Month ×
// Year, so we filter Region, read ProductView, and group by month.
//
// Returns: { regions: { <Region>: { <Category>: { peak, trough } } } } where
// peak/trough are { month, sales }.

const WS = "ProductView";
const REGIONS = ["Central", "East", "South", "West"];
const CATEGORIES = ["Furniture", "Office Supplies", "Technology"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const monthOf = (v) => {
  if (v instanceof Date) return v.getMonth() + 1;
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.getMonth() + 1;
    const m = Number(v);
    return Number.isFinite(m) && m >= 1 && m <= 12 ? m : null;
  }
  const m = Number(v);
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : null;
};

const monthKey = (r) => {
  for (const k of Object.keys(r)) {
    if (k.includes("MONTH") && !k.includes("Measure")) return k;
  }
  return null;
};
const catKey = (r) => {
  for (const k of Object.keys(r)) {
    if ((k.includes("Category") || k === "Product Category") && !k.includes("Measure")) return k;
  }
  return null;
};
const salesVal = (r) => {
  for (const k of Object.keys(r)) {
    if (k.includes("SUM(") && k.includes("Sales")) return num(r[k]);
  }
  return 0;
};

const result = {};
for (const region of REGIONS) {
  await helpers.applyCategoricalFilter(WS, "Region", [region], "replace");
  const data = await helpers.readVizData(WS, { maxRows: 20000 });
  const byCat = {};
  for (const r of data.rows || []) {
    const cat = r[catKey(r)];
    const m = monthOf(r[monthKey(r)]);
    if (!cat || !m) continue;
    byCat[cat] = byCat[cat] || {};
    byCat[cat][m] = (byCat[cat][m] || 0) + salesVal(r);
  }
  const out = {};
  for (const cat of CATEGORIES) {
    const months = byCat[cat] || {};
    let peak = null;
    let trough = null;
    for (const [m, sales] of Object.entries(months)) {
      const mi = Number(m);
      if (!peak || sales > peak.sales) peak = { month: mi, sales };
      if (!trough || sales < trough.sales) trough = { month: mi, sales };
    }
    out[cat] = { peak, trough };
  }
  result[region] = out;
}

// reset Region to all so the viz is left as found
await helpers.applyCategoricalFilter(WS, "Region", [], "all");

return { regions: result };