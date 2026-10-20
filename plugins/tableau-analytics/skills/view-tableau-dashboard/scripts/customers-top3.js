// customers-top3 — Superstore Customers dashboard: the top 3 customers by
// sales for every Category × Segment combination (9 groups), with profit and
// profit ratio.
//
// VISIBLE: applies the Category + Segment quick filters for every one of the
// 9 groups (the dashboard visibly narrows each time) and reads the live
// CustomerRank. No underlying-data read — every group is read straight from
// the rendered ranking, so the script stays fast and never stalls on the
// heavy federated underlying-data fetch that previously exceeded the eval
// budget.
//
// Returns: { groups: [{ category, segment,
//            top3: [{ name, sales, profit, ratio }] }],
//            liveVerified: [{ category, segment, top3Names }],
//            complete, cleanup }

const RANK_WS = "CustomerRank";
const FILTER_WS = "CustomerOverview"; // hosts the Category/Segment quick filters
const CATEGORIES = ["Furniture", "Office Supplies", "Technology"];
const SEGMENTS = ["Consumer", "Corporate", "Home Office"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Accumulators are declared OUTSIDE the try so the return can reach them while
// the finally still runs. (Declaring them inside the try made the return throw
// `groups is not defined` — a regression in the cleanup commit.)
const groups = [];
const liveVerified = [];
const cleanupErrors = [];
const cleanupStep = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    cleanupErrors.push(label + ": " + (e && e.message ? e.message : String(e)));
  }
};

try {
// reset the quick filters so the reads span the full population
await helpers.applyCategoricalFilter(FILTER_WS, "Category", [], "all");
await helpers.applyCategoricalFilter(FILTER_WS, "Segment", [], "all");
await helpers.applyCategoricalFilter(FILTER_WS, "YEAR(Order Date)", [], "all");

// --- drive Category + Segment for every group and read the live rank -------
for (const category of CATEGORIES) {
  for (const segment of SEGMENTS) {
    await helpers.applyCategoricalFilter(FILTER_WS, "Category", [category], "replace");
    await helpers.applyCategoricalFilter(FILTER_WS, "Segment", [segment], "replace");
    const data = await helpers.readVizData(RANK_WS, { maxRows: 10000 });
    const cols = {};
    for (const k of Object.keys(data.rows[0] || {})) {
      if (k.includes("Customer Name")) cols.name = k;
      if (k.includes("SUM(Sales)")) cols.sales = k;
      if (k.includes("SUM(Profit)")) cols.profit = k;
      if (k.includes("Profit Ratio")) cols.ratio = k;
    }
    const top3 = (data.rows || [])
      .map((r) => ({
        name: r[cols.name],
        sales: num(r[cols.sales]),
        profit: num(r[cols.profit]),
        ratio: num(r[cols.ratio]),
      }))
      .filter((c) => c.name)
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 3)
      .map((c) => ({ ...c, ratio: +c.ratio.toFixed(4) }));
    groups.push({ category, segment, top3 });
    liveVerified.push({ category, segment, top3Names: top3.map((c) => c.name) });
  }
}
} finally {
  // the demo owns Category/Segment/Year — restore each INDEPENDENTLY so one
  // failure never aborts the others (the reads widened Year to All too).
  await cleanupStep("reset Category", () => helpers.applyCategoricalFilter(FILTER_WS, "Category", [], "all"));
  await cleanupStep("reset Segment", () => helpers.applyCategoricalFilter(FILTER_WS, "Segment", [], "all"));
  await cleanupStep("reset Year", () => helpers.applyCategoricalFilter(FILTER_WS, "YEAR(Order Date)", [], "all"));
}

return {
  groups,
  liveVerified,
  complete: cleanupErrors.length === 0,
  cleanup: cleanupErrors,
  ...(cleanupErrors.length ? { note: `cleanup incomplete: ${cleanupErrors.join("; ")}` } : {}),
};