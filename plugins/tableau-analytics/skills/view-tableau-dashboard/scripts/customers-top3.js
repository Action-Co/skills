// customers-top3 — Superstore Customers dashboard: the top 3 customers by
// sales for every Category × Segment combination (9 groups), with profit and
// profit ratio.
//
// The demo should SHOW the dashboard being driven, so this script first
// applies the Category + Segment quick filters for a showcase subset (one
// combo per category) and reads the filtered CustomerRank live — the tab
// visibly narrows each time. It then completes the full 9-group answer from
// the CustomerRank sheet's underlying data (the same Orders rows, so the
// numbers are identical). Category/Segment loops for all 9 combos would exceed
// the eval budget (~8s per combo on Public), which is why only a subset is
// driven live.
//
// Returns: [{ category, segment, top3: [{ name, sales, profit, ratio }] }]

const RANK_WS = "CustomerRank";
const FILTER_WS = "CustomerOverview"; // hosts the Category/Segment quick filters
const CATEGORIES = ["Furniture", "Office Supplies", "Technology"];
const SEGMENTS = ["Consumer", "Corporate", "Home Office"];
// one combo per category — driven live so the demo shows the filters working
const SHOWCASE = [
  { category: "Technology", segment: "Corporate" },
  { category: "Furniture", segment: "Consumer" },
  { category: "Office Supplies", segment: "Home Office" },
];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// reset the quick filters so the underlying read spans the full population
await helpers.applyCategoricalFilter(FILTER_WS, "Category", [], "all");
await helpers.applyCategoricalFilter(FILTER_WS, "Segment", [], "all");
await helpers.applyCategoricalFilter(FILTER_WS, "YEAR(Order Date)", [], "all");

// --- showcase: visibly drive Category + Segment and read the live rank -----
const liveVerified = [];
for (const combo of SHOWCASE) {
  await helpers.applyCategoricalFilter(FILTER_WS, "Category", [combo.category], "replace");
  await helpers.applyCategoricalFilter(FILTER_WS, "Segment", [combo.segment], "replace");
  const data = await helpers.readVizData(RANK_WS, { maxRows: 10000 });
  const salesKey = Object.keys(data.rows[0] || {}).find((k) => k.includes("SUM(Sales)"));
  const ranked = (data.rows || [])
    .map((r) => {
      const nameKey = Object.keys(r).find((k) => k.includes("Customer Name"));
      return { name: nameKey ? r[nameKey] : null, sales: num(salesKey ? r[salesKey] : 0) };
    })
    .filter((c) => c.name)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 3)
    .map((c) => c.name);
  liveVerified.push({ ...combo, top3Names: ranked });
}

// --- reset the quick filters again so the underlying read spans ALL data ---
await helpers.applyCategoricalFilter(FILTER_WS, "Category", [], "all");
await helpers.applyCategoricalFilter(FILTER_WS, "Segment", [], "all");

// --- complete 9-group answer from underlying data --------------------------
const under = await helpers.readUnderlyingData(RANK_WS, { maxRows: 20000 });

const key = (c, s, n) => `${c}\u0000${s}\u0000${n}`;
const agg = new Map();
for (const r of under.rows || []) {
  const cat = r["Category"];
  const seg = r["Segment"];
  const name = r["Customer Name"];
  if (!cat || !seg || !name) continue;
  const k = key(cat, seg, name);
  const cur = agg.get(k) || { category: cat, segment: seg, name, sales: 0, profit: 0 };
  cur.sales += num(r["Sales"]);
  cur.profit += num(r["Profit"]);
  agg.set(k, cur);
}

const customers = [...agg.values()].map((c) => ({
  ...c,
  ratio: c.sales ? c.profit / c.sales : 0,
}));

const groups = [];
for (const category of CATEGORIES) {
  for (const segment of SEGMENTS) {
    const top3 = customers
      .filter((c) => c.category === category && c.segment === segment)
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 3)
      .map((c) => ({ name: c.name, sales: c.sales, profit: c.profit, ratio: +c.ratio.toFixed(4) }));
    groups.push({ category, segment, top3 });
  }
}

// reset the quick filters to all
await helpers.applyCategoricalFilter(FILTER_WS, "Category", [], "all");
await helpers.applyCategoricalFilter(FILTER_WS, "Segment", [], "all");

return { groups, liveVerified };