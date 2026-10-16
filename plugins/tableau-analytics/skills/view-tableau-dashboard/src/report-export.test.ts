/**
 * report-export.test.ts — branded report HTML, Excel and PDF exports.
 * Pure logic except the PDF test, which runs only where Chrome is installed.
 */

import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brandedPage } from "./brand.ts";
import { renderExecutiveSummary } from "./executive-report.ts";
import { excelValue, exportPdf, markdownReport, parseReport, reportWorkbook } from "./report-export.ts";
import { findChrome } from "./session.ts";

const MARKDOWN = `# Regional profitability

The **West** leads.

## Profit by region

| Region | Sales | Margin |
|---|---:|---:|
| West | $725,458 | 14.9% |
| Central | $501,240 | 7.9% |

## What to watch

- Central discounts heavily.

<script>alert(1)</script> [bad](javascript:alert(1)) [good](https://action.co)
`;

test("brandedPage uses Kanit and the Action palette, with a logo placeholder", () => {
  const html = brandedPage({ title: "Q3 <review>", body: "<p>Hi</p>" });
  expect(html).toContain("family=Kanit");
  expect(html).toContain("#0A1044");
  expect(html).toContain("<h1>Q3 &lt;review&gt;</h1>");
  expect(html).toContain("ACTION LOGO");
  expect(html).toContain("@media print");
});

test("markdownReport takes the title from the first heading and keeps the HTML safe", () => {
  const html = markdownReport({ markdown: MARKDOWN, subtitle: "All years" });
  expect(html).toContain("<h1>Regional profitability</h1>");
  expect(html.match(/Regional profitability/g)?.length).toBe(2); // <title> + <h1>, not repeated in the body
  expect(html).toContain('<div class="table-wrap"><table>');
  expect(html).not.toContain("<script>alert");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("javascript:");
  expect(html).toContain('<a href="https://action.co">good</a>');
  expect(html).toContain("All years");
});

test("excelValue turns report numbers into real numbers with formats", () => {
  expect(excelValue("$2,326,534")).toEqual({ value: 2326534, numFmt: '"$"#,##0' });
  expect(excelValue("-$16,971")).toEqual({ value: -16971, numFmt: '"$"#,##0' });
  expect(excelValue("$2,908.17")).toEqual({ value: 2908.17, numFmt: '"$"#,##0.00' });
  expect(excelValue("11.9%")).toEqual({ value: 0.119, numFmt: "0.0%" });
  expect(excelValue("-21.69%")).toEqual({ value: -0.2169, numFmt: "0.00%" });
  expect(excelValue("38,654")).toEqual({ value: 38654, numFmt: "#,##0" });
  expect(excelValue("3 days")).toEqual({ value: "3 days" });
  expect(excelValue("$740K")).toEqual({ value: "$740K" });
});

test("parseReport reads headings, KPIs and tables back from a report page", async () => {
  const html = renderExecutiveSummary([
    {
      name: "overview",
      title: "Overview",
      subtitle: "",
      value: {
        headline: { "[federated.x].[sum:Sales:qk]": 2326534 },
        topByRatio: [{ name: "Delaware", sales: 27451, profit: 9977, ratio: 0.3635 }],
        bottomByRatio: [],
        topBySales: [],
        totalStates: 1,
      },
    },
  ]);
  const report = await parseReport(html);
  expect(report.title).toBe("Daily executive summary");
  expect(report.blocks).toContainEqual({ kind: "heading", level: 2, text: "Overview — global & state margins", section: true });
  expect(report.blocks).toContainEqual({ kind: "kpi", label: "Sales", value: "$2,326,534" });
  const table = report.blocks.find((b) => b.kind === "table");
  expect(table && table.kind === "table" && table.rows[0]).toEqual({ cells: ["State", "Profit ratio", "Sales", "Profit"], head: true });
  expect(table && table.kind === "table" && table.rows[1].cells[0]).toBe("Delaware");
});

test("reportWorkbook gives data sections their own branded sheet", async () => {
  const wb = await reportWorkbook(await parseReport(markdownReport({ markdown: MARKDOWN })));
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Profit by region"]);
  const ws = wb.getWorksheet("Profit by region")!;
  let header: import("exceljs").Row | undefined;
  ws.eachRow((r) => { if (r.getCell(1).value === "Region") header = r; });
  expect(header).toBeDefined();
  expect(header!.getCell(1).font?.name).toBe("Kanit");
  expect((header!.getCell(1).fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe("FF0A1044");
  const west = ws.getRow(header!.number + 1);
  expect(west.getCell(2).value).toBe(725458);
  expect(west.getCell(3).value).toBe(0.149);
  expect(west.getCell(3).numFmt).toBe("0.0%");
  // The prose-only "What to watch" section stays on the sheet before it.
  const sheetText: unknown[] = [];
  ws.eachRow((r) => sheetText.push(r.getCell(1).value));
  expect(sheetText).toContain("What to watch");
});

test.skipIf(!findChrome())("exportPdf prints the report with Chrome", async () => {
  const dir = await mkdtemp(join(tmpdir(), "report-export-test-"));
  try {
    const html = join(dir, "r.html");
    await writeFile(html, markdownReport({ markdown: MARKDOWN }));
    await exportPdf(html, join(dir, "r.pdf"));
    const pdf = await Bun.file(join(dir, "r.pdf")).text();
    expect(pdf.startsWith("%PDF")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
