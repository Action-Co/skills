/**
 * metadata-loader.ts — the background metadata cache (`meta` in eval scope).
 *
 * Two classes of metadata:
 *   - Static (big, per-worksheet, unchanged by interaction): summary columns
 *     and visual specs. Cached in the background.
 *   - Dynamic (filters, parameters, selected marks, active sheet): NEVER
 *     cached — always read live via evals/helpers.
 *
 * Scope: the active dashboard's worksheets, capped (~8). Never the whole
 * workbook. `getDataSourcesAsync()` is deliberately NOT auto-fetched (Tableau's
 * own docs flag it as potentially performance-degrading) — it is
 * agent-initiated only via the `getDataSources` helper.
 *
 * Guardrails: low concurrency (2), ~3s per call, ~12s global budget, so live
 * commands always have server headroom — commands are never blocked. The cache
 * is a plain object, so partially-loaded worksheets are readable immediately.
 *
 * The mapping pieces (planCalls, computeProgress, scope selection) are pure and
 * unit-tested in metadata-loader.test.ts.
 */

export interface WorksheetHandle {
  name: string;
  getSummaryColumnsInfoAsync: () => Promise<unknown>;
  getVisualSpecificationAsync: () => Promise<unknown>;
}

export type LoaderState = "loading" | "loaded" | "partial";

export interface MetaProgress {
  completedCalls: number;
  totalCalls: number;
  completedWorksheets: number;
  totalWorksheets: number;
  elapsedMs: number;
}

export interface WorksheetCache {
  columns: unknown;
  visualSpec: unknown;
  /** Never auto-fetched; call getDataSourcesAsync() directly if needed. */
  dataSources: null;
}

export interface MetaCache {
  state: LoaderState;
  progress: MetaProgress;
  errors: string[];
  worksheets: Record<string, WorksheetCache>;
  ready: (worksheetName?: string) => Promise<void>;
  load: (worksheetName: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export interface LoaderOptions {
  /** Return the current scope (active dashboard's worksheets) at fill time. */
  getScope: () => WorksheetHandle[];
  /** Fired on progress changes; the caller debounces its WS pushes. */
  onProgress: (state: LoaderState, progress: MetaProgress, errors: string[]) => void;
  maxWorksheets?: number;
  concurrency?: number;
  perCallTimeoutMs?: number;
  budgetMs?: number;
}

// --- pure mapping pieces (unit-tested) --------------------------------------

export type CallKind = "columns" | "visualSpec";

export interface LoaderCall {
  worksheet: string;
  kind: CallKind;
}

/** Plan the ordered call list for a set of worksheet names. */
export function planCalls(worksheetNames: string[]): LoaderCall[] {
  const calls: LoaderCall[] = [];
  for (const name of worksheetNames) {
    calls.push({ worksheet: name, kind: "columns" });
    calls.push({ worksheet: name, kind: "visualSpec" });
  }
  return calls;
}

/** Select the auto-fetch scope from the active sheet, capped. */
export function buildScopeList(
  activeSheet: { sheetType?: string; worksheets?: WorksheetHandle[] },
  cap: number
): WorksheetHandle[] {
  if (activeSheet.sheetType === "worksheet" && activeSheet.worksheets?.[0]) {
    return [activeSheet.worksheets[0]];
  }
  const list = activeSheet.sheetType === "dashboard" ? activeSheet.worksheets : [];
  return (list ?? []).slice(0, cap);
}

export function zeroProgress(): MetaProgress {
  return {
    completedCalls: 0,
    totalCalls: 0,
    completedWorksheets: 0,
    totalWorksheets: 0,
    elapsedMs: 0,
  };
}

/** Compute progress from raw counters (pure). */
export function computeProgress(input: {
  completedCalls: number;
  totalCalls: number;
  totalWorksheets: number;
  landed: Set<string>;
  startedAt: number;
}): MetaProgress {
  return {
    completedCalls: input.completedCalls,
    totalCalls: input.totalCalls,
    completedWorksheets: input.landed.size,
    totalWorksheets: input.totalWorksheets,
    elapsedMs: Date.now() - input.startedAt,
  };
}

// --- loader core ------------------------------------------------------------

const DEFAULT_MAX_WORKSHEETS = 8;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_PER_CALL_MS = 3_000;
const DEFAULT_BUDGET_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export function createMetadataLoader(opts: LoaderOptions): MetaCache {
  const maxWorksheets = opts.maxWorksheets ?? DEFAULT_MAX_WORKSHEETS;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const perCallTimeoutMs = opts.perCallTimeoutMs ?? DEFAULT_PER_CALL_MS;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  const worksheets: Record<string, WorksheetCache> = {};
  const errors: string[] = [];
  let state: LoaderState = "loading";
  let progress = zeroProgress();
  let startedAt = 0;
  let totalCalls = 0;
  let completedCalls = 0;
  let running: Promise<void> | null = null;
  const waiters: Array<() => void> = [];

  const notifyWaiters = (): void => {
    // Snapshot-and-drain: a waiter whose condition is not yet met re-queues
    // itself, so draining with `while (length)` would spin forever.
    const drain = waiters.splice(0, waiters.length);
    for (const fn of drain) {
      fn();
    }
  };

  const pushProgress = (): void => {
    opts.onProgress(state, progress, errors);
  };

  const recomputeProgress = (scopeSize: number, landed: Set<string>): void => {
    progress = computeProgress({
      completedCalls,
      totalCalls,
      totalWorksheets: scopeSize,
      landed,
      startedAt,
    });
  };

  const runFill = async (scope: WorksheetHandle[], onComplete?: () => void): Promise<void> => {
    const names = scope.slice(0, maxWorksheets).map((w) => w.name);
    const calls = planCalls(names);
    const landed = new Set<string>();
    totalCalls = calls.length;
    completedCalls = 0;
    state = "loading";
    errors.length = 0;
    startedAt = Date.now();
    recomputeProgress(names.length, landed);
    pushProgress();

    const deadline = Date.now() + budgetMs;
    let index = 0;

    const runOne = async (call: LoaderCall): Promise<void> => {
      const handle = scope.find((w) => w.name === call.worksheet);
      if (!handle) {
        return;
      }
      try {
        const fn =
          call.kind === "columns"
            ? handle.getSummaryColumnsInfoAsync
            : handle.getVisualSpecificationAsync;
        const result = await withTimeout(fn.call(handle), perCallTimeoutMs);
        const entry =
          worksheets[call.worksheet] ?? { columns: null, visualSpec: null, dataSources: null };
        if (call.kind === "columns") {
          entry.columns = result;
        } else {
          entry.visualSpec = result;
        }
        worksheets[call.worksheet] = entry;
        if (entry.columns !== null && entry.visualSpec !== null) {
          landed.add(call.worksheet);
        }
      } catch (err) {
        errors.push(
          `${call.worksheet} ${call.kind}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      completedCalls += 1;
      recomputeProgress(names.length, landed);
      pushProgress();
      // A worksheet just landed (or the fill made progress) — release waiters.
      notifyWaiters();
    };

    const workers = Array.from({ length: concurrency }, async () => {
      while (index < calls.length) {
        if (Date.now() >= deadline) {
          break;
        }
        const call = calls[index];
        index += 1;
        await runOne(call);
      }
    });
    await Promise.all(workers);

    if (completedCalls < totalCalls) {
      state = "partial";
      errors.push(
        `metadata fill ended early: ${totalCalls - completedCalls} of ${totalCalls} calls left (${budgetMs}ms budget)`
      );
    } else {
      state = errors.length > 0 ? "partial" : "loaded";
    }
    recomputeProgress(names.length, landed);
    pushProgress();
    notifyWaiters();
    onComplete?.();
  };

  const loadWorksheet = async (worksheetName: string): Promise<void> => {
    const scope = opts.getScope();
    const handle = scope.find((w) => w.name === worksheetName);
    if (!handle) {
      throw new Error(
        `worksheet "${worksheetName}" not found on the active dashboard — available: ${scope
          .map((w) => w.name)
          .join(", ")}`
      );
    }
    const existing = worksheets[worksheetName];
    if (existing && existing.columns !== null && existing.visualSpec !== null) {
      return;
    }
    const entry = existing ?? { columns: null, visualSpec: null, dataSources: null };
    try {
      entry.columns = await withTimeout(
        handle.getSummaryColumnsInfoAsync(),
        perCallTimeoutMs
      );
    } catch (err) {
      errors.push(`${worksheetName} columns (load): ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      entry.visualSpec = await withTimeout(
        handle.getVisualSpecificationAsync(),
        perCallTimeoutMs
      );
    } catch (err) {
      errors.push(`${worksheetName} visualSpec (load): ${err instanceof Error ? err.message : String(err)}`);
    }
    worksheets[worksheetName] = entry;
    if (errors.length > 0) {
      state = "partial";
    }
    notifyWaiters();
  };

  const meta: MetaCache = {
    state: "loading",
    progress: zeroProgress(),
    errors,
    worksheets,

    ready: (worksheetName?: string): Promise<void> =>
      new Promise<void>((resolve) => {
        const check = (): void => {
          if (worksheetName === undefined) {
            if (state === "loaded" || state === "partial") {
              resolve();
              return;
            }
          } else if (worksheets[worksheetName]) {
            resolve();
            return;
          } else if (state === "loaded" || state === "partial") {
            // Fill finished without this worksheet (out of scope) — resolve so
            // the caller sees its absence rather than hanging.
            resolve();
            return;
          }
          waiters.push(check);
        };
        check();
      }),

    load: (worksheetName: string): Promise<void> =>
      loadWorksheet(worksheetName),

    refresh: (): Promise<void> => {
      if (running) {
        return running;
      }
      running = runFill(opts.getScope(), () => {
        running = null;
      });
      return running;
    },
  };

  // Mirror live closure state onto the plain-object `meta` via getters, so
  // `return meta` reads the current fill state instantly, no round trip.
  Object.defineProperty(meta, "state", {
    get: () => state,
  });
  Object.defineProperty(meta, "progress", {
    get: () => progress,
  });

  // Start the first fill immediately.
  void meta.refresh();

  return meta;
}