/**
 * demo-scripts.test.ts — execute the ACTUAL shipped demo-script bodies with a
 * mock helper scope. These are the eval bodies the workflow runs; TypeScript
 * never sees them, so they need their own runtime regression coverage.
 *
 * The presenter's timezone matters for the Product month grouping (C9), so pin
 * a west-of-UTC zone for the whole file.
 */
process.env.TZ = "America/Los_Angeles";

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

/** Run a shipped script body the way the executor does (async IIFE over scope). */
async function runScript(
  name: string,
  helpers: Record<string, unknown>,
  workbook: unknown = {}
): Promise<Record<string, any>> {
  const src = readFileSync(join(SCRIPT_DIR, `${name}.js`), "utf8");
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "helpers",
    "workbook",
    `return (async () => {\n${src}\n})();`
  ) as (h: unknown, w: unknown) => Promise<Record<string, any>>;
  return await fn(helpers, workbook);
}

// ---------------------------------------------------------------------------
// C1 — Customers must return its collected groups
// ---------------------------------------------------------------------------

test("customers-top3 returns groups and top-3 (no ReferenceError)", async () => {
  const calls: unknown[][] = [];
  const helpers = {
    applyCategoricalFilter: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
    readVizData: async () => ({
      rows: [
        { "Customer Name": "A", "SUM(Sales)": 300, "SUM(Profit)": 30, "Profit Ratio": 0.1 },
        { "Customer Name": "B", "SUM(Sales)": 200, "SUM(Profit)": 20, "Profit Ratio": 0.1 },
        { "Customer Name": "C", "SUM(Sales)": 100, "SUM(Profit)": 10, "Profit Ratio": 0.1 },
        { "Customer Name": "D", "SUM(Sales)": 50, "SUM(Profit)": 5, "Profit Ratio": 0.1 },
      ],
    }),
  };
  const out = await runScript("customers-top3", helpers);
  expect(out.groups.length).toBe(9); // 3 categories × 3 segments
  expect(out.groups[0].top3.map((c: any) => c.name)).toEqual(["A", "B", "C"]);
  expect(out.liveVerified.length).toBe(9);
  expect(out.complete).toBe(true);
  // 3 setup resets (Category/Segment/Year) + 3 cleanup resets, all "all".
  expect(calls.filter((a) => a[3] === "all").length).toBe(6);
});

test("customers-top3 reports a failed cleanup instead of hiding it", async () => {
  let n = 0;
  const helpers = {
    applyCategoricalFilter: async () => {
      n += 1;
      // the third cleanup reset throws
      if (n > 21) throw new Error("boom");
      return {};
    },
    readVizData: async () => ({ rows: [] }),
  };
  const out = await runScript("customers-top3", helpers);
  expect(out.complete).toBe(false);
  expect(out.cleanup.length).toBeGreaterThan(0);
  expect(out.note).toContain("cleanup incomplete");
});

// ---------------------------------------------------------------------------
// C2 — Overview headline is the full company, not the last selected state
// ---------------------------------------------------------------------------

test("overview reads the company headline before selecting any state", async () => {
  const order: string[] = [];
  let selected: string | null = null;
  const rangeCalls: unknown[] = [];
  const helpers = {
    describeFilter: async () => ({
      filterType: "range",
      minValue: 0,
      maxValue: 1,
      nullOption: "allValues",
      domain: { min: -1, max: 1 },
    }),
    applyRangeFilter: async (_ws: string, _f: string, opts: unknown) => {
      rangeCalls.push(opts);
      return {};
    },
    readUnderlyingData: async () => ({
      rows: [
        { "State/Province": "California", Sales: 100, Profit: 10 },
        { "State/Province": "Texas", Sales: 50, Profit: 5 },
      ],
      complete: true,
      rowCount: 2,
      totalRowCount: 2,
    }),
    selectMarks: async (_ws: string, criteria: any[]) => {
      selected = criteria[0].value[0];
      order.push(`select:${selected}`);
      return [];
    },
    readVizData: async () => {
      order.push(selected ? `kpi:${selected}` : "kpi:company");
      const sales = selected ? 100 : 150;
      return {
        rows: [
          { "Measure Names": "[f].[sum:Sales:qk]", "Measure Values": sales },
          { "Measure Names": "[f].[sum:Profit:qk]", "Measure Values": sales / 10 },
        ],
      };
    },
  };
  const workbook = {
    activeSheet: {
      worksheets: [{ name: "Sale Map", clearSelectedMarksAsync: async () => {} }],
    },
  };
  const out = await runScript("overview-state-ranking", helpers, workbook);
  // the FIRST KPI read is the company total (before any selection)
  expect(order[0]).toBe("kpi:company");
  expect(out.headline["[f].[sum:Sales:qk]"]).toBe(150);
  expect(out.reconciliation.reconciles).toBe(true);
  expect(out.complete).toBe(true);
  // slider widened then restored to the original applied range + null option
  expect(rangeCalls[0]).toEqual({ min: -1, max: 1, nullOption: "allValues" });
  expect(rangeCalls[rangeCalls.length - 1]).toEqual({ min: 0, max: 1, nullOption: "allValues" });
});

test("overview reports a failed mark-clear cleanup", async () => {
  const helpers = {
    describeFilter: async () => ({
      filterType: "range",
      minValue: 0,
      maxValue: 1,
      domain: { min: -1, max: 1 },
    }),
    applyRangeFilter: async () => ({}),
    readUnderlyingData: async () => ({
      rows: [{ "State/Province": "California", Sales: 100, Profit: 10 }],
      complete: true,
      rowCount: 1,
      totalRowCount: 1,
    }),
    selectMarks: async () => [],
    readVizData: async () => ({
      rows: [
        { "Measure Names": "[f].[sum:Sales:qk]", "Measure Values": 100 },
        { "Measure Names": "[f].[sum:Profit:qk]", "Measure Values": 10 },
      ],
    }),
  };
  const workbook = {
    activeSheet: {
      worksheets: [
        {
          name: "Sale Map",
          clearSelectedMarksAsync: async () => {
            throw new Error("clear failed");
          },
        },
      ],
    },
  };
  const out = await runScript("overview-state-ranking", helpers, workbook);
  expect(out.complete).toBe(false);
  expect(out.cleanup.some((e: string) => e.includes("clear map selection"))).toBe(true);
});

// ---------------------------------------------------------------------------
// C7 — Shipping restores captured time/status state (not just Ship Mode)
// ---------------------------------------------------------------------------

test("shipping restores the captured time/status filters, independently", async () => {
  const applied: Array<{ ws: string; field: string; values: string[]; type: string }> = [];
  const helpers = {
    getFilters: async () => [
      {
        worksheet: "DaystoShip",
        fieldName: "YEAR(Order Date)",
        filterType: "categorical",
        isAllSelected: false,
        appliedValues: [{ value: "2026" }],
        isExcludeMode: false,
      },
    ],
    getDomainValues: async () => ({ values: ["First Class"] }),
    applyCategoricalFilter: async (ws: string, field: string, values: string[], type: string) => {
      applied.push({ ws, field, values, type });
      return {};
    },
    readVizData: async () => ({
      rows: [
        {
          "Order ID": "o1",
          "Product Name": "p",
          "Days to Ship Actual": 5,
          "Ship Status": "Shipped Late",
        },
      ],
    }),
  };
  const out = await runScript("shipping-delays", helpers);
  // widened Year to All, then restored the captured value on the right sheet
  expect(
    applied.some(
      (a) => a.field === "YEAR(Order Date)" && a.type === "all"
    )
  ).toBe(true);
  expect(
    applied.some(
      (a) =>
        a.field === "YEAR(Order Date)" &&
        a.ws === "DaystoShip" &&
        a.type === "replace" &&
        a.values.length === 1 &&
        a.values[0] === "2026"
    )
  ).toBe(true);
  expect(out.modes.length).toBe(1);
  expect(out.complete).toBe(true);
});

// ---------------------------------------------------------------------------
// C8 — Commission: a present-but-null value is unavailable, never a $0 earner
// ---------------------------------------------------------------------------

test("commission treats a present-but-null compensation as unavailable", async () => {
  const helpers = {
    getParameters: async () => [
      { name: "Commission Rate", currentValue: { value: 18.4 } },
      { name: "Base Salary", currentValue: { value: 50000 } },
      { name: "New Quota", currentValue: { value: 500000 } },
    ],
    setParameter: async () => ({}),
    readVizData: async (ws: string) =>
      ws === "CommissionProjection"
        ? { rows: [{ "Sales Person": "A", "Total Compensation": null, "MAX(OTE (Variable))": null }] }
        : { rows: [{ "Sales Person": "A", "% of quota": null }] },
  };
  const out = await runScript("commission-plan", helpers);
  expect(out.compByRate[0].topEarner).toBeNull();
  expect(out.compByRate[0].repCount).toBe(0);
  expect(out.quotaSweep[0].pctCleared).toBeNull();
  expect(out.quotaSweep[0].totalReps).toBe(0);
});

test("commission preserves a genuine zero and aggregates heterogeneous OTE", async () => {
  const helpers = {
    getParameters: async () => [],
    setParameter: async () => ({}),
    readVizData: async (ws: string) =>
      ws === "CommissionProjection"
        ? {
            rows: [
              { "Sales Person": "A", "Total Compensation": 0, "MAX(OTE (Variable))": 100 },
              { "Sales Person": "B", "Total Compensation": -5, "MAX(OTE (Variable))": 200 },
            ],
          }
        : { rows: [] },
  };
  const out = await runScript("commission-plan", helpers);
  expect(out.compByRate[0].repCount).toBe(2);
  expect(out.compByRate[0].oteAvg).toBe(150);
  expect(out.compByRate[0].oteTotal).toBe(300);
  // the named top earner is A at a real $0 — a genuine value, not a fabricated one
  expect(out.compByRate[0].topEarner).toEqual({ name: "A", total: 0 });
});

// ---------------------------------------------------------------------------
// C9 — Product groups by the source calendar month, not the presenter's zone
// ---------------------------------------------------------------------------

test("product month is source-calendar, not presenter-timezone", async () => {
  const helpers = {
    applyCategoricalFilter: async () => ({}),
    readVizData: async () => ({
      rows: [
        { "MONTH(Order Date)": "2024-03-01T00:00:00Z", Category: "Furniture", "SUM(Sales)": 100 },
        { "MONTH(Order Date)": "2024-02-15T00:00:00Z", Category: "Furniture", "SUM(Sales)": 10 },
      ],
    }),
  };
  const out = await runScript("product-peak-months", helpers);
  const furn = out.regions.Central.Furniture;
  // UTC March 1 must stay March even though it is Feb 29 in America/Los_Angeles
  expect(furn.peak.month).toBe(3);
  expect(furn.peak.sales).toBe(100);
  expect(furn.trough.month).toBe(2);
});

test("product groups a Date value by its UTC month", async () => {
  const helpers = {
    applyCategoricalFilter: async () => ({}),
    readVizData: async () => ({
      rows: [
        { "MONTH(Order Date)": new Date("2024-03-01T00:00:00Z"), Category: "Furniture", "SUM(Sales)": 100 },
      ],
    }),
  };
  const out = await runScript("product-peak-months", helpers);
  expect(out.regions.Central.Furniture.peak.month).toBe(3);
});
