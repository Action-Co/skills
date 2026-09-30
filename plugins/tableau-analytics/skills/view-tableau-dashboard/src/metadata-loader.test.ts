/**
 * metadata-loader.test.ts — scope selection, call planning, progress
 * accounting, and the loader's progressive cache against fake handles.
 */

import { expect, test } from "bun:test";
import {
  buildScopeList,
  computeProgress,
  createMetadataLoader,
  planCalls,
  type WorksheetHandle,
} from "./client/metadata-loader.ts";

function handle(name: string): WorksheetHandle {
  return {
    name,
    getSummaryColumnsInfoAsync: async () => [
      { fieldName: "Region", fieldId: "r", dataType: "string", index: 0, isReferenced: true },
    ],
    getVisualSpecificationAsync: async () => ({
      rowFields: [{ fieldName: "Region" }],
      columnFields: [],
      marksSpecifications: [],
    }),
  };
}

test("planCalls produces columns+visualSpec per worksheet in order", () => {
  const calls = planCalls(["A", "B"]);
  expect(calls).toEqual([
    { worksheet: "A", kind: "columns" },
    { worksheet: "A", kind: "visualSpec" },
    { worksheet: "B", kind: "columns" },
    { worksheet: "B", kind: "visualSpec" },
  ]);
});

test("buildScopeList caps dashboard worksheets and handles worksheet sheets", () => {
  const many = Array.from({ length: 12 }, (_, i) => handle(`W${i}`));
  const dashboard = { sheetType: "dashboard", worksheets: many };
  expect(buildScopeList(dashboard, 8)).toHaveLength(8);

  const single = { sheetType: "worksheet", worksheets: [handle("Solo")] };
  expect(buildScopeList(single, 8).map((w) => w.name)).toEqual(["Solo"]);

  expect(buildScopeList({ sheetType: "story", worksheets: [] }, 8)).toEqual([]);
});

test("computeProgress counts landed worksheets", () => {
  const startedAt = Date.now() - 500;
  const p = computeProgress({
    completedCalls: 3,
    totalCalls: 4,
    totalWorksheets: 2,
    landed: new Set(["A"]),
    startedAt,
  });
  expect(p.completedCalls).toBe(3);
  expect(p.totalCalls).toBe(4);
  expect(p.completedWorksheets).toBe(1);
  expect(p.totalWorksheets).toBe(2);
  expect(p.elapsedMs).toBeGreaterThanOrEqual(500);
});

test("loader fills all worksheets and reaches loaded", async () => {
  const progress: unknown[] = [];
  const errors: string[][] = [];
  const loader = createMetadataLoader({
    getScope: () => [handle("A"), handle("B")],
    onProgress: (state, p, e) => {
      progress.push({ state, progress: p });
      errors.push([...e]);
    },
  });

  await loader.ready();
  expect(loader.state).toBe("loaded");
  expect(Object.keys(loader.worksheets)).toEqual(["A", "B"]);
  expect(loader.worksheets["A"]?.columns).toHaveLength(1);
  expect(loader.worksheets["A"]?.visualSpec).toMatchObject({ rowFields: [{ fieldName: "Region" }] });
  expect(loader.worksheets["A"]?.dataSources).toBeNull();

  // Progress ended at totalCalls = 4, both worksheets landed.
  const last = progress[progress.length - 1] as { progress: { completedCalls: number; completedWorksheets: number; totalWorksheets: number } };
  expect(last.progress.completedCalls).toBe(4);
  expect(last.progress.completedWorksheets).toBe(2);
  expect(last.progress.totalWorksheets).toBe(2);
});

test("loader reaches partial when a call fails, and reports errors", async () => {
  const bad: WorksheetHandle = {
    name: "Bad",
    getSummaryColumnsInfoAsync: async () => {
      throw new Error("boom");
    },
    getVisualSpecificationAsync: async () => ({ ok: true }),
  };
  const errors: string[][] = [];
  const loader = createMetadataLoader({
    getScope: () => [bad],
    onProgress: (state, p, e) => errors.push([...e]),
  });

  await loader.ready();
  expect(loader.state).toBe("partial");
  expect(errors.flat().some((e) => e.includes("boom"))).toBe(true);
});

test("ready(worksheetName) resolves when a specific worksheet lands, before fill end", async () => {
  const slow: WorksheetHandle = {
    name: "Slow",
    getSummaryColumnsInfoAsync: async () => {
      await Bun.sleep(30);
      return [{ fieldName: "X" }];
    },
    getVisualSpecificationAsync: async () => ({ ok: true }),
  };
  const loader = createMetadataLoader({
    getScope: () => [slow, handle("Fast")],
    onProgress: () => {},
  });

  // Ready for the fast worksheet resolves quickly; the whole fill is still running.
  await loader.ready("Fast");
  expect(loader.worksheets["Fast"]).toBeDefined();
  expect(loader.state).toBe("loading");
  await loader.ready();
  expect(loader.state).toBe("loaded");
});

test("load() fetches a worksheet outside the auto scope cap", async () => {
  const all = Array.from({ length: 10 }, (_, i) => handle(`W${i}`));
  const loader = createMetadataLoader({
    getScope: () => all,
    maxWorksheets: 2, // auto scope capped at 2
    onProgress: () => {},
  });

  await loader.ready();
  expect(Object.keys(loader.worksheets)).toEqual(["W0", "W1"]);

  await loader.load("W9");
  expect(loader.worksheets["W9"]?.columns).toBeDefined();
});