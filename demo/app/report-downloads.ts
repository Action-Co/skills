// Report downloads run in Tabby's host process, never in a chat agent.
// Requests select an existing report and a format; they cannot supply code or paths.
import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

type DownloadOptions = {
  artifactsDir: string;
  exportPdf: (htmlFile: string, pdfFile: string) => Promise<void>;
  pdfUnavailableReason: () => string | null;
};

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function createReportDownloader(options: DownloadOptions) {
  const exporting = new Map<string, Promise<void>>();
  return async (htmlName: string, format: string, title?: string): Promise<Response> => {
    if (format !== "html" && format !== "pdf") return error("Choose HTML or PDF.", 400);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.html?$/i.test(htmlName)) {
      return error("Choose an HTML report in artifacts/.", 400);
    }
    const htmlFile = join(options.artifactsDir, htmlName);
    try {
      // Also reject symlinks that lead outside the artifacts directory.
      if (dirname(await realpath(htmlFile)) !== await realpath(options.artifactsDir)
        || !(await stat(htmlFile)).isFile()) return error("Report not found.", 404);
    } catch {
      return error("Report not found.", 404);
    }
    const name = format === "html" ? htmlName : htmlName.replace(/\.html?$/i, ".pdf");
    const file = join(options.artifactsDir, name);
    if (format === "pdf") {
      const unavailable = options.pdfUnavailableReason();
      if (unavailable) return error(`${unavailable} You can still download HTML.`, 503);
      try {
        // Never follow an existing PDF symlink when printing.
        const destination = await lstat(file).catch((err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT") return null;
          throw err;
        });
        if (destination?.isSymbolicLink()) {
          return error("Invalid PDF destination.", 400);
        }
        const stale = !(await Bun.file(file).exists()) || (await stat(file)).mtimeMs < (await stat(htmlFile)).mtimeMs;
        let job = exporting.get(name);
        if (!job && stale) {
          job = options.exportPdf(htmlFile, file).finally(() => exporting.delete(name));
          exporting.set(name, job);
        }
        if (job) await job;
        if (!(await Bun.file(file).exists())) throw new Error("PDF export produced no file.");
      } catch (err) {
        return error(`PDF download failed. You can still download HTML. ${err instanceof Error ? err.message : String(err)}`, 500);
      }
    }
    const downloadName = title ? `${title}.${format}` : name;
    return new Response(Bun.file(file), {
      headers: {
        "content-type": format === "html" ? "text/html; charset=utf-8" : "application/pdf",
        "content-disposition": `attachment; filename="${downloadName.replace(/["\\\r\n]/g, "_")}"`,
        "cache-control": "no-store",
      },
    });
  };
}
