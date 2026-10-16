// performance-outliers — Superstore Performance worksheet: for each year
// (2023-2026), the category with the biggest overshoot and the biggest
// shortfall vs target, plus the sharpest single month × segment × category
// outlier cell.
//
// Drives: the worksheet is static except for its two applied filters; we loop
// YEAR(Order Date) and read the actual-vs-target matrix, aggregating the delta
// by category.
//
// Returns: [{ year, biggestOvershoot, biggestShortfall, sharpestUp,
//             sharpestDown, rowsSeen }]
// where each { cat, actual, target, delta } and the sharpest cells add seg/month.

const WS = "Performance";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const colOf = (r, frag) => {
  for (const k of Object.keys(r)) {
    if (k.includes(frag)) return k;
  }
  return null;
};

const years = [2023, 2024, 2025, 2026];

const result = [];
for (const year of years) {
  await helpers.applyCategoricalFilter(WS, "YEAR(Order Date)", [year], "replace");
  const data = await helpers.readVizData(WS, { maxRows: 5000 });
  const rows = data.rows || [];

  const byCat = {};
  let sharpestUp = null;
  let sharpestDown = null;
  for (const r of rows) {
    const catKey = colOf(r, "Category");
    const cat = catKey ? r[catKey] : null;
    if (!cat) continue;

    const salesKey = colOf(r, "SUM(Sales)") && !colOf(r, "SUM(Sales)").includes("Target")
      ? colOf(r, "SUM(Sales)")
      : null;
    // target column: contains "Target", not a minus sign (delta col has '-').
    let targetKey = null;
    let deltaKey = null;
    for (const k of Object.keys(r)) {
      if (k.includes("Target") && !k.includes("-")) targetKey = k;
      if (k.includes("-") && k.includes("Sales")) deltaKey = k;
    }
    const sales = num(salesKey ? r[salesKey] : 0);
    const target = num(targetKey ? r[targetKey] : 0);
    const delta = deltaKey ? num(r[deltaKey]) : sales - target;

    byCat[cat] = byCat[cat] || { cat, actual: 0, target: 0, delta: 0 };
    byCat[cat].actual += sales;
    byCat[cat].target += target;
    byCat[cat].delta += delta;

    const segKey = colOf(r, "Segment");
    const monthKey = colOf(r, "MONTH");
    const cell = {
      cat,
      segment: segKey ? r[segKey] : null,
      month: monthKey ? r[monthKey] : null,
      actual: sales,
      target,
      delta,
    };
    if (!sharpestUp || delta > sharpestUp.delta) sharpestUp = cell;
    if (!sharpestDown || delta < sharpestDown.delta) sharpestDown = cell;
  }

  const cats = Object.values(byCat).sort((a, b) => b.delta - a.delta);
  result.push({
    year,
    biggestOvershoot: cats[0] || null,
    biggestShortfall: cats.length ? cats[cats.length - 1] : null,
    sharpestUp,
    sharpestDown,
    rowsSeen: rows.length,
  });
}

// reset year to all
await helpers.applyCategoricalFilter(WS, "YEAR(Order Date)", [], "all");

return result;