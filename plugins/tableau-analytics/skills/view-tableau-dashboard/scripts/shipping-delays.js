// shipping-delays — Superstore Shipping dashboard: for each Ship Mode, the
// order line with the greatest shipping delay and its product.
//
// Drives: the Order Year / Order Quarter filters default to the latest quarter,
// so we first reset time to the FULL history; then loop Ship Mode and read the
// DaystoShip order-line table.
//
// The published view exposes SUM(Days to Ship Actual) and the calculated
// Ship Status (Shipped Early / Shipped On Time / Shipped Late) — it does NOT
// render a scheduled-days column. "Greatest delay" is therefore the Shipped
// Late line with the highest Days to Ship Actual (falling back to the highest
// actual days overall if a mode has no late lines).
//
// Returns: [{ shipMode, orderId, product, actualDays, shipStatus, delay }]

const TREND_WS = "ShippingTrend"; // hosts YEAR/QUARTER/Ship Mode filters
const DETAIL_WS = "DaystoShip";

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

// --- reset to full history + all statuses so the scan is complete ----------
// The time filters exist per-worksheet (DaystoShip/ShipSummary can default to
// the latest year even when ShippingTrend is all-selected), so reset every
// categorical time/status filter on every worksheet that carries it.
const timeFilters = await helpers.getFilters();
for (const f of timeFilters) {
  if (
    f.filterType === "categorical" &&
    ["YEAR(Order Date)", "QUARTER(Order Date)", "Ship Status"].includes(f.fieldName) &&
    f.isAllSelected === false
  ) {
    try {
      await helpers.applyCategoricalFilter(f.worksheet, f.fieldName, [], "all");
    } catch {
      // not a real quick filter on that sheet — ignore
    }
  }
}

const domain = await helpers.getDomainValues(TREND_WS, "Ship Mode");
const modes = (domain && domain.values) || ["First Class", "Same Day", "Second Class", "Standard Class"];

const result = [];
for (const mode of modes) {
  await helpers.applyCategoricalFilter(TREND_WS, "Ship Mode", [mode], "replace");
  const data = await helpers.readVizData(DETAIL_WS, { maxRows: 100000 });

  let worstLate = null; // worst line flagged Shipped Late
  let worstAny = null; // worst line by actual days regardless of status
  for (const r of data.rows || []) {
    const actualKey = colOf(r, "Days to Ship Actual");
    const actual = num(actualKey ? r[actualKey] : 0);
    const statusKey = colOf(r, "Ship Status");
    const status = statusKey ? String(r[statusKey]) : null;
    const entry = {
      shipMode: mode,
      orderId: (colOf(r, "Order ID") && r[colOf(r, "Order ID")]) || null,
      product: (colOf(r, "Product Name") && r[colOf(r, "Product Name")]) || null,
      actualDays: actual,
      shipStatus: status,
      delay: actual,
    };
    if (status === "Shipped Late" && (!worstLate || actual > worstLate.actualDays)) {
      worstLate = entry;
    }
    if (!worstAny || actual > worstAny.actualDays) {
      worstAny = entry;
    }
  }
  result.push(worstLate || worstAny);
}

// reset Ship Mode to all
await helpers.applyCategoricalFilter(TREND_WS, "Ship Mode", [], "all");

return result;