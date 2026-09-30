/**
 * snapshot.ts — the instant snapshot assembled at `firstinteractive`.
 *
 * Pure module: it only reads getter properties and awaits the two async calls
 * (workbook.getParametersAsync, activeSheet.getFiltersAsync) via the objects it
 * is handed, so it is unit-testable with fake API objects (see snapshot.test.ts).
 * Everything else is synchronous dashboard-object data — no per-worksheet loops.
 *
 * Per-worksheet filters, filter domains, and heavy metadata are deliberately
 * NOT here; they are on demand or cached in the background (meta).
 */

export interface SnapshotSheet {
  name: string;
  index: number;
  sheetType: string;
  isActive: boolean;
  isHidden: boolean;
  url: string;
}

export interface SnapshotZone {
  name: string;
  type: string;
  worksheet?: string;
  isFloating: boolean;
  isVisible: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface SnapshotParameter {
  name: string;
  dataType: string;
  currentValue: unknown;
  allowableValues: unknown;
}

export interface SnapshotFilter {
  worksheet: string;
  fieldName: string;
  filterType: string;
  appliedValues?: unknown[];
  isAllSelected?: boolean;
  // relative-date filters expose their period synchronously — surface it so
  // the agent knows the time window without a live read.
  anchorDate?: unknown;
  periodType?: string;
  rangeN?: number;
  rangeType?: string;
}

export interface Snapshot {
  workbook: { name: string };
  sheets: SnapshotSheet[];
  activeSheet: { name: string; sheetType: string };
  zones: SnapshotZone[];
  worksheetNames: string[];
  parameters: SnapshotParameter[];
  filters: SnapshotFilter[];
  filterGroups: FilterGroups;
  visibleControls: VisibleControls;
  metadata: { status: string; progress: unknown; errors: string[] };
  note: string;
}

// --- pure mappers -----------------------------------------------------------

/** Trim publishedSheetsInfo to the snapshot shape (sync getters only). */
export function mapSheets(publishedSheetsInfo: unknown[]): SnapshotSheet[] {
  return publishedSheetsInfo.map((s) => {
    const sheet = s as Record<string, unknown>;
    return {
      name: String(sheet.name ?? ""),
      index: Number(sheet.index ?? -1),
      sheetType: String(sheet.sheetType ?? ""),
      isActive: Boolean(sheet.isActive),
      isHidden: Boolean(sheet.isHidden),
      url: String(sheet.url ?? ""),
    };
  });
}

/** Map dashboard.objects into zone summaries (sync getters only). */
export function mapZones(objects: unknown[]): SnapshotZone[] {
  return objects.map((o) => {
    const zone = o as Record<string, unknown>;
    const position = (zone.position ?? {}) as Record<string, unknown>;
    const size = (zone.size ?? {}) as Record<string, unknown>;
    const worksheet = zone.worksheet as Record<string, unknown> | undefined;
    return {
      name: String(zone.name ?? ""),
      type: String(zone.type ?? ""),
      worksheet: worksheet ? String(worksheet.name ?? "") : undefined,
      isFloating: Boolean(zone.isFloating),
      isVisible: Boolean(zone.isVisible),
      position: { x: Number(position.x ?? 0), y: Number(position.y ?? 0) },
      size: { width: Number(size.width ?? 0), height: Number(size.height ?? 0) },
    };
  });
}

/** Normalize a DataValue to a primitive (its `.value` public getter). */
export function dataValue(v: unknown): unknown {
  if (!v || typeof v !== "object") {
    return v ?? null;
  }
  const value = (v as Record<string, unknown>).value;
  return value ?? null;
}

// --- filter & control classification (pure, unit-tested) ----------------------

/** A filter as seen by the classifier — only `fieldName` is required. */
export interface FilterLike {
  fieldName: string;
}

export interface FilterGroups {
  note: string;
  selectionActions: FilterLike[];
  applied: FilterLike[];
}

/**
 * Classify dashboard filters into the two groups agents can act on
 * deterministically:
 *   - selectionActions: `Action (...)` filters, driven by mark selection /
 *     mouse clicks on a source chart — apply via selectMarks, never
 *     applyFilterAsync.
 *   - applied: everything else applied to the dashboard (visible quick
 *     filters and hidden filters alike). Visibility is NOT derivable from the
 *     filter list — `dashboard.getFiltersAsync()` returns all filters, visible
 *     or not; the visible controls are the quick-filter/parameter-control
 *     dashboard objects (see visibleControls).
 */
export function classifyFilters(filters: FilterLike[]): FilterGroups {
  const isAction = (f: FilterLike): boolean =>
    String(f.fieldName).startsWith("Action (");
  return {
    note: "Selection-action filters (Action (...)) are activated by mark selection or mouse clicks on a source chart — drive them with selectMarks, never applyFilterAsync. Applied filters are the rest of the dashboard's filters (visible quick filters and hidden filters alike); the visible controls a human user sees are the quick-filter and parameter-control dashboard objects in visibleControls.",
    selectionActions: filters.filter(isAction),
    applied: filters.filter((f) => !isAction(f)),
  };
}

export interface VisibleControl {
  name: string;
  type: "quick-filter" | "parameter-control";
  worksheet?: string;
}

export interface VisibleControls {
  note: string;
  controls: VisibleControl[];
}

/**
 * The dashboard objects a human user sees and references: quick-filter and
 * parameter-control zones. Everything else in the filter list is under the
 * fold. No zone↔filter name matching is attempted (DashboardObject exposes no
 * field reference) — this is the visible set, exactly as authored.
 */
export function visibleControls(zones: SnapshotZone[]): VisibleControls {
  const controls = zones
    .filter(
      (z) => z.type === "quick-filter" || z.type === "parameter-control"
    )
    .map((z) => ({
      name: z.name,
      type: z.type as "quick-filter" | "parameter-control",
      worksheet: z.worksheet,
    }));
  return {
    note: "The dashboard objects a human user sees and references: quick-filter objects are the visible filter controls, parameter-control objects are the visible parameter pickers. Everything else in the filter list is under the fold.",
    controls,
  };
}

// --- parameter domain normalization ------------------------------------------

export interface NormalizedParameterDomain {
  type: "list" | "range" | "any";
  values?: unknown[];
  min?: unknown;
  max?: unknown;
  stepSize?: unknown;
  dateStepPeriod?: unknown;
}

/**
 * Flatten ParameterDomainRestriction into a serializer-safe shape. The raw
 * object nests DataValue objects (list members / range bounds) deeper than the
 * serializer's depth cap, which would serialize them as "[max depth]".
 */
export function normalizeParameterDomain(
  restriction: unknown
): NormalizedParameterDomain {
  const r = (restriction ?? {}) as Record<string, unknown>;
  const type = String(r.type ?? "any");
  if (type === "list") {
    const raw = Array.isArray(r.allowableValues) ? r.allowableValues : [];
    return { type: "list", values: raw.map((v) => dataValue(v)) };
  }
  if (type === "range") {
    return {
      type: "range",
      min: dataValue(r.minValue),
      max: dataValue(r.maxValue),
      stepSize: r.stepSize ?? null,
      dateStepPeriod: r.dateStepPeriod ?? null,
    };
  }
  return { type: "any" };
}

// --- assembly ---------------------------------------------------------------

/**
 * Assemble the instant snapshot from the live workbook/activeSheet.
 *
 * `meta` is the background cache object ({ state, progress, errors }); its fill
 * state is reported here, not its content.
 */
export async function buildSnapshot(
  workbook: Record<string, unknown>,
  activeSheet: Record<string, unknown>,
  meta: { state: string; progress: unknown; errors?: string[] }
): Promise<Snapshot> {
  const sheetType = String(activeSheet.sheetType ?? "");
  const isDashboard = sheetType === "dashboard";
  const canFilter = sheetType === "dashboard" || sheetType === "worksheet";

  const publishedSheetsInfo = Array.isArray(workbook.publishedSheetsInfo)
    ? workbook.publishedSheetsInfo
    : [];
  const objects = isDashboard && Array.isArray(activeSheet.objects) ? activeSheet.objects : [];
  const worksheets = isDashboard && Array.isArray(activeSheet.worksheets) ? activeSheet.worksheets : [];

  // The two async calls. Both may throw pre-interactive in edge cases; the
  // caller runs after firstinteractive so failures are genuinely exceptional.
  const parametersRaw = await (workbook.getParametersAsync as () => Promise<unknown[]> | undefined).call(workbook);
  const filtersRaw = canFilter
    ? await (activeSheet.getFiltersAsync as () => Promise<unknown[]> | undefined).call(activeSheet)
    : [];

  const parameters: SnapshotParameter[] = Array.isArray(parametersRaw)
    ? parametersRaw.map((p) => {
        const param = p as Record<string, unknown>;
        return {
          name: String(param.name ?? ""),
          dataType: String(param.dataType ?? ""),
          currentValue: dataValue(param.currentValue),
          allowableValues: normalizeParameterDomain(param.allowableValues),
        };
      })
    : [];

  const filters: SnapshotFilter[] = Array.isArray(filtersRaw)
    ? filtersRaw.map((f) => {
        const filter = f as Record<string, unknown>;
        const out: SnapshotFilter = {
          worksheet: String(filter.worksheetName ?? ""),
          fieldName: String(filter.fieldName ?? ""),
          filterType: String(filter.filterType ?? ""),
        };
        if (String(filter.filterType ?? "") === "categorical") {
          const applied = Array.isArray(filter.appliedValues) ? filter.appliedValues : [];
          out.appliedValues = applied.map((v) => dataValue(v));
          out.isAllSelected = Boolean(filter.isAllSelected);
        } else if (String(filter.filterType ?? "") === "relative-date") {
          out.anchorDate = dataValue(filter.anchorDate);
          out.periodType = String(filter.periodType ?? "");
          out.rangeN = Number(filter.rangeN ?? 0);
          out.rangeType = String(filter.rangeType ?? "");
        }
        return out;
      })
    : [];

  const zones = mapZones(objects);
  return {
    workbook: { name: String(workbook.name ?? "") },
    sheets: mapSheets(publishedSheetsInfo),
    activeSheet: { name: String(activeSheet.name ?? ""), sheetType },
    zones,
    worksheetNames: worksheets.map((w) => {
      const ws = w as Record<string, unknown>;
      return String(ws.name ?? "");
    }),
    parameters,
    filters,
    filterGroups: classifyFilters(filters),
    visibleControls: visibleControls(zones),
    metadata: {
      status: meta.state,
      progress: meta.progress,
      errors: meta.errors ?? [],
    },
    note: "Deep metadata is being cached in the background — read it via 'meta' / tableau-viz meta.",
  };
}