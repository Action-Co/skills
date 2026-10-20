// product-peak-months — Superstore Product dashboard: for each Region, the
// peak and trough sales month per product category (Furniture / Office
// Supplies / Technology). Sales are aggregated across years by calendar month.
//
// Drives: the Region quick filter is the only visible control and cascades to
// both sheets; ProductView already returns one row per Category × Month ×
// Year, so we filter Region, read ProductView, and group by month.
//
// Returns: { regions: { <Region>: { <Category>: { peak, trough } } },
//            complete, note, cleanup } where peak/trough are { month, sales }.

const WS = "ProductView";
const REGIONS = ["Central", "East", "South", "West"];
const CATEGORIES = ["Furniture", "Office Supplies", "Technology"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Source-calendar month: read the month component of the source value directly
// instead of `new Date(v).getMonth()` (local time), which shifts a UTC date
// into the previous month for presenters west of UTC.
const monthOf = (v) => {
  if (v instanceof Date) {
    return Number.isFinite(v.getTime()) ? v.getUTCMonth() + 1 : null;
  }
  if (typeof v === "string") {
    const s = v.trim();
    const iso = s.match(/^(\d{4})-(\d{1,2})(?:[-T ]|$)/);
    if (iso) {
      const m = Number(iso[2]);
      return m >= 1 && m <= 12 ? m : null;
    }
    const n = Number(s);
    return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
  }
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 1 && v <= 12 ? v : null;
  }
  return null;
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
const cleanupErrors = [];
const cleanupStep = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    cleanupErrors.push(label + ": " + (e && e.message ? e.message : String(e)));
  }
};
try {
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

} finally {
  // the demo owns the Region filter — reset it even if a read throws
  await cleanupStep("reset Region", () =>
    helpers.applyCategoricalFilter(WS, "Region", [], "all")
  );
}

return {
  regions: result,
  complete: cleanupErrors.length === 0,
  cleanup: cleanupErrors,
  ...(cleanupErrors.length ? { note: `cleanup incomplete: ${cleanupErrors.join("; ")}` } : {}),
};