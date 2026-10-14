/**
 * report-export.ts — turn reports into Action-branded HTML, PDF and Excel.
 *
 * - markdownReport(): Markdown (as an agent writes it) → a branded HTML page.
 * - exportPdf(): any report page → PDF, printed by headless Chrome. Print
 *   styles switch the page to the light theme.
 * - exportXlsx(): any report page → an Excel workbook. Each h2 section becomes
 *   a sheet; tables keep the brand table style (Blue Raven header row, bold
 *   first column, thin Cool Grey borders) and numbers become real numbers.
 *
 * The HTML report is the single source: PDF and Excel are made from it, so all
 * three always agree.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { brandedPage } from "./brand.ts";
import { findChrome } from "./session.ts";

// ---------------------------------------------------------------------------
// Markdown → branded HTML
// ---------------------------------------------------------------------------

export interface MarkdownReportOptions {
  markdown: string;
  /** Page title; defaults to the Markdown's first "# " heading. */
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  footer?: string;
}

export function markdownReport(opts: MarkdownReportOptions): string {
  let md = opts.markdown.replace(/\r/g, "");
  let title = opts.title;
  const h1 = md.match(/^#\s+(.+)$/m);
  if (h1) {
    title ??= h1[1].trim();
    md = md.replace(h1[0], "");
  }
  // Raw HTML in the Markdown is escaped, never rendered.
  let body = Bun.markdown.html(md, { noHtmlBlocks: true, noHtmlSpans: true });
  body = safeLinks(body).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
  return brandedPage({
    title: title ?? "Report",
    subtitle: opts.subtitle,
    eyebrow: opts.eyebrow,
    footer: opts.footer,
    body,
  });
}

/** Keep only http(s), mailto, relative and in-page links. */
function safeLinks(html: string): string {
  return html.replace(/<a href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (whole, href: string, _rest, text: string) =>
    /^(https?:|mailto:|#|\/|\.{0,2}\/|[\w-]+\.(html|pdf|xlsx)$)/i.test(href) ? whole : text
  );
}

// ---------------------------------------------------------------------------
// PDF (headless Chrome)
// ---------------------------------------------------------------------------

export async function exportPdf(htmlFile: string, pdfFile: string, timeoutMs = 90_000): Promise<void> {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error("PDF export needs Google Chrome. Install it, or use the HTML or Excel export.");
  }
  // A throwaway profile, so this works while the presenter's Chrome is open.
  const profile = await mkdtemp(join(tmpdir(), "tableau-viz-pdf-"));
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(chrome, [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=15000", // let Kanit load before printing
        `--user-data-dir=${profile}`,
        `--print-to-pdf=${pdfFile}`,
        pathToFileURL(htmlFile).href,
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr?.on("data", (d) => { stderr += String(d); });
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error("PDF export timed out"));
      }, timeoutMs);
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`PDF export failed (Chrome exit ${code}): ${stderr.trim().split("\n").pop() ?? ""}`));
      });
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
  if (!(await Bun.file(pdfFile).exists())) throw new Error("PDF export produced no file");
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

type Block =
  /** `section`: the heading opens an explicit report section (always its own sheet). */
  | { kind: "heading"; level: 2 | 3; text: string; section?: boolean }
  | { kind: "text"; text: string; muted?: boolean }
  | { kind: "kpi"; label: string; value: string }
  | { kind: "table"; rows: { cells: string[]; head: boolean }[] };

export interface ParsedReport {
  title: string;
  subtitle: string;
  meta: string;
  blocks: Block[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const clean = (s: string) => decode(s).replace(/\s+/g, " ").trim();

/** Read a report page (from brandedPage) back into headings, text, KPIs and tables. */
export async function parseReport(html: string): Promise<ParsedReport> {
  const report: ParsedReport = { title: "", subtitle: "", meta: "", blocks: [] };
  let capture: { text: string } | null = null;
  let listDepth = 0;
  let sectionDepth = 0;
  let table: Extract<Block, { kind: "table" }> | null = null;
  let row: { cells: string[]; head: boolean } | null = null;
  let kpi: { label: string; value: string } | null = null;

  // Collects an element's text (including nested tags) and hands it over at
  // its end tag.
  const collect = (done: (text: string) => void): HTMLRewriterTypes.HTMLRewriterElementContentHandlers => ({
    element(el) {
      const box = { text: "" };
      capture = box;
      el.onEndTag(() => {
        if (capture === box) capture = null;
        done(clean(box.text));
      });
    },
  });
  await new HTMLRewriter()
    // Every text chunk arrives here exactly once; it belongs to the element
    // currently being collected.
    .onDocument({ text(t) { if (capture) capture.text += t.text; } })
    .on(".page-head h1", collect((t) => { report.title = t; }))
    .on(".page-head .sub", collect((t) => { report.subtitle = t; }))
    .on(".page-head .meta", collect((t) => { report.meta = t; }))
    .on("main section", { element(el) { sectionDepth++; el.onEndTag(() => { sectionDepth--; }); } })
    .on("main h1, main h2", {
      element(el) {
        const section = sectionDepth > 0;
        collect((t) => t && report.blocks.push({ kind: "heading", level: 2, text: t, ...(section && { section }) })).element!(el);
      },
    })
    .on("main h3, main h4", collect((t) => t && report.blocks.push({ kind: "heading", level: 3, text: t })))
    .on("main ul, main ol", { element(el) { listDepth++; el.onEndTag(() => { listDepth--; }); } })
    .on("main li", collect((t) => t && report.blocks.push({ kind: "text", text: `• ${t}` })))
    .on("main p", {
      element(el) {
        if (listDepth > 0 || kpi) return; // list items and KPI tiles are collected whole
        const muted = /\b(subtitle|note)\b/.test(el.getAttribute("class") ?? "");
        collect((t) => t && report.blocks.push({ kind: "text", text: t, muted })).element!(el);
      },
    })
    .on("main .error", collect((t) => t && report.blocks.push({ kind: "text", text: `Error: ${t}` })))
    .on("main blockquote", collect((t) => t && report.blocks.push({ kind: "text", text: t })))
    .on("main .kpi", {
      element(el) {
        kpi = { label: "", value: "" };
        el.onEndTag(() => {
          if (kpi && (kpi.label || kpi.value)) report.blocks.push({ kind: "kpi", ...kpi });
          kpi = null;
        });
      },
    })
    .on("main .kpi .k", collect((t) => { if (kpi) kpi.label = t; }))
    .on("main .kpi .v", collect((t) => { if (kpi) kpi.value = t; }))
    .on("main table", {
      element(el) {
        table = { kind: "table", rows: [] };
        el.onEndTag(() => {
          if (table?.rows.length) report.blocks.push(table);
          table = null;
        });
      },
    })
    .on("main tr", {
      element(el) {
        row = { cells: [], head: false };
        el.onEndTag(() => {
          if (row && table) table.rows.push(row);
          row = null;
        });
      },
    })
    .on("main th, main td", {
      element(el) {
        const cellRow = row;
        if (el.tagName === "th" && cellRow) cellRow.head = true;
        collect((t) => cellRow?.cells.push(t)).element!(el);
      },
    })
    .transform(new Response(html))
    .text();
  return report;
}

// Brand colors as ARGB.
const RAVEN = "FF0A1044";
const MAVEN = "FF4655E4";
const MUTED = "FF525676";
const COOL_GREY = "FFD8E9F4";
const BACKGROUND = "FFF4FBFF";
const WHITE = "FFFFFFFF";
const font = (extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: "Kanit", size: 11, color: { argb: RAVEN }, ...extra });

/** "$2,326,534" → 2326534 with a currency format; "12.6%" → 0.126 as a percent. Anything else stays text. */
export function excelValue(text: string): { value: string | number; numFmt?: string } {
  const t = text.trim();
  let m = t.match(/^(-)?\$(-)?([\d,]+(?:\.(\d+))?)$/);
  if (m) {
    const n = Number(m[3].replace(/,/g, "")) * (m[1] || m[2] ? -1 : 1);
    return { value: n, numFmt: m[4] ? `"$"#,##0.${"0".repeat(m[4].length)}` : '"$"#,##0' };
  }
  m = t.match(/^(-?[\d,]*\.?\d+)%$/);
  if (m) {
    const decimals = (m[1].split(".")[1] ?? "").length;
    const value = Math.round((Number(m[1].replace(/,/g, "")) / 100) * 1e10) / 1e10;
    return { value, numFmt: decimals ? `0.${"0".repeat(decimals)}%` : "0%" };
  }
  m = t.match(/^-?\d{1,3}(,\d{3})+(\.\d+)?$|^-?\d+(\.\d+)?$/);
  if (m && t.length < 16) {
    const decimals = (t.split(".")[1] ?? "").length;
    return { value: Number(t.replace(/,/g, "")), numFmt: decimals ? `#,##0.${"0".repeat(decimals)}` : "#,##0" };
  }
  return { value: t };
}

function sheetName(title: string, used: Set<string>): string {
  // "Overview — global & state margins" → "Overview"
  const base = title
    .split(/\s+[—–]\s+/)[0].replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

export async function reportWorkbook(report: ParsedReport): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Tabby by The Action Co.";
  wb.title = report.title;

  // Group blocks into sheets at each h2; anything before the first h2 is the summary.
  const groups: { title: string; section: boolean; blocks: Block[] }[] = [];
  for (const b of report.blocks) {
    if (b.kind === "heading" && b.level === 2) groups.push({ title: b.text, section: Boolean(b.section), blocks: [] });
    else {
      if (!groups.length) groups.push({ title: "Summary", section: false, blocks: [] });
      groups[groups.length - 1].blocks.push(b);
    }
  }
  if (!groups.length) groups.push({ title: "Summary", section: false, blocks: [] });
  // Report sections and headings with data get their own sheet; prose-only
  // headings stay with the sheet before them.
  for (let i = groups.length - 1; i > 0; i--) {
    if (groups[i].section || groups[i].blocks.some((b) => b.kind === "table")) continue;
    groups[i - 1].blocks.push({ kind: "heading", level: 2, text: groups[i].title }, ...groups[i].blocks);
    groups.splice(i, 1);
  }

  const used = new Set<string>();
  groups.forEach((group, index) => {
    const ws = wb.addWorksheet(sheetName(group.title, used), { views: [{ showGridLines: false }] });
    const widths: number[] = [];
    const measure = (col: number, text: string) => {
      widths[col] = Math.max(widths[col] ?? 10, Math.min(60, text.length + 3));
    };
    const line = (text: string, f: Partial<ExcelJS.Font>) => {
      const r = ws.addRow([text]);
      r.getCell(1).font = f;
      return r;
    };

    line(report.title || "Report", font({ size: 18, bold: true }));
    if (index === 0 && report.subtitle) line(report.subtitle, font({ size: 12, color: { argb: MAVEN } }));
    if (index === 0 && report.meta) line(report.meta, font({ size: 10, color: { argb: MUTED } }));
    if (group.title !== "Summary" || index > 0) line(group.title, font({ size: 14, bold: true, color: { argb: MAVEN } }));
    ws.addRow([]);

    for (const b of group.blocks) {
      if (b.kind === "heading") {
        ws.addRow([]);
        line(b.text, b.level === 2 ? font({ size: 14, bold: true, color: { argb: MAVEN } }) : font({ size: 12, bold: true }));
      } else if (b.kind === "text") {
        line(b.text, font(b.muted ? { size: 10, color: { argb: MUTED } } : {}));
      } else if (b.kind === "kpi") {
        const { value, numFmt } = excelValue(b.value);
        const r = ws.addRow([b.label, value]);
        r.getCell(1).font = font({ bold: true });
        r.getCell(2).font = font({ bold: true, size: 12 });
        if (numFmt) r.getCell(2).numFmt = numFmt;
        measure(0, b.label);
        measure(1, b.value);
      } else {
        ws.addRow([]);
        let body = 0;
        for (const tr of b.rows) {
          const values = tr.cells.map((c) => (tr.head ? { value: c } : excelValue(c)));
          const r = ws.addRow(values.map((v) => v.value));
          values.forEach((v, i) => {
            const cell = r.getCell(i + 1);
            measure(i, tr.cells[i]);
            cell.border = {
              top: { style: "thin", color: { argb: COOL_GREY } },
              bottom: { style: "thin", color: { argb: COOL_GREY } },
              left: { style: "thin", color: { argb: COOL_GREY } },
              right: { style: "thin", color: { argb: COOL_GREY } },
            };
            if (tr.head) {
              cell.font = font({ bold: true, color: { argb: WHITE } });
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RAVEN } };
            } else {
              cell.font = font({ bold: i === 0 });
              if (body % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BACKGROUND } };
              if (v.numFmt) {
                cell.numFmt = v.numFmt;
                cell.alignment = { horizontal: "right" };
              }
            }
          });
          if (!tr.head) body++;
        }
        ws.addRow([]);
      }
    }
    ws.addRow([]);
    line("Prepared with Tabby by The Action Co.", font({ size: 9, color: { argb: MUTED } }));
    widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
  });
  return wb;
}

export async function exportXlsx(html: string, xlsxFile: string): Promise<void> {
  const wb = await reportWorkbook(await parseReport(html));
  await wb.xlsx.writeFile(xlsxFile);
}
