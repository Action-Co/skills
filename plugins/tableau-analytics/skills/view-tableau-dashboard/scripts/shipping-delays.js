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
// The demo owns the Ship Mode filter and the YEAR/QUARTER/Ship Status filters
// it widens to full history; the captured prior state of each is restored in
// the finally (each independently), and a failed cleanup is reported rather
// than hidden.
//
// Returns: { modes: [{ shipMode, orderId, product, actualDays, shipStatus, delay }],
//            complete, note, cleanup }

const TREND_WS = "ShippingTrend"; // hosts YEAR/QUARTER/Ship Mode filters
const DETAIL_WS = "DaystoShip";
const OWNED_TIME_FIELDS = ["YEAR(Order Date)", "QUARTER(Order Date)", "Ship Status"];

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

const cleanupErrors = [];
const cleanupStep = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    cleanupErrors.push(label + ": " + (e && e.message ? e.message : String(e)));
  }
};

// --- capture the owned time/status filters BEFORE mutating ------------------
// The time filters exist per-worksheet (DaystoShip/ShipSummary can default to
// the latest year even when ShippingTrend is all-selected), so capture every
// categorical time/status filter on every worksheet that carries it. If the
// capture fails we do NOT widen (a blanket reset would not be a faithful
// restore) — we report it and leave the state untouched.
let captured = [];
try {
  const filters = await helpers.getFilters();
  captured = filters
    .filter(
      (f) =>
        f.filterType === "categorical" &&
        OWNED_TIME_FIELDS.includes(f.fieldName) &&
        f.isAllSelected === false
    )
    .map((f) => ({
      worksheet: f.worksheet,
      fieldName: f.fieldName,
      appliedValues: (f.appliedValues ?? []).map((v) =>
        v && typeof v === "object" ? v.value : v
      ),
      isExcludeMode: !!f.isExcludeMode,
    }));
} catch (e) {
  cleanupErrors.push("capture time filters: " + (e && e.message ? e.message : String(e)));
}

const domain = await helpers.getDomainValues(TREND_WS, "Ship Mode");
const modes = (domain && domain.values) || ["First Class", "Same Day", "Second Class", "Standard Class"];

const result = [];
try {
  // reset to full history + all statuses so the scan is complete
  for (const f of captured) {
    await cleanupStep("widen " + f.fieldName, () =>
      helpers.applyCategoricalFilter(f.worksheet, f.fieldName, [], "all")
    );
  }

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
} finally {
  // the demo owns the Ship Mode filter — reset it even if a read throws
  await cleanupStep("reset Ship Mode", () =>
    helpers.applyCategoricalFilter(TREND_WS, "Ship Mode", [], "all")
  );
  // restore the captured time/status filters to their exact prior state
  for (const f of captured) {
    await cleanupStep("restore " + f.fieldName, () =>
      helpers.applyCategoricalFilter(f.worksheet, f.fieldName, f.appliedValues, "replace", {
        isExcludeMode: f.isExcludeMode,
      })
    );
  }
}

return {
  modes: result,
  complete: cleanupErrors.length === 0,
  cleanup: cleanupErrors,
  ...(cleanupErrors.length ? { note: `cleanup incomplete: ${cleanupErrors.join("; ")}` } : {}),
};
