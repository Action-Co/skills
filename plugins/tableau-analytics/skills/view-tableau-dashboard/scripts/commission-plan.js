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
// The owned parameters are captured up front and restored (each independently)
// in the finally; a failed restore is reported, not hidden.
//
// Returns: { compByRate: [{ rate, oteAvg, oteTotal, repCount, topEarner }],
//            quotaSweep: [{ quota, clearedCount, totalReps, pctCleared,
//                           topCleared }],
//            complete, note, cleanup }

const BASE_SALARY = 50000;
const QUOTA_DEFAULT = 500000;
const OWNED_PARAMS = ["Commission Rate", "Base Salary", "New Quota"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Strict numeric: null / blank / non-finite stays UNAVAILABLE — never a
// believable 0. Genuine 0 and negative values are finite and preserved.
const numOrNull = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

// --- capture the owned parameters BEFORE mutating --------------------------
let originalParams = null;
try {
  const params = await helpers.getParameters();
  originalParams = {};
  for (const p of params) {
    if (OWNED_PARAMS.includes(p.name)) {
      originalParams[p.name] =
        p.currentValue && typeof p.currentValue === "object"
          ? p.currentValue.value
          : p.currentValue;
    }
  }
} catch (e) {
  cleanupErrors.push("capture parameters: " + (e && e.message ? e.message : String(e)));
}

// --- (a) commission-rate sweep (live parameter driving) --------------------
const compByRate = [];
let lastAchievements = [];
const quotaSweep = [];
try {
for (const rate of [6, 9, 12]) {
  await helpers.setParameter("Commission Rate", rate);
  await helpers.setParameter("Base Salary", BASE_SALARY);
  await helpers.setParameter("New Quota", QUOTA_DEFAULT);

  const proj = await helpers.readVizData("CommissionProjection", { maxRows: 10000 });
  const reps = new Map();
  for (const r of proj.rows || []) {
    const name = r["Sales Person"];
    if (!name) continue;
    // Require the compensation column — a missing column must stay "unavailable",
    // never become a believable $0.
    const totalKey = colOf(r, "Total Compensation");
    if (!totalKey) continue;
    // A present column with a null/blank/invalid value is ALSO unavailable.
    const total = numOrNull(r[totalKey]);
    if (total === null) continue;
    const achKey = colOf(r, "Achievement (estimated)");
    const ach = achKey ? (numOrNull(r[achKey]) ?? 0) : 0;
    // MAX(OTE (Variable)) is per-rep; average across distinct reps so a
    // heterogeneous OTE projection is aggregated correctly (not the first rep's).
    const ote = numOrNull(r["MAX(OTE (Variable))"]);
    const prev = reps.get(name);
    reps.set(name, prev
      ? { total: Math.max(prev.total, total), achievement: Math.max(prev.achievement, ach), ote: prev.ote ?? ote }
      : { total, achievement: ach, ote });
  }
  let topEarner = null;
  for (const [name, v] of reps.entries()) {
    if (!topEarner || v.total > topEarner.total) topEarner = { name, total: v.total };
  }
  const otes = [...reps.values()].map((v) => v.ote).filter((v) => v !== null);
  const oteTotal = otes.length ? otes.reduce((a, b) => a + b, 0) : null;
  compByRate.push({
    rate,
    oteAvg: oteTotal !== null ? oteTotal / otes.length : null,
    oteTotal,
    repCount: reps.size,
    topEarner,
  });
  lastAchievements = [...reps.entries()].map(([name, v]) => ({ name, achievement: v.achievement }));
}

// --- (b) quota sweep — drive the New Quota parameter live ------------------
for (const quota of [400000, 500000, 600000]) {
  await helpers.setParameter("New Quota", quota);
  await helpers.setParameter("Commission Rate", 18.4);
  await helpers.setParameter("Base Salary", BASE_SALARY);

  const qa = await helpers.readVizData("QuotaAttainment", { maxRows: 200 });
  // The worksheet grain is one row per representative; dedupe by name so a
  // duplicate row cannot be counted as a separate person.
  const reps = new Map();
  for (const r of qa.rows || []) {
    const name = r["Sales Person"];
    const pctKey = colOf(r, "% of quota");
    if (!name || !pctKey) continue;
    const attainment = numOrNull(r[pctKey]);
    if (attainment === null) continue;
    const prev = reps.get(name);
    if (prev === undefined || attainment > prev) reps.set(name, attainment);
  }
  const cleared = [...reps.entries()]
    .map(([name, attainment]) => ({ name, attainment }))
    .filter((r) => r.attainment >= 1)
    .sort((a, b) => b.attainment - a.attainment);
  quotaSweep.push({
    quota,
    clearedCount: cleared.length,
    totalReps: reps.size,
    pctCleared: reps.size ? +(cleared.length / reps.size) * 100 : null,
    topCleared: cleared.slice(0, 5),
  });
}

} finally {
  // --- restore the owned parameters, each independently --------------------
  const restore = originalParams ?? {
    "Commission Rate": 18.4,
    "Base Salary": BASE_SALARY,
    "New Quota": QUOTA_DEFAULT,
  };
  for (const name of OWNED_PARAMS) {
    const value = restore[name];
    if (value === undefined || value === null) continue;
    await cleanupStep("restore " + name, () => helpers.setParameter(name, value));
  }
}

return {
  compByRate,
  quotaSweep,
  complete: cleanupErrors.length === 0,
  cleanup: cleanupErrors,
  ...(cleanupErrors.length ? { note: `cleanup incomplete: ${cleanupErrors.join("; ")}` } : {}),
};
