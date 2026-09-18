// describe — a human-oriented description of the dashboard, assembled from the
// instant snapshot pieces. Best scheduled with `start --script describe` so it
// arrives as `scriptResult` alongside the snapshot on firstinteractive.
const active = activeSheet;
const zones = active.sheetType === "dashboard" ? active.objects : [];
return {
  workbook: workbook.name,
  sheets: workbook.publishedSheetsInfo.map((s) => ({
    name: s.name,
    index: s.index,
    type: s.sheetType,
    active: s.isActive,
  })),
  activeSheet: { name: active.name, type: active.sheetType },
  worksheets:
    active.sheetType === "dashboard"
      ? active.worksheets.map((w) => w.name)
      : [active.name],
  zones: zones.map((z) => ({
    name: z.name,
    type: z.type,
    worksheet: z.worksheet?.name ?? null,
    floating: z.isFloating,
  })),
  parameters: (await workbook.getParametersAsync()).map((p) => ({
    name: p.name,
    currentValue: p.currentValue?.value ?? null,
    dataType: p.dataType,
  })),
  filters: (await active.getFiltersAsync()).map((f) => ({
    worksheet: f.worksheetName,
    fieldName: f.fieldName,
    filterType: f.filterType,
  })),
};