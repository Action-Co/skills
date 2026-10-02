// commission-plan — Superstore Commission Model: two compensation levers.
//
// (a) Commission-rate sweep at 6% / 9% / 12% (base $50k, quota $500k): model
//     on-target earnings (OTE) and the top earner's total compensation.
// (b) New-quota sweep at $400k / $500k / $600k: how many reps clear 100% of
//     quota and who the top attainers are.
//
// Drives: parameter-driven dashboard — setParameter only, never filters.
// Achievement (estimated) is a FIXED per-rep value (their actual
// commissionable sales — it never moves with the parameters), and each read of
// CommissionProjection carries it together with MAX(OTE (Variable)) and
// AGG(Total Compensation) per rep. So we drive the three commission rates
// live, then compute the quota-sweep attainment from the same fixed
// achievements (% of quota = achievement / quota — the exact formula the viz
// uses). This keeps the whole model within the in-page eval budget.
//
// Returns: { compByRate: [{ rate, oteAvg, oteTotal, repCount, topEarner }],
//            quotaSweep: [{ quota, clearedCount, totalReps, pctCleared,
//                           topCleared }] }

const BASE_SALARY = 50000;
const QUOTA_DEFAULT = 500000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// --- (a) commission-rate sweep (live parameter driving) --------------------
const compByRate = [];
let lastAchievements = [];
for (const rate of [6, 9, 12]) {
  await helpers.setParameter("Commission Rate", rate);
  await helpers.setParameter("Base Salary", BASE_SALARY);
  await helpers.setParameter("New Quota", QUOTA_DEFAULT);

  const proj = await helpers.readVizData("CommissionProjection", { maxRows: 10000 });
  const reps = new Map();
  let oteAvg = null;
  for (const r of proj.rows || []) {
    const name = r["Sales Person"];
    if (!name) continue;
    if (oteAvg === null && r["MAX(OTE (Variable))"] !== undefined) {
      oteAvg = num(r["MAX(OTE (Variable))"]);
    }
    const total = num(r["AGG(Total Compensation)"]);
    const ach = num(r["SUM(Achievement (estimated))"]);
    const prev = reps.get(name);
    reps.set(name, prev
      ? { total: Math.max(prev.total, total), achievement: Math.max(prev.achievement, ach) }
      : { total, achievement: ach });
  }
  let topEarner = null;
  for (const [name, v] of reps.entries()) {
    if (!topEarner || v.total > topEarner.total) topEarner = { name, total: v.total };
  }
  compByRate.push({
    rate,
    oteAvg: oteAvg ?? null,
    oteTotal: oteAvg !== null ? oteAvg * reps.size : null,
    repCount: reps.size,
    topEarner,
  });
  lastAchievements = [...reps.entries()].map(([name, v]) => ({ name, achievement: v.achievement }));
}

// --- (b) quota sweep, computed from the fixed achievements -----------------
const quotaSweep = [];
for (const quota of [400000, 500000, 600000]) {
  const reps = lastAchievements.map((r) => ({ name: r.name, achievement: r.achievement, attainment: quota ? r.achievement / quota : 0 }));
  const cleared = reps
    .filter((r) => r.attainment >= 1)
    .sort((a, b) => b.attainment - a.attainment);
  quotaSweep.push({
    quota,
    clearedCount: cleared.length,
    totalReps: reps.length,
    pctCleared: reps.length ? +(cleared.length / reps.length) * 100 : 0,
    topCleared: cleared.slice(0, 5),
  });
}

// --- restore defaults ------------------------------------------------------
await helpers.setParameter("Commission Rate", 18.4);
await helpers.setParameter("Base Salary", BASE_SALARY);
await helpers.setParameter("New Quota", QUOTA_DEFAULT);

return { compByRate, quotaSweep };