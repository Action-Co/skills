// derive-workbook.js — reusable derivation of the machine half of a workbook
// semantic model, run inside a live view-tableau-dashboard eval scope.
//
//   tableau-viz eval --file scripts/derive-workbook.js \
//     --intent "Deriving workbook semantic model" -o <Name>.derived.json
//   (or use scripts/derive-workbook.sh, which wraps start → wait → eval → save)
//
// Standard eval scope is available: `workbook`, `activeSheet`, `helpers`, `meta`.
//
// This script is the ONLY intended caller of worksheet.getDataSourcesAsync()
// (Tableau's docs flag it as potentially performance-degrading). It runs once
// per worksheet at model-build time — never in an interactive loop. The
// view-tableau-dashboard skill's own runtime path stays fast and lean; deep
// datasource introspection belongs here, in the semantic model.
//
// What it pulls from the Embedding API (all static):
//   - identity (workbook name), sheets, zones, parameters (normalized),
//     filters grouped (selection actions vs applied) + visibleControls
//   - referenced fields ONLY: the union of fields the workbook's worksheets
//     actually use (meta columns + visual specs), enriched from the datasource
//     field catalog. The full schema belongs in the datasource semantic model.
//   - datasources + logical tables + extractUpdateTime (a Public-friendly
//     data-freshness signal)
//   - samples: relevant-domain values for categorical filters (labeled, never
//     treated as live truth)
// REST/Metadata-only fields (luid, owner, project, tags, freshness.anchor,
// lineage, field formulas) are emitted as null so a PAT-enabled run can enrich
// them later — the Embedding API is the visual layer, not the catalog.
await meta.ready();

// --- canonical casing --------------------------------------------------------
// The Embedding API returns lowercase dataType/role; the derived model (and the
// Metadata API) use canonical uppercase. Normalize once, at the source.
function canonicalDataType(t) {
  switch (String(t ?? "").toLowerCase()) {
    case "string": return "STRING";
    case "int": case "integer": return "INTEGER";
    case "float": case "real": return "REAL";
    case "bool": case "boolean": return "BOOLEAN";
    case "date": return "DATE";
    case "date-time": case "datetime": return "DATETIME";
    case "spatial": return "SPATIAL";
    default: return t ?? null;
  }
}
function canonicalRole(r) {
  const s = String(r ?? "").toLowerCase();
  if (s === "dimension") return "DIMENSION";
  if (s === "measure") return "MEASURE";
  return r ?? null;
}
// Aggregations arrive lowercase from the Embedding API ("sum", "none", "user");
// the Metadata API and the shipped examples use uppercase (SUM, NONE, USER).
function canonicalAggregation(a) {
  const s = String(a ?? "");
  return s === "" ? null : s.toUpperCase();
}

// Strip aggregation wrappers down to the field name so referenced columns match
// catalog fields: "SUM(Sales)" -> "Sales", "CNTD(Opportunity ID)" ->
// "Opportunity ID", "DAY(Close Date)" -> "Close Date".
function bareFieldName(name) {
  const m = /^[A-Z][A-Z0-9_]*\s*\((.+)\)$/.exec(String(name ?? "").trim());
  return m ? m[1].trim() : String(name ?? "").trim();
}
const isMachineryField = (n) =>
  n === "Measure Names" || n === "Measure Values";

const sheets = (workbook.publishedSheetsInfo ?? []).map((s) => ({
  name: s.name,
  type: s.sheetType,
  index: s.index,
  isActive: s.isActive,
  isHidden: s.isHidden,
}));

const isDash = activeSheet.sheetType === "dashboard";
const worksheetNames = isDash ? activeSheet.worksheets.map((w) => w.name) : [activeSheet.name];

const zones = isDash
  ? (activeSheet.objects ?? []).map((z) => ({
      name: z.name,
      type: z.type,
      worksheet: z.worksheet?.name ?? null,
      floating: z.isFloating,
      visible: z.isVisible,
    }))
  : [];

const visible = helpers.visibleControls(zones);

// Parameters — helpers.getParameters() normalizes allowableValues to a flat,
// serializer-safe shape ({type, values} | {type, min, max, ...} | {type}).
const parameters = (await helpers.getParameters()).map((p) => ({
  name: p.name,
  dataType: p.dataType,
  allowableValues: p.allowableValues ?? null,
}));
const parameterNames = new Set(parameters.map((p) => p.name));

// Filters: dashboard-level first, then per-worksheet. describeFilter gives the
// full typed definition (incl. relative-date period + appliedWorksheets).
// Dedupe by fieldName — the same dashboard filter (and each selection action)
// appears once per target worksheet; one entry with appliedWorksheets is enough.
// Then classify into selection actions vs applied, with the explanation encoded.
const filterEntries = [];
const seenFilters = new Set();
const allFilters = isDash
  ? await helpers.getFilters()
  : await helpers.getFilters(activeSheet.name);
for (const f of allFilters) {
  const key = `${f.worksheet}:${f.fieldName}`;
  if (seenFilters.has(key)) continue;
  seenFilters.add(key);
  if (seenFilters.has(`*:${f.fieldName}`)) continue; // already captured this field
  seenFilters.add(`*:${f.fieldName}`);
  try {
    const desc = await helpers.describeFilter(f.fieldName, { worksheet: f.worksheet });
    filterEntries.push({
      worksheet: desc.worksheet,
      fieldName: desc.fieldName,
      filterType: desc.filterType,
      period: desc.periodType
        ? { anchorDate: desc.anchorDate, periodType: desc.periodType, rangeN: desc.rangeN, rangeType: desc.rangeType }
        : undefined,
      appliedWorksheets: desc.appliedWorksheets ?? undefined,
    });
  } catch {
    filterEntries.push({ worksheet: f.worksheet, fieldName: f.fieldName, filterType: f.filterType });
  }
}
const filters = helpers.classifyFilters(filterEntries);

// Per-worksheet columns + visual specs from the background cache.
const worksheets = {};
for (const name of worksheetNames) {
  const w = meta.worksheets?.[name];
  worksheets[name] = {
    columns: (w?.columns ?? []).map((c) => ({
      fieldName: c.fieldName,
      fieldId: c.fieldId,
      dataType: c.dataType,
      index: c.index,
    })),
    visualSpec: w?.visualSpec ?? null,
  };
}

// Datasources + logical tables + the full field catalog — ONE raw call per
// worksheet (the raw API exposes the full Field surface that the helper
// intentionally keeps lean: aggregation, isCalculatedField, description,
// semanticRole, fieldId, ...).
const datasources = [];
const seenDs = new Set();
for (const name of worksheetNames) {
  let raw;
  try {
    const ws = isDash ? activeSheet.worksheets.find((w) => w.name === name) : activeSheet;
    raw = await ws.getDataSourcesAsync();
  } catch {
    continue;
  }
  for (const ds of raw ?? []) {
    if (seenDs.has(ds.id)) continue;
    seenDs.add(ds.id);
    let logicalTables = [];
    try {
      logicalTables = (await ds.getLogicalTablesAsync()).map((t) => ({
        id: t.id,
        caption: t.caption ?? t.id,
      }));
    } catch {
      // logical tables unavailable; keep empty
    }
    datasources.push({
      name: ds.name,
      id: ds.id,
      isExtract: ds.isExtract ?? null,
      isPublished: ds.isPublished ?? null,
      extractUpdateTime: ds.extractUpdateTime ?? null,
      logicalTables,
      fields: (ds.fields ?? []).map((f) => ({
        name: f.name,
        fieldId: f.id ?? null,
        dataType: canonicalDataType(f.dataType),
        role: canonicalRole(f.role),
        aggregation: canonicalAggregation(f.aggregation),
        columnType: f.columnType ?? null,
        description: f.description ?? null,
        semanticRole: f.semanticRole ?? null,
        isCalculated: f.isCalculatedField ?? false,
        isGenerated: f.isGenerated ?? false,
        isHidden: f.isHidden ?? false,
      })),
    });
  }
}

// Referenced fields: the union of what the worksheets actually use (meta
// columns + visual specs), enriched from the datasource catalog. NOT the full
// schema — the full catalog belongs in the datasource semantic model, and
// lineage (below) is the bridge to it.
const referencedNames = new Set();
const addReferenced = (name) => {
  const bare = bareFieldName(name);
  if (bare && !isMachineryField(bare)) referencedNames.add(bare);
};
for (const name of worksheetNames) {
  const w = meta.worksheets?.[name];
  for (const c of w?.columns ?? []) addReferenced(c.fieldName);
  const spec = w?.visualSpec;
  if (spec) {
    for (const f of [...(spec.rowFields ?? []), ...(spec.columnFields ?? [])]) {
      addReferenced(f.fieldName ?? f.name);
    }
    for (const m of spec.marksSpecifications ?? []) {
      for (const f of m.fields ?? []) addReferenced(f.fieldName ?? f.name);
    }
  }
}

// Enrich referenced fields from the catalog (first datasource wins).
const catalogByName = new Map();
const catalogDatasource = new Map();
for (const ds of datasources) {
  for (const f of ds.fields) {
    if (!catalogByName.has(f.name)) {
      catalogByName.set(f.name, f);
      catalogDatasource.set(f.name, ds.name);
    }
  }
}
const fields = [];
for (const name of referencedNames) {
  const cat = catalogByName.get(name);
  if (cat) {
    fields.push({
      name: cat.name,
      dataType: cat.dataType,
      role: cat.role,
      aggregation: cat.aggregation,
      columnType: cat.columnType,
      description: cat.description,
      semanticRole: cat.semanticRole,
      isCalculated: cat.isCalculated,
      isGenerated: cat.isGenerated,
      fieldId: cat.fieldId,
      logicalTable: null, // Metadata API enrichment
      formula: null, // Metadata API enrichment
      datasource: catalogDatasource.get(name) ?? null,
    });
  } else {
    // Referenced but not in the catalog (e.g., sheet-level calculation or a
    // caption mismatch) — keep the reference with minimal metadata.
    fields.push({
      name,
      dataType: null,
      role: null,
      aggregation: null,
      columnType: null,
      description: null,
      semanticRole: null,
      isCalculated: null,
      isGenerated: null,
      fieldId: null,
      logicalTable: null,
      formula: null,
      datasource: null,
    });
  }
}
fields.sort((a, b) => a.name.localeCompare(b.name));

const fullSchemaFieldCount = catalogByName.size;

// Samples: relevant domain for each real categorical dimension in the applied
// group. Skip selection actions (Action (...)), machinery fields (Measure
// Names/Values), and parameter-fed filters — they are not user-facing
// dimensions to enumerate.
const fieldDomainSamples = {};
for (const f of filters.applied) {
  if (f.filterType !== "categorical" || fieldDomainSamples[f.fieldName]) continue;
  if (isMachineryField(f.fieldName)) continue; // Measure Names/Values — not user-facing dimensions
  if (parameterNames.has(f.fieldName)) continue; // parameter-fed filters — the parameter is the control
  try {
    const values = await helpers.getDomainValues(f.worksheet, f.fieldName, "relevant");
    fieldDomainSamples[f.fieldName] = values.values
      .filter((v) => v !== "%null%")
      .slice(0, 50);
  } catch {
    // no categorical domain available — skip
  }
}

return {
  schema_version: "1.0",
  asset: {
    type: "workbook",
    name: workbook.name,
    luid: null,
    site: null,
    project: null,
    owner: null,
    contentUrl: null,
    webpageUrl: null,
    description: null,
    tags: [],
  },
  freshness: {
    anchor: null, // REST API updatedAt — null when there is no REST catalog
    // (e.g., Tableau Public): no detectable refresh schedule, likely a static
    // dataset. See docs/READING_THE_MODEL.md.
    retrievedAt: new Date().toISOString(),
    source: "Embedding API (view-tableau-dashboard)",
  },
  structure: {
    sheets,
    dashboards: isDash
      ? [{ name: activeSheet.name, luid: null, sheets: worksheetNames }]
      : [],
    zones,
    visibleControls: visible,
    parameters,
    filters,
  },
  datasource:
    datasources.length > 0
      ? {
          name: datasources[0].name,
          id: datasources[0].id,
          hasExtracts: datasources[0].isExtract ?? null,
          isPublished: datasources[0].isPublished ?? null,
          extractUpdateTime: datasources[0].extractUpdateTime ?? null,
          logicalTables: datasources[0].logicalTables ?? [],
          fullSchemaFieldCount,
        }
      : null,
  fields,
  lineage: {
    upstreamDatasources: datasources.map((ds) => ({ luid: ds.id, name: ds.name })),
    upstreamTables: [],
    upstreamDatabases: [],
    downstreamWorkbooks: [],
  },
  samples: {
    note: "samples only — filter domain values and row counts must be verified live",
    fieldDomainSamples,
  },
  _meta: {
    derivationSource: "Embedding API via view-tableau-dashboard",
    worksheets: Object.keys(worksheets),
    note: `Referenced fields only — the fields this workbook's worksheets actually use. The full datasource catalog (${fullSchemaFieldCount} fields) belongs in the datasource semantic model (site/<site>/datasources/<name>), reachable via lineage.`,
  },
};