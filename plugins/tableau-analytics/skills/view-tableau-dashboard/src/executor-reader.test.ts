/**
 * executor-reader.test.ts — the underlying-data completeness signal (C3).
 *
 * `readUnderlyingData` must judge completeness against the READER's
 * authoritative totalRowCount, not the returned (possibly capped) table's
 * count. A capped read must never report `complete: true`.
 *
 * executor.ts reads `window.__tableauRuntime__` at import time, so shim the
 * minimal runtime before importing it.
 */
import { expect, test } from "bun:test";

const g = globalThis as unknown as Record<string, unknown>;
g.window = {
  Function,
  location: { host: "127.0.0.1:0", search: "" },
  __tableauRuntime__: {
    config: { session: "s", url: "u", token: "t", libUrl: "l" },
    getVizElement: () => null,
    setStatus: () => {},
    notify: () => {},
    agentMessage: () => {},
    on: () => {},
    getState: () => "loading",
    isInteractive: () => false,
  },
};

const { buildHelpers } = await import("./client/executor.ts");

function makeWorksheet(reader: Record<string, unknown>) {
  return {
    name: "Sale Map",
    sheetType: "worksheet",
    worksheets: [],
    getFiltersAsync: async () => [],
    getUnderlyingTablesAsync: async () => [{ id: "t1", caption: "Sale Map" }],
    getUnderlyingTableDataReaderAsync: async () => reader,
  };
}

function makeHelpers(reader: Record<string, unknown>) {
  const ws = makeWorksheet(reader);
  const workbook = {
    name: "wb",
    activeSheet: { name: "Overview", sheetType: "dashboard", worksheets: [ws] },
    publishedSheetsInfo: [],
    getParametersAsync: async () => [],
    changeParameterValueAsync: async () => ({}),
  };
  return buildHelpers(() => ({ workbook }) as never);
}

test("a capped read against a larger reader total is not complete", async () => {
  const released: number[] = [];
  const reader = {
    pageCount: 2,
    totalRowCount: 10186,
    getAllPagesAsync: async () => ({
      name: "t",
      columns: [{ fieldName: "State/Province" }],
      data: [[{ value: "California" }]],
      totalRowCount: 1, // the capped slice's own count
      isTotalRowCountLimited: false, // unreliable flag: still false while capped
    }),
    releaseAsync: async () => {
      released.push(1);
    },
  };
  const helpers = makeHelpers(reader);
  const out = (await helpers.readUnderlyingData("Sale Map", { maxRows: 1 })) as Record<
    string,
    unknown
  >;
  expect(out.complete).toBe(false);
  expect(out.rowCount).toBe(1);
  expect(out.totalRowCount).toBe(10186);
  expect(released.length).toBe(1);
});

test("a full read whose rows match the reader total is complete", async () => {
  const reader = {
    pageCount: 1,
    totalRowCount: 2,
    getAllPagesAsync: async () => ({
      name: "t",
      columns: [{ fieldName: "State/Province" }],
      data: [[{ value: "California" }], [{ value: "Texas" }]],
      totalRowCount: 2,
      isTotalRowCountLimited: false,
    }),
    releaseAsync: async () => {},
  };
  const helpers = makeHelpers(reader);
  const out = (await helpers.readUnderlyingData("Sale Map")) as Record<string, unknown>;
  expect(out.complete).toBe(true);
  expect(out.rowCount).toBe(2);
});

test("zero pages with a positive reader total is incomplete, not empty", async () => {
  const reader = {
    pageCount: 0,
    totalRowCount: 5,
    getAllPagesAsync: async () => {
      throw new Error("should not page a zero-page reader");
    },
    releaseAsync: async () => {},
  };
  const helpers = makeHelpers(reader);
  const out = (await helpers.readUnderlyingData("Sale Map")) as Record<string, unknown>;
  expect(out.complete).toBe(false);
  expect(out.isEmpty).toBe(false);
});

test("zero pages with no rows is empty and complete", async () => {
  const reader = {
    pageCount: 0,
    totalRowCount: 0,
    getAllPagesAsync: async () => {
      throw new Error("should not page a zero-page reader");
    },
    releaseAsync: async () => {},
  };
  const helpers = makeHelpers(reader);
  const out = (await helpers.readUnderlyingData("Sale Map")) as Record<string, unknown>;
  expect(out.complete).toBe(true);
  expect(out.isEmpty).toBe(true);
});
