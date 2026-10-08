// commission-plan — Superstore Commission Model: two compensation levers, both
// driven VISIBLY through the live parameter controls.
//
// (a) Commission-rate sweep at 6% / 9% / 12% (base $50k, quota $500k): drive
//     the Commission Rate parameter and read the per-rep compensation
//     projection live → on-target earnings (OTE) and the top earner.
// (b) New-quota sweep at $400k / $500k / $600k: drive the New Quota parameter
//     and read the QuotaAttainment bars live → how many reps clear 100% of
//     quota and who the top attainers are.
//
// The dashboard is parameter-driven (no filters, no selections), so every
// change is a setParameter and every read is the live recomputed worksheet.
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

const colOf = (r, frag) => {
  for (const k of Object.keys(r)) {
    if (k.includes(frag)) return k;
  }
  return null;
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

// --- (b) quota sweep — drive the New Quota parameter live ------------------
const quotaSweep = [];
for (const quota of [400000, 500000, 600000]) {
  await helpers.setParameter("New Quota", quota);
  await helpers.setParameter("Commission Rate", 18.4);
  await helpers.setParameter("Base Salary", BASE_SALARY);

  const qa = await helpers.readVizData("QuotaAttainment", { maxRows: 200 });
  const reps = [];
  for (const r of qa.rows || []) {
    const name = r["Sales Person"];
    const pctKey = colOf(r, "% of quota");
    if (!name || !pctKey) continue;
    reps.push({ name, attainment: num(r[pctKey]) });
  }
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