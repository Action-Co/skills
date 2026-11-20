/**
 * report-export.ts — turn reports into Action-branded HTML and PDF.
 *
 * - markdownReport(): Markdown (as an agent writes it) → a branded HTML page.
 * - exportPdf(): any report page → PDF, printed by headless Chrome. Print
 *   styles switch the page to the light theme.
 *
 * The HTML report is the single source: PDF is printed from it.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
    /^(https?:|mailto:|#|\/|\.{0,2}\/|[\w-]+\.(html|pdf)$)/i.test(href) ? whole : text
  );
}

// ---------------------------------------------------------------------------
// PDF (headless Chrome)
// ---------------------------------------------------------------------------

/** Fail before launching Chrome in environments known to block macOS app registration. */
export function pdfExportUnavailableReason(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (env.TABLEAU_VIZ_NO_PDF === "1") {
    return "Create the HTML report without --pdf. Download HTML or PDF using Tabby's report buttons.";
  }
  if (platform === "darwin" && env.CODEX_SANDBOX === "seatbelt") {
    return "PDF export cannot launch Chrome inside the macOS Codex sandbox. "
      + "Create the HTML report without --pdf, then use Tabby's PDF button or run the export in a normal Terminal.";
  }
  return null;
}

export async function exportPdf(htmlFile: string, pdfFile: string, timeoutMs = 90_000): Promise<void> {
  const unavailable = pdfExportUnavailableReason();
  if (unavailable) throw new Error(unavailable);
  const chrome = findChrome();
  if (!chrome) {
    throw new Error("PDF export needs Google Chrome. Install it, or view the HTML report in your browser.");
  }
  // A throwaway profile, so this works while the presenter's Chrome is open.
  // Stage beside the destination so publication is an atomic rename. A failed
  // print must never replace a previous PDF or leave a partial cached download.
  const profile = await mkdtemp(join(dirname(resolve(pdfFile)), ".tableau-viz-pdf-"));
  const pendingPdf = join(profile, "report.pdf");
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
        `--print-to-pdf=${pendingPdf}`,
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
      proc.on("exit", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(
          `PDF export failed (Chrome ${signal ?? `exit ${code}`}): ${stderr.trim().split("\n").pop() ?? ""}. `
          + "The HTML report is still available. If Chrome is blocked by a sandbox, run the export in a normal Terminal.",
        ));
      });
    });
    if (!(await Bun.file(pendingPdf).exists())
      || await Bun.file(pendingPdf).slice(0, 5).text() !== "%PDF-") {
      throw new Error("PDF export produced no valid PDF. The HTML report is still available.");
    }
    await rename(pendingPdf, pdfFile);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
