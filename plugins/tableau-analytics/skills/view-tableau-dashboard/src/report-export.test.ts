/**
 * report-export.test.ts — branded report HTML and PDF exports.
 * Native Chrome printing is opt-in and must run outside the macOS sandbox.
 */

import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brandedPage } from "./brand.ts";
import { exportPdf, markdownReport, pdfExportUnavailableReason } from "./report-export.ts";
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

test("PDF availability rejects macOS seatbelt and chat agents before Chrome is launched", async () => {
  expect(pdfExportUnavailableReason({ CODEX_SANDBOX: "seatbelt" }, "darwin")).toContain("sandbox");
  expect(pdfExportUnavailableReason({ TABLEAU_VIZ_NO_PDF: "1" }, "linux")).toContain("Tabby");
  expect(pdfExportUnavailableReason({}, "darwin")).toBeNull();
  expect(pdfExportUnavailableReason({ CODEX_SANDBOX: "seatbelt" }, "linux")).toBeNull();
  const previous = process.env.TABLEAU_VIZ_NO_PDF;
  process.env.TABLEAU_VIZ_NO_PDF = "1";
  try {
    // No input file exists: the environment check must win before file access or spawning.
    await expect(exportPdf("/missing-report.html", "/missing-report.pdf")).rejects.toThrow("without --pdf");
  } finally {
    if (previous === undefined) delete process.env.TABLEAU_VIZ_NO_PDF;
    else process.env.TABLEAU_VIZ_NO_PDF = previous;
  }
});

test.skipIf(process.env.TABLEAU_VIZ_TEST_CHROME !== "1" || !findChrome() || Boolean(pdfExportUnavailableReason()))("exportPdf prints the report with Chrome", async () => {
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
