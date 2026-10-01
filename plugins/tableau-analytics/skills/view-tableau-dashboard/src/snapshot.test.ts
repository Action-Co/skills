/**
 * snapshot.test.ts — instant-snapshot assembly against fake API objects.
 */

import { expect, test } from "bun:test";
import {
  buildSnapshot,
  classifyFilters,
  dataValue,
  mapSheets,
  mapZones,
  normalizeParameterDomain,
  visibleControls,
} from "./client/snapshot.ts";

const fakeSheetInfo = [
  { name: "Overview", index: 0, sheetType: "dashboard", isActive: true, isHidden: false, url: "u1" },
  { name: "Detail", index: 1, sheetType: "worksheet", isActive: false, isHidden: false, url: "u2" },
];

test("mapSheets trims to the snapshot shape", () => {
  const sheets = mapSheets(fakeSheetInfo);
  expect(sheets).toEqual([
    { name: "Overview", index: 0, sheetType: "dashboard", isActive: true, isHidden: false, url: "u1" },
    { name: "Detail", index: 1, sheetType: "worksheet", isActive: false, isHidden: false, url: "u2" },
  ]);
});

test("mapZones maps dashboard objects", () => {
  const zones = mapZones([
    {
      name: "Filter Container",
      type: "text",
      isFloating: false,
      isVisible: true,
      position: { x: 10, y: 20 },
      size: { width: 100, height: 200 },
      worksheet: undefined,
    },
    {
      name: "Open Cases",
      type: "worksheet",
      isFloating: true,
      isVisible: true,
      position: { x: 0, y: 0 },
      size: { width: 500, height: 400 },
      worksheet: { name: "Table - Open Cases" },
    },
  ]);
  expect(zones).toHaveLength(2);
  expect(zones[0]).toMatchObject({ name: "Filter Container", worksheet: undefined });
  expect(zones[1]?.worksheet).toBe("Table - Open Cases");
  expect(zones[1]?.position).toEqual({ x: 0, y: 0 });
});

test("dataValue normalizes a DataValue-like to its .value", () => {
  expect(dataValue({ value: "APAC" })).toBe("APAC");
  expect(dataValue({ value: null })).toBeNull();
  expect(dataValue(null)).toBeNull();
  expect(dataValue(undefined)).toBeNull();
});

function fakeDashboardSheet() {
  const worksheets = [
    {
      name: "Table - Open Cases",
      getFiltersAsync: async () => [
        {
          worksheetName: "Table - Open Cases",
          fieldName: "Region",
          filterType: "categorical",
          appliedValues: [{ value: "APAC" }],
          isAllSelected: false,
        },
      ],
    },
    {
      name: "Open Cases",
      getFiltersAsync: async () => [],
    },
  ];
  return {
    name: "SOC Overview",
    sheetType: "dashboard",
    objects: [
      { name: "Table - Open Cases", type: "worksheet", isFloating: false, isVisible: true, position: { x: 0, y: 0 }, size: { width: 800, height: 400 }, worksheet: worksheets[0] },
    ],
    worksheets,
    getFiltersAsync: async () => [
      { worksheetName: "SOC Overview", fieldName: "Region", filterType: "categorical", appliedValues: [{ value: "APAC" }], isAllSelected: false },
    ],
  };
}

test("buildSnapshot assembles the full instant snapshot", async () => {
  const workbook = {
    name: "SOC Workbook",
    publishedSheetsInfo: fakeSheetInfo,
    getParametersAsync: async () => [
      {
        name: "Compare Region",
        dataType: "string",
        currentValue: { value: "Europe" },
        // Raw ParameterDomainRestriction shape (list members are DataValues —
        // nested deep enough to trip the serializer's depth cap unnormalized).
        allowableValues: {
          type: "list",
          allowableValues: [
            { value: "APAC", formattedValue: "APAC" },
            { value: "Europe", formattedValue: "Europe" },
          ],
        },
      },
    ],
  };
  const activeSheet = fakeDashboardSheet();
  const meta = { state: "loading", progress: { completedCalls: 0, totalCalls: 4 }, errors: [] };

  const snapshot = await buildSnapshot(workbook, activeSheet, meta);

  expect(snapshot.workbook).toEqual({ name: "SOC Workbook" });
  expect(snapshot.sheets).toHaveLength(2);
  expect(snapshot.activeSheet).toEqual({ name: "SOC Overview", sheetType: "dashboard" });
  expect(snapshot.worksheetNames).toEqual(["Table - Open Cases", "Open Cases"]);
  expect(snapshot.zones).toHaveLength(1);
  expect(snapshot.parameters).toEqual([
    {
      name: "Compare Region",
      dataType: "string",
      currentValue: "Europe",
      allowableValues: { type: "list", values: ["APAC", "Europe"] },
    },
  ]);
  expect(snapshot.filters).toHaveLength(1);
  expect(snapshot.filters[0]).toMatchObject({
    worksheet: "SOC Overview",
    fieldName: "Region",
    filterType: "categorical",
    appliedValues: ["APAC"],
    isAllSelected: false,
  });
  expect(snapshot.metadata.status).toBe("loading");
  expect(snapshot.note).toContain("meta");
});

test("buildSnapshot surfaces relative-date period on the filter", async () => {
  const workbook = {
    name: "W",
    publishedSheetsInfo: [],
    getParametersAsync: async () => [],
  };
  const activeSheet = {
    name: "Overview",
    sheetType: "dashboard",
    worksheets: [],
    objects: [],
    getFiltersAsync: async () => [
      {
        worksheetName: "Overview",
        fieldName: "Order Date",
        filterType: "relative-date",
        anchorDate: { value: "2026-09-29T00:00:00Z" },
        periodType: "quarters",
        rangeN: 1,
        rangeType: "last",
      },
    ],
  };
  const snapshot = await buildSnapshot(workbook, activeSheet, {
    state: "loaded",
    progress: null,
    errors: [],
  });
  expect(snapshot.filters).toHaveLength(1);
  expect(snapshot.filters[0]).toMatchObject({
    worksheet: "Overview",
    fieldName: "Order Date",
    filterType: "relative-date",
    anchorDate: "2026-09-29T00:00:00Z",
    periodType: "quarters",
    rangeN: 1,
    rangeType: "last",
  });
});

test("buildSnapshot works when active sheet is a plain worksheet", async () => {
  const workbook = {
    name: "W",
    publishedSheetsInfo: [{ name: "Sheet 1", index: 0, sheetType: "worksheet", isActive: true, isHidden: false, url: "u" }],
    getParametersAsync: async () => [],
  };
  const activeSheet = {
    name: "Sheet 1",
    sheetType: "worksheet",
    getFiltersAsync: async () => [],
  };
  const snapshot = await buildSnapshot(workbook, activeSheet, {
    state: "loaded",
    progress: null,
    errors: [],
  });
  expect(snapshot.activeSheet.sheetType).toBe("worksheet");
  expect(snapshot.zones).toEqual([]);
  expect(snapshot.worksheetNames).toEqual([]);
  expect(snapshot.metadata.status).toBe("loaded");
});

test("buildSnapshot normalizes parameter allowableValues to a flat shape", async () => {
  const workbook = {
    name: "W",
    publishedSheetsInfo: [],
    getParametersAsync: async () => [
      {
        name: "Date Range",
        dataType: "date",
        currentValue: { value: "2026-09-29" },
        allowableValues: {
          type: "range",
          minValue: { value: "2020-01-01" },
          maxValue: { value: "2026-12-31" },
          stepSize: 1,
          dateStepPeriod: "years",
        },
      },
    ],
  };
  const activeSheet = {
    name: "Sheet 1",
    sheetType: "worksheet",
    getFiltersAsync: async () => [],
  };
  const snapshot = await buildSnapshot(workbook, activeSheet, {
    state: "loaded",
    progress: null,
    errors: [],
  });
  expect(snapshot.parameters[0]?.allowableValues).toEqual({
    type: "range",
    min: "2020-01-01",
    max: "2026-12-31",
    stepSize: 1,
    dateStepPeriod: "years",
  });
});

test("normalizeParameterDomain flattens list / range / any domains", () => {
  expect(
    normalizeParameterDomain({
      type: "list",
      allowableValues: [
        { value: "Daily", formattedValue: "Daily" },
        { value: "Historic", formattedValue: "Historic" },
      ],
    })
  ).toEqual({ type: "list", values: ["Daily", "Historic"] });

  expect(
    normalizeParameterDomain({
      type: "range",
      minValue: { value: 0 },
      maxValue: { value: 100 },
      stepSize: 5,
      dateStepPeriod: null,
    })
  ).toEqual({ type: "range", min: 0, max: 100, stepSize: 5, dateStepPeriod: null });

  expect(normalizeParameterDomain({ type: "any" })).toEqual({ type: "any" });
  expect(normalizeParameterDomain(null)).toEqual({ type: "any" });
});

test("classifyFilters splits selection actions from applied filters and explains", () => {
  const filters = [
    { worksheet: "Total Opportunities", fieldName: "Billing Country", filterType: "categorical" },
    { worksheet: "Total Opportunities", fieldName: "Action (Billing Country)", filterType: "categorical" },
    { worksheet: "Total Opportunities", fieldName: "Action (Industry)", filterType: "categorical" },
    { worksheet: "Total Opportunities", fieldName: "Measure Names", filterType: "categorical" },
  ];
  const groups = classifyFilters(filters);
  expect(groups.selectionActions.map((f) => f.fieldName)).toEqual([
    "Action (Billing Country)",
    "Action (Industry)",
  ]);
  expect(groups.applied.map((f) => f.fieldName)).toEqual([
    "Billing Country",
    "Measure Names",
  ]);
  expect(groups.note).toContain("selectMarks");
  expect(groups.note).toContain("Action (");
});

test("visibleControls surfaces quick-filter and parameter-control dashboard objects", () => {
  const zones = [
    { name: "Close Date", type: "quick-filter", worksheet: "Close Date", isFloating: false, isVisible: true, position: { x: 0, y: 0 }, size: { width: 100, height: 40 } },
    { name: "Chart Type", type: "parameter-control", worksheet: undefined, isFloating: false, isVisible: true, position: { x: 0, y: 0 }, size: { width: 100, height: 40 } },
    { name: "Total Opportunities", type: "worksheet", worksheet: "Total Opportunities", isFloating: false, isVisible: true, position: { x: 0, y: 0 }, size: { width: 800, height: 400 } },
  ];
  const vc = visibleControls(zones);
  expect(vc.controls).toEqual([
    { name: "Close Date", type: "quick-filter", worksheet: "Close Date" },
    { name: "Chart Type", type: "parameter-control", worksheet: undefined },
  ]);
  expect(vc.note).toContain("human user");
});