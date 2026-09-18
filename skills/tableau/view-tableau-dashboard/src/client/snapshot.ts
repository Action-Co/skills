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
}

export interface Snapshot {
  workbook: { name: string };
  sheets: SnapshotSheet[];
  activeSheet: { name: string; sheetType: string };
  zones: SnapshotZone[];
  worksheetNames: string[];
  parameters: SnapshotParameter[];
  filters: SnapshotFilter[];
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
          allowableValues: param.allowableValues ?? null,
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
        }
        return out;
      })
    : [];

  return {
    workbook: { name: String(workbook.name ?? "") },
    sheets: mapSheets(publishedSheetsInfo),
    activeSheet: { name: String(activeSheet.name ?? ""), sheetType },
    zones: mapZones(objects),
    worksheetNames: worksheets.map((w) => {
      const ws = w as Record<string, unknown>;
      return String(ws.name ?? "");
    }),
    parameters,
    filters,
    metadata: {
      status: meta.state,
      progress: meta.progress,
      errors: meta.errors ?? [],
    },
    note: "Deep metadata is being cached in the background — read it via 'meta' / tableau-viz meta.",
  };
}