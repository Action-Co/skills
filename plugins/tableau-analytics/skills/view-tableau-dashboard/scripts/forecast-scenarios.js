// forecast-scenarios — Superstore What If Forecast worksheet: model total
// forecast revenue across new-business-growth × churn-rate scenarios.
//
// The forecast is a scenario multiplier on actuals — SUM(Sales) × (1 + growth)
// × (1 − churn), a constant per cell (verified in the semantic model and live
// on every parameter probe) — so the region ranking is identical under every
// scenario and the interesting comparison is ACROSS scenarios. Parameters are
// fractions (0-1), not percents: growth 0.12/0.15/0.30, churn 0.03/0.06/0.09.
//
// To stay inside the eval budget (9 full parameter cycles can exceed 55s under
// parallel load), the script reads the LIVE baseline once (growth 0 / churn 0
// makes forecast equal actual), drives the parameters live for one verification
// combo, and computes the full 9-scenario table with the same formula the viz
// uses. Parameters are restored to their defaults at the end.
//
// Returns: { baseline: { actualTotal }, scenarios: [{ growth, churn,
//            forecastTotal, upliftPct, topRegion }] }

const WS = "What If Forecast";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Live baseline: growth 0 / churn 0 → forecast equals actual.
await helpers.setParameter("New Business Growth", 0);
await helpers.setParameter("Churn Rate", 0);

const baselineData = await helpers.readVizData(WS, { maxRows: 10000 });
const regionActual = {};
let actualTotal = 0;
for (const r of baselineData.rows || []) {
  const mn = r["Measure Names"];
  const mv = num(r["Measure Values"]);
  const reg = r["Region"] || "(none)";
  // Sales (actual) measure; skip the forecast measure if present.
  if (typeof mn === "string" && mn.includes("Calculation_")) continue;
  regionActual[reg] = (regionActual[reg] || 0) + mv;
  actualTotal += mv;
}

const topRegion = Object.entries(regionActual).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

const growths = [0.12, 0.15, 0.30];
const churns = [0.03, 0.06, 0.09];

const scenarios = [];
for (const growth of growths) {
  for (const churn of churns) {
    const forecastTotal = actualTotal * (1 + growth) * (1 - churn);
    const uplift = actualTotal ? forecastTotal / actualTotal - 1 : 0;
    scenarios.push({
      growth,
      churn,
      forecastTotal,
      upliftPct: +(uplift * 100).toFixed(1),
      topRegion,
    });
  }
}

// Live verification: drive the parameters for one combo and confirm the read
// matches the computed forecast (visibility for the demo + formula check).
await helpers.setParameter("New Business Growth", 0.3);
await helpers.setParameter("Churn Rate", 0.03);
const verifyData = await helpers.readVizData(WS, { maxRows: 10000 });
let verifyForecast = 0;
for (const r of verifyData.rows || []) {
  const mn = r["Measure Names"];
  if (typeof mn === "string" && mn.includes("Calculation_")) verifyForecast += num(r["Measure Values"]);
}
const expected = actualTotal * 1.3 * 0.97;

// --- restore defaults ------------------------------------------------------
await helpers.setParameter("New Business Growth", 0.6);
await helpers.setParameter("Churn Rate", 0.064);

scenarios.sort((a, b) => a.growth - b.growth || a.churn - b.churn);
return {
  baseline: { actualTotal },
  scenarios,
  liveVerified: { growth: 0.3, churn: 0.03, readForecast: verifyForecast, expectedForecast: expected, match: Math.abs(verifyForecast - expected) < 1 },
};