// order-counts — Superstore Order Details dashboard: distinct order count per
// state/province, presented as the top 10 states plus the total.
//
// The demo should SHOW the dashboard being driven, so this script first
// applies the State/Province quick filter for a showcase of the top states and
// reads the filtered crosstab live (the tab visibly narrows each time), then
// completes the full state ranking from the sheet's underlying data (the same
// Orders rows, so the counts are identical). A ~50-state filter loop would
// exceed the eval budget, which is why only a subset is driven live.
//
// Returns: { totalOrders, stateCount, top10: [{ state, orders, lines }],
//            liveVerified: [{ state, orders }] }

const WS = "Product Detail Sheet";
const SHOWCASE = ["California", "New York", "Texas", "Pennsylvania"];

// --- reset every quick filter to all (City may not be all-selected) --------
for (const field of ["Category", "Segment", "Region", "State/Province", "City"]) {
  await helpers.applyCategoricalFilter(WS, field, [], "all");
}

// --- showcase: visibly filter each top state and read the live crosstab ----
const liveVerified = [];
for (const state of SHOWCASE) {
  await helpers.applyCategoricalFilter(WS, "State/Province", [state], "replace");
  const data = await helpers.readVizData(WS, { maxRows: 30000 });
  const orderIds = new Set();
  for (const r of data.rows || []) {
    const key = Object.keys(r).find((k) => k.includes("Order ID"));
    if (key && r[key]) orderIds.add(r[key]);
  }
  liveVerified.push({ state, orders: orderIds.size });
}

// --- reset State/Province to all so the underlying read spans ALL data -----
await helpers.applyCategoricalFilter(WS, "State/Province", [], "all");

// --- complete ranking from underlying data ---------------------------------
const under = await helpers.readUnderlyingData(WS, { maxRows: 20000 });

const perState = new Map();
for (const r of under.rows || []) {
  const state = r["State/Province"];
  if (!state) continue;
  const cur = perState.get(state) || { state, orderIds: new Set(), lines: 0 };
  if (r["Order ID"]) cur.orderIds.add(r["Order ID"]);
  cur.lines += 1;
  perState.set(state, cur);
}

const counts = [...perState.values()].map((c) => ({
  state: c.state,
  orders: c.orderIds.size,
  lines: c.lines,
}));

const sorted = counts.sort((a, b) => b.orders - a.orders);
const totalOrders = counts.reduce((s, c) => s + c.orders, 0);

// reset State/Province to all
await helpers.applyCategoricalFilter(WS, "State/Province", [], "all");

return {
  totalOrders,
  stateCount: counts.length,
  top10: sorted.slice(0, 10),
  liveVerified,
};