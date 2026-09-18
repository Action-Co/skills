/**
 * executor.ts — the in-page executor for the session-bridge.
 *
 * Bundled to plain JS by bridge.ts (Bun.build) and served at
 * /client/executor.js. Runs inside embed-tableau.html.
 *
 * Owns:
 *   - the WebSocket connection to the bridge (+ reconnect + hello)
 *   - the viz lifecycle state pushes (connecting/loading/interactive/error)
 *   - the instant snapshot + background metadata loader + scheduled script,
 *     all fired on `firstinteractive`
 *   - the serialized eval loop (one eval at a time, per tab)
 *   - the safe serializer (async, auto-releases readers in the return value)
 *   - the helper library and the `meta` eval scope
 *
 * The embed page (embed-tableau.html) owns the DOM/library/mount/event wiring
 * and exposes itself to this module as `window.__tableauRuntime__`.
 *
 * NOTE ON TYPES: tsconfig ships `lib: ["ESNext"]` (no DOM); the browser
 * globals this file needs are declared ambiently below.
 */

import { buildSnapshot, dataValue } from "./snapshot.ts";
import {
  buildScopeList,
  createMetadataLoader,
  type MetaCache,
  type WorksheetHandle,
} from "./metadata-loader.ts";

// --- Ambient browser surface -------------------------------------------------

type SafeValue =
  | null
  | string
  | number
  | boolean
  | SafeValue[]
  | { [key: string]: SafeValue };

interface VizElement {
  workbook: unknown;
  refreshDataAsync?: () => Promise<void>;
  [key: string]: unknown;
}

interface PageRuntime {
  config: {
    session: string;
    url: string;
    script?: string;
    token: string;
    libUrl: string;
    tableauToken?: string;
  };
  getVizElement: () => VizElement | null;
  setStatus: (kind: string, text: string) => void;
  on: (event: string, fn: (detail: unknown) => void) => void;
  getState: () => "connecting" | "loading" | "interactive" | "error";
  isInteractive: () => boolean;
}

type EvalFactory = (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

declare const window: {
  location: { host: string; search: string };
  Function: EvalFactory;
  close: () => void;
  __tableauRuntime__?: PageRuntime;
} & Record<string, unknown>;
declare const document: {
  getElementById(id: string): unknown;
};
declare function setTimeout(fn: () => void, ms: number): number;
declare function clearTimeout(id: number): void;
declare function fetch(
  url: string,
  init?: { headers?: Record<string, string> }
): Promise<{ status: number; text(): Promise<string> }>;
declare class WebSocket {
  constructor(url: string);
  send(data: string): void;
  close(): void;
  readyState: number;
  addEventListener(
    evt: "open" | "message" | "close" | "error",
    fn: (e: { data?: unknown }) => void
  ): void;
}

const makeEvalFn: EvalFactory = window.Function;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function requireRuntime(): PageRuntime {
  const rt = window.__tableauRuntime__;
  if (!rt) {
    throw new Error("page runtime not initialised (embed-tableau.html)");
  }
  return rt;
}

const runtime = requireRuntime();
const { session, url, script, token } = runtime.config;

// ---------------------------------------------------------------------------
// Safe serializer — the single return contract for every eval.
// ---------------------------------------------------------------------------

const MAX_DEPTH = 6;
const MAX_ARRAY = 5000;

function serializePrimitive(
  value: unknown
): { handled: true; value: SafeValue | undefined } | { handled: false } {
  const t = typeof value;
  if (value === null || value === undefined) {
    return { handled: true, value: null };
  }
  if (t === "string" || t === "number" || t === "boolean") {
    return { handled: true, value: value as SafeValue };
  }
  if (t === "bigint") {
    return { handled: true, value: (value as bigint).toString() };
  }
  if (t === "function" || t === "symbol") {
    return { handled: true, value: undefined };
  }
  if (value instanceof Date) {
    return { handled: true, value: value.toISOString() };
  }
  return { handled: false };
}

// Collect the *public* data keys of a Tableau model object. Model classes store
// data in `private _`-prefixed fields exposed via NON-ENUMERABLE getters, so a
// naive for…in misses them. Walk the prototype chain for accessors; drop `_`
// backing fields whose public getter exists.
function collectKeys(value: object): Set<string> {
  const getters = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(value);
  while (proto && proto !== Object.prototype) {
    for (const [name, desc] of Object.entries(
      Object.getOwnPropertyDescriptors(proto)
    )) {
      if (name !== "constructor" && typeof desc.get === "function") {
        getters.add(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  const keys = new Set(getters);
  const addIfPublic = (name: string): void => {
    if (name.startsWith("_") && getters.has(name.slice(1))) {
      return;
    }
    keys.add(name);
  };
  for (const own of Object.getOwnPropertyNames(value)) {
    addIfPublic(own);
  }
  for (const k in value) {
    addIfPublic(k);
  }
  return keys;
}

function isDataReader(value: object): boolean {
  const record = value as Record<string, unknown>;
  return (
    typeof record.releaseAsync === "function" &&
    typeof record.getPageAsync === "function"
  );
}

async function serializeObject(
  value: object,
  depth: number,
  seen: WeakSet<object>
): Promise<SafeValue> {
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);

  const isReader = isDataReader(value);
  const out: { [key: string]: SafeValue } = {};
  const record = value as Record<string, unknown>;
  try {
    for (const key of collectKeys(value)) {
      let raw: unknown;
      try {
        raw = record[key];
      } catch {
        continue;
      }
      if (typeof raw === "function") {
        continue;
      }
      const serialized = await safeSerialize(raw, depth + 1, seen);
      if (serialized !== undefined) {
        out[key] = serialized;
      }
    }
  } finally {
    if (isReader) {
      // Auto-release a reader found in the return value (best-effort). Readers
      // the agent consumed inside the eval must still be released manually.
      try {
        await (record.releaseAsync as () => Promise<void>)();
      } catch {
        // release failure is non-fatal
      }
    }
  }
  return out;
}

async function safeSerialize(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): Promise<SafeValue | undefined> {
  const primitive = serializePrimitive(value);
  if (primitive.handled) {
    return primitive.value;
  }

  if (depth >= MAX_DEPTH) {
    return "[max depth]";
  }

  if (Array.isArray(value)) {
    const out: SafeValue[] = [];
    for (const v of value.slice(0, MAX_ARRAY)) {
      out.push((await safeSerialize(v, depth + 1, seen)) ?? null);
    }
    if (value.length > MAX_ARRAY) {
      out.push(`[…${value.length - MAX_ARRAY} more]`);
    }
    return out;
  }

  if (typeof value === "object" && value !== null) {
    return serializeObject(value, depth, seen);
  }

  return String(value);
}

// ---------------------------------------------------------------------------
// Helpers (convenience, not a cage — raw API calls always work)
// ---------------------------------------------------------------------------

type FilterUpdateLiteral = "add" | "all" | "remove" | "replace";

interface WorkbookLike {
  name: string;
  activeSheet: SheetLike;
  publishedSheetsInfo: SheetInfoLike[];
  activateSheetAsync: (name: string | number) => Promise<SheetLike>;
  getParametersAsync: () => Promise<ParameterLike[]>;
  changeParameterValueAsync: (name: string, value: unknown) => Promise<unknown>;
}

interface SheetLike {
  name: string;
  sheetType: string;
  worksheets: WorksheetLike[];
  getFiltersAsync: () => Promise<FilterLike[]>;
  objects: Array<Record<string, unknown>>;
}

interface WorksheetLike extends SheetLike {
  getSummaryColumnsInfoAsync: () => Promise<ColumnLike[]>;
  getVisualSpecificationAsync: () => Promise<unknown>;
  getSummaryDataReaderAsync: () => Promise<Record<string, unknown>>;
  getUnderlyingTablesAsync: () => Promise<Array<Record<string, unknown>>>;
  getUnderlyingTableDataAsync: (
    id: string,
    opts?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  getFiltersAsync: () => Promise<FilterLike[]>;
  applyFilterAsync: (
    field: string,
    values: string[],
    updateType: string,
    opts?: Record<string, unknown>
  ) => Promise<unknown>;
  applyRangeFilterAsync: (
    field: string,
    options: Record<string, unknown>
  ) => Promise<unknown>;
  clearFilterAsync: (field: string) => Promise<unknown>;
  selectMarksByValueAsync: (
    criteria: Array<Record<string, unknown>>,
    updateType: string
  ) => Promise<unknown>;
  getSelectedMarksAsync: () => Promise<{ data?: DataTableLike[] }>;
  getDataSourcesAsync: () => Promise<Array<Record<string, unknown>>>;
}

interface SheetInfoLike {
  name: string;
  index: number;
  sheetType: string;
  isActive: boolean;
  isHidden: boolean;
  url: string;
}

interface FilterLike {
  fieldName: string;
  fieldId: string;
  filterType: string;
  worksheetName: string;
  appliedValues?: DataValueLike[];
  isAllSelected?: boolean;
  isExcludeMode?: boolean;
  minValue?: DataValueLike;
  maxValue?: DataValueLike;
  getDomainAsync: (domainType: string) => Promise<{ values: DataValueLike[] }>;
}

interface DataValueLike {
  value: unknown;
  nativeValue: unknown;
  formattedValue: unknown;
  aliasValue: unknown;
  hasAlias: boolean;
}

interface ParameterLike {
  name: string;
  dataType: string;
  currentValue: DataValueLike;
  allowableValues: unknown;
  changeValueAsync: (v: unknown) => Promise<DataValueLike>;
}

interface DataTableLike {
  name: string;
  columns: ColumnLike[];
  data: DataValueLike[][];
  totalRowCount: number;
  isTotalRowCountLimited: boolean;
}

interface ColumnLike {
  fieldName: string;
  fieldId: string;
  dataType: string;
  index: number;
  isReferenced: boolean;
}

function isDashboard(sheet: SheetLike): boolean {
  return sheet.sheetType === "dashboard";
}

function isWorksheet(sheet: SheetLike): boolean {
  return sheet.sheetType === "worksheet";
}

function buildHelpers(getViz: () => VizElement | null) {
  const wb = (): WorkbookLike => {
    const viz = getViz();
    if (!viz) {
      throw new Error(
        "viz not mounted yet — the page is still loading. Retry once the status banner shows the viz is interactive."
      );
    }
    try {
      const w = viz.workbook as WorkbookLike | null;
      if (!w) {
        throw new Error("workbook is null");
      }
      return w;
    } catch {
      throw new Error(
        "viz.workbook not ready — the viz has mounted but is not interactive yet (still loading/authenticating). Run 'tableau-viz wait' and retry."
      );
    }
  };

  const resolveWorksheet = (worksheetName?: string): WorksheetLike => {
    const active = wb().activeSheet;
    if (isDashboard(active)) {
      const sheets = active.worksheets;
      if (!worksheetName) {
        if (sheets.length === 1 && sheets[0]) {
          return sheets[0];
        }
        throw new Error(
          `active sheet is a dashboard with ${sheets.length} worksheets — pass a worksheet name (one of: ${sheets
            .map((w) => w.name)
            .join(", ")})`
        );
      }
      const match = sheets.find((w) => w.name === worksheetName);
      if (!match) {
        throw new Error(
          `worksheet "${worksheetName}" not found on dashboard — available: ${sheets
            .map((w) => w.name)
            .join(", ")}`
        );
      }
      return match;
    }
    if (isWorksheet(active)) {
      if (worksheetName && active.name !== worksheetName) {
        throw new Error(
          `active sheet is worksheet "${active.name}", not "${worksheetName}"`
        );
      }
      return active as WorksheetLike;
    }
    throw new Error(
      `active sheet "${active.name}" is a ${active.sheetType}; no worksheet to operate on`
    );
  };

  const readFilters = async (ws: WorksheetLike): Promise<unknown[]> => {
    const filters = await ws.getFiltersAsync();
    return filters.map((f) => {
      const summary: Record<string, unknown> = {
        worksheet: ws.name,
        fieldName: f.fieldName,
        filterType: f.filterType,
      };
      if (f.filterType === "categorical") {
        summary.appliedValues = (f.appliedValues ?? []).map((v) => dataValue(v));
        summary.isAllSelected = f.isAllSelected ?? false;
      }
      return summary;
    });
  };

  return {
    listSheets(): unknown[] {
      return wb().publishedSheetsInfo.map((s) => ({
        name: s.name,
        index: s.index,
        sheetType: s.sheetType,
        isActive: s.isActive,
        isHidden: s.isHidden,
      }));
    },

    getActiveSheet(): { name: string; sheetType: string } {
      const sheet = wb().activeSheet;
      return { name: sheet.name, sheetType: sheet.sheetType };
    },

    async getFilters(worksheetName?: string): Promise<unknown[]> {
      const active = wb().activeSheet;
      if (worksheetName) {
        return await readFilters(resolveWorksheet(worksheetName));
      }
      if (isDashboard(active)) {
        const out: unknown[] = [];
        for (const ws of active.worksheets) {
          out.push(...(await readFilters(ws)));
        }
        return out;
      }
      if (isWorksheet(active)) {
        return await readFilters(active as WorksheetLike);
      }
      return [];
    },

    async applyCategoricalFilter(
      worksheetName: string,
      fieldName: string,
      values: string[],
      updateType: FilterUpdateLiteral = "replace"
    ): Promise<Record<string, unknown>> {
      const ws = resolveWorksheet(worksheetName);
      await ws.applyFilterAsync(fieldName, values, updateType, {
        isExcludeMode: false,
      });
      const filters = await ws.getFiltersAsync();
      const applied = filters.find(
        (f) => f.fieldName === fieldName && f.filterType === "categorical"
      );
      return {
        fieldName,
        appliedValues: (applied?.appliedValues ?? []).map((v) => dataValue(v)),
        isAllSelected: applied?.isAllSelected ?? null,
      };
    },

    async applyRangeFilter(
      worksheetName: string,
      fieldName: string,
      options: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      const ws = resolveWorksheet(worksheetName);
      await ws.applyRangeFilterAsync(fieldName, options);
      const filters = await ws.getFiltersAsync();
      const applied = filters.find(
        (f) => f.fieldName === fieldName && f.filterType === "range"
      );
      return {
        fieldName,
        minValue: dataValue(applied?.minValue),
        maxValue: dataValue(applied?.maxValue),
      };
    },

    async clearFilter(
      worksheetName: string,
      fieldName: string
    ): Promise<{ cleared: string; remaining: string[] }> {
      const ws = resolveWorksheet(worksheetName);
      await ws.clearFilterAsync(fieldName);
      const remaining = (await ws.getFiltersAsync()).map((f) => f.fieldName);
      return { cleared: fieldName, remaining };
    },

    async getParameters(): Promise<unknown[]> {
      const params = await wb().getParametersAsync();
      return params.map((p) => ({
        name: p.name,
        currentValue: dataValue(p.currentValue),
        dataType: p.dataType,
        allowableValues: p.allowableValues ?? null,
      }));
    },

    async setParameter(
      name: string,
      value: boolean | number | string
    ): Promise<{ name: string; current: unknown }> {
      await wb().changeParameterValueAsync(name, value);
      const params = await wb().getParametersAsync();
      const confirmed = params.find((p) => p.name === name);
      return { name, current: dataValue(confirmed?.currentValue) };
    },

    async readSummary(
      worksheetName: string,
      opts: { maxRows?: number } = {}
    ): Promise<Record<string, unknown>> {
      const ws = resolveWorksheet(worksheetName);
      const maxRows = opts.maxRows ?? 10_000;
      const reader = (await ws.getSummaryDataReaderAsync()) as Record<
        string,
        unknown
      > & {
        pageCount: number;
        getAllPagesAsync: (n: number) => Promise<DataTableLike>;
        releaseAsync: () => Promise<void>;
      };
      try {
        // A worksheet with no rows under the current filter state yields a
        // reader with pageCount === 0; paging it throws
        // "invalid-parameter: 0 is invalid value for range: [0..0)". Treat
        // zero rows as empty data, never an error.
        if (!reader.pageCount) {
          return {
            columns: [],
            totalRowCount: 0,
            isTotalRowCountLimited: false,
            rows: [],
          };
        }
        const table = await reader.getAllPagesAsync(maxRows);
        return {
          columns: table.columns.map((c) => c.fieldName),
          totalRowCount: table.totalRowCount,
          isTotalRowCountLimited: table.isTotalRowCountLimited ?? false,
          rows: table.data.map((row) => row.map((cell) => dataValue(cell))),
        };
      } finally {
        await reader.releaseAsync();
      }
    },

    // --- v2 additions -------------------------------------------------------
    async getDomainValues(
      worksheetName: string,
      fieldName: string,
      domainType = "relevant"
    ): Promise<Record<string, unknown>> {
      const ws = resolveWorksheet(worksheetName);
      const filters = await ws.getFiltersAsync();
      const f = filters.find(
        (x) => x.fieldName === fieldName && x.filterType === "categorical"
      );
      if (!f) {
        throw new Error(
          `no categorical filter on field "${fieldName}" in worksheet "${ws.name}"`
        );
      }
      const domain = await f.getDomainAsync(domainType);
      return {
        fieldName,
        domainType,
        values: domain.values.map((v) => dataValue(v)),
      };
    },

    async getVisualSpec(
      worksheetName: string
    ): Promise<unknown> {
      const ws = resolveWorksheet(worksheetName);
      return await ws.getVisualSpecificationAsync();
    },

    async getDataSources(
      worksheetName: string
    ): Promise<Record<string, unknown>[]> {
      const ws = resolveWorksheet(worksheetName);
      const dss = await ws.getDataSourcesAsync();
      return dss.map((ds) => ({
        name: ds.name,
        id: ds.id,
        isExtract: ds.isExtract,
        isPublished: ds.isPublished ?? undefined,
        extractUpdateTime: ds.extractUpdateTime ?? undefined,
        fields: Array.isArray(ds.fields)
          ? ds.fields.map((f: Record<string, unknown>) => ({
              name: f.name,
              role: f.role,
              dataType: f.dataType,
            }))
          : [],
      }));
    },

    async activateSheet(
      name: string
    ): Promise<{ active: string; sheetType: string }> {
      const sheet = await wb().activateSheetAsync(name);
      return { active: sheet.name, sheetType: sheet.sheetType };
    },

    async selectMarks(
      worksheetName: string,
      criteria: Array<Record<string, unknown>>,
      updateType = "select-replace"
    ): Promise<Record<string, unknown>[]> {
      const ws = resolveWorksheet(worksheetName);
      await ws.selectMarksByValueAsync(criteria, updateType);
      const marks = await ws.getSelectedMarksAsync();
      const tables = marks?.data ?? [];
      return tables.map((t) => ({
        name: t.name,
        totalRowCount: t.totalRowCount,
        columns: t.columns.map((c) => c.fieldName),
      }));
    },

    async readUnderlying(
      worksheetName: string,
      opts: { maxRows?: number; tableIndex?: number } = {}
    ): Promise<Record<string, unknown>> {
      const ws = resolveWorksheet(worksheetName);
      const maxRows = opts.maxRows ?? 1000;
      const tables = await ws.getUnderlyingTablesAsync();
      const idx = opts.tableIndex ?? 0;
      const lt = tables[idx];
      if (!lt) {
        throw new Error(
          `no underlying table at index ${idx} — worksheet returned ${tables.length}`
        );
      }
      const table = (await ws.getUnderlyingTableDataAsync(lt.id as string, {
        maxRows,
      })) as unknown as DataTableLike;
      return {
        table: lt.caption ?? lt.id,
        columns: table.columns.map((c) => (c as ColumnLike).fieldName),
        totalRowCount: table.totalRowCount,
        isTotalRowCountLimited: table.isTotalRowCountLimited,
        rows: (table.data as DataValueLike[][]).map((row) =>
          row.map((cell) => dataValue(cell))
        ),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Eval executor (serialized per tab)
// ---------------------------------------------------------------------------

const EVAL_TIMEOUT_MS = 55_000;
const metaRef: { current: MetaCache | null } = { current: null };
let scheduledScriptJs: string | null = null;
let lastSnapshot: unknown;
let lastScriptResult: unknown;

function getViz(): VizElement | null {
  return runtime.getVizElement();
}

async function runEval(js: string): Promise<SafeValue | undefined> {
  const viz = getViz();
  if (!viz) {
    throw new Error(
      "viz not mounted yet — the page is still loading/authenticating. Retry once the status banner shows the viz is interactive."
    );
  }

  const getWorkbook = (): WorkbookLike => {
    try {
      const wb = viz.workbook as WorkbookLike | null;
      if (!wb) {
        throw new Error("workbook is null");
      }
      return wb;
    } catch {
      throw new Error(
        "viz.workbook not ready — the viz has mounted but is not interactive yet (still loading/authenticating). Run 'tableau-viz wait' and retry."
      );
    }
  };

  const helpers = buildHelpers(getViz);
  const scope: Record<string, unknown> = {
    viz,
    helpers,
    meta: metaRef.current,
  };
  Object.defineProperty(scope, "workbook", { get: getWorkbook, enumerable: true });
  Object.defineProperty(scope, "activeSheet", {
    get: () => getWorkbook().activeSheet,
    enumerable: true,
  });

  const fn = makeEvalFn(
    "scope",
    `return (async () => { with (scope) { ${js} } })();`
  );

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            `eval exceeded ${EVAL_TIMEOUT_MS}ms and was abandoned (a Tableau async call may not have resolved)`
          )
        ),
      EVAL_TIMEOUT_MS
    );
  });

  const result = await Promise.race([fn(scope), timeout]);
  return await safeSerialize(result);
}

// --- WS connection ----------------------------------------------------------

let ws: WebSocket | null = null;
let closedByUs = false;

function sendToBridge(msg: unknown): void {
  if (ws && ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(msg));
  }
}

function pushState(
  state: "connecting" | "loading" | "interactive" | "error",
  extra: { snapshot?: unknown; error?: string; scriptResult?: unknown } = {}
): void {
  sendToBridge({
    type: "state",
    session,
    state,
    snapshot: extra.snapshot,
    error: extra.error,
    scriptResult: extra.scriptResult,
  });
}

function pushMetadata(
  status: "loading" | "loaded" | "partial",
  progress: unknown,
  errors: string[]
): void {
  sendToBridge({
    type: "metadata",
    session,
    status,
    progress,
    errors,
  });
}

// Debounced metadata progress pushes: at most one per ~250ms, plus a final
// flush on terminal state.
let pendingMetadata: {
  status: "loading" | "loaded" | "partial";
  progress: unknown;
  errors: string[];
} | null = null;
let metadataTimer: number | null = null;

function debouncedMetadata(
  status: "loading" | "loaded" | "partial",
  progress: unknown,
  errors: string[]
): void {
  pendingMetadata = { status, progress, errors };
  if (metadataTimer === null) {
    metadataTimer = setTimeout(() => {
      metadataTimer = null;
      if (pendingMetadata) {
        pushMetadata(
          pendingMetadata.status,
          pendingMetadata.progress,
          pendingMetadata.errors
        );
        if (
          pendingMetadata.status === "loaded" ||
          pendingMetadata.status === "partial"
        ) {
          pendingMetadata = null;
        }
      }
    }, 250);
  }
}

// --- Viz lifecycle integration ---------------------------------------------

async function onFirstInteractive(): Promise<void> {
  // Note: the HTML sets vizState="interactive" before emitting this event, so
  // do NOT gate on runtime.isInteractive() here — that would skip the snapshot.
  // Metadata loader scope = the active dashboard's worksheets.
  let meta: MetaCache | null = null;
  try {
    const workbook = getViz()?.workbook as unknown as {
      activeSheet: { sheetType?: string; worksheets?: WorksheetHandle[] };
    };
    const scopeList = workbook
      ? buildScopeList(workbook.activeSheet, 8)
      : [];
    meta = createMetadataLoader({
      getScope: () => {
        const w = getViz()?.workbook as unknown as {
          activeSheet: { sheetType?: string; worksheets?: WorksheetHandle[] };
        };
        return w ? buildScopeList(w.activeSheet, 8) : [];
      },
      onProgress: (status, progress, errors) =>
        debouncedMetadata(status, progress, errors),
    });
    metaRef.current = meta;
  } catch {
    metaRef.current = null;
  }

  // Auto re-run the cache after the agent calls viz.refreshDataAsync().
  const viz = getViz();
  if (viz && typeof viz.refreshDataAsync === "function") {
    const original = viz.refreshDataAsync.bind(viz);
    viz.refreshDataAsync = async () => {
      await original();
      void metaRef.current?.refresh();
    };
  }

  let snapshot: unknown;
  try {
    const workbook = getViz()?.workbook as Record<string, unknown>;
    const activeSheet = (workbook?.activeSheet ?? {}) as Record<string, unknown>;
    snapshot = await buildSnapshot(
      workbook ?? {},
      activeSheet,
      metaRef.current ?? { state: "loading", progress: null, errors: [] }
    );
  } catch (err) {
    snapshot = {
      error:
        err instanceof Error ? err.message : "snapshot assembly failed",
    };
  }

  let scriptResult: unknown;
  if (scheduledScriptJs !== null) {
    try {
      scriptResult = {
        status: "ok",
        value: (await runEval(scheduledScriptJs)) ?? null,
      };
    } catch (err) {
      scriptResult = {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Cache so a WS reconnect can re-push the full interactive payload.
  lastSnapshot = snapshot;
  lastScriptResult = scriptResult;
  pushState("interactive", { snapshot, scriptResult });
}

runtime.on("mounted", () => {
  pushState("loading");
});
runtime.on("firstinteractive", () => {
  void onFirstInteractive();
});
runtime.on("vizloaderror", (detail: unknown) => {
  const d = (detail ?? {}) as { errorCode?: string; message?: string };
  pushState("error", {
    error: `vizloaderror (${d.errorCode ?? "unknown"}): ${d.message ?? "see page banner"}`,
  });
});
runtime.on("watchdog", (detail: unknown) => {
  pushState("error", { error: String(detail) });
});

// --- Scheduled script fetch (at hello) --------------------------------------

async function fetchScheduledScript(): Promise<void> {
  if (!script) {
    return;
  }
  try {
    const res = await fetch(
      `/scripts/${encodeURIComponent(script)}.js?token=${encodeURIComponent(token)}`
    );
    if (res.status === 200) {
      scheduledScriptJs = await res.text();
    } else {
      scheduledScriptJs = null;
    }
  } catch {
    scheduledScriptJs = null;
  }
}

// --- Message handling -------------------------------------------------------

const evalQueue: Array<{ id: string; js: string }> = [];
let processing = false;

async function processCommand(cmd: { id: string; js: string }): Promise<void> {
  try {
    const value = (await runEval(cmd.js)) ?? null;
    sendToBridge({ type: "result", id: cmd.id, status: "ok", value });
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    sendToBridge({ type: "result", id: cmd.id, status: "error", error: message });
  }
}

async function drainQueue(): Promise<void> {
  if (processing) {
    return;
  }
  processing = true;
  try {
    while (evalQueue.length > 0) {
      const cmd = evalQueue.shift();
      if (cmd) {
        await processCommand(cmd);
      }
    }
  } finally {
    processing = false;
  }
}

function enqueueCommand(id: string, js: string): void {
  evalQueue.push({ id, js });
  void drainQueue();
}

function handleMessage(ev: { data?: unknown }): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(String(ev.data ?? "")) as Record<string, unknown>;
  } catch {
    return;
  }
  switch (msg.type) {
    case "command":
      enqueueCommand(String(msg.id), String(msg.js));
      break;
    case "ping":
      sendToBridge({ type: "pong", ts: Date.now() });
      break;
    case "close":
      // Best-effort; browsers only close script-opened windows.
      window.close();
      break;
    default:
      break;
  }
}

function connect(): void {
  if (closedByUs) {
    return;
  }
  try {
    ws = new WebSocket(
      `ws://${window.location.host}/ws?token=${encodeURIComponent(token)}&client=page`
    );
  } catch {
    setTimeout(connect, 1000);
    return;
  }
  ws.addEventListener("open", () => {
    sendToBridge({
      type: "hello",
      session,
      ts: Date.now(),
      url,
      script,
    });
    void fetchScheduledScript();
    // Re-push the current state so a reconnecting bridge/store stays truthful.
    const state = runtime.getState();
    if (state === "interactive") {
      pushState("interactive", {
        snapshot: lastSnapshot,
        scriptResult: lastScriptResult,
      });
    } else if (state !== "connecting") {
      pushState(state);
    } else {
      pushState("connecting");
    }
  });
  ws.addEventListener("message", handleMessage);
  ws.addEventListener("close", () => {
    ws = null;
    setTimeout(connect, 1000);
  });
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export function startExecutor(): void {
  runtime.setStatus("loading", "🔌 Bridge: connecting…");
  pushState("connecting");
  connect();
}