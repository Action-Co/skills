import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReportDownloader } from "./report-downloads.ts";

async function withReports(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "tabby-download-test-"));
  try {
    await writeFile(join(dir, "region.html"), "<!doctype html><h1>Regional profit</h1>");
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("HTML downloads preserve report bytes and work when PDF is unavailable", () => withReports(async (dir) => {
  let exports = 0;
  const download = createReportDownloader({
    artifactsDir: dir,
    exportPdf: async () => { exports++; },
    pdfUnavailableReason: () => "Chrome is blocked.",
  });
  const response = await download("region.html", "html");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="region.html"');
  expect(await response.text()).toBe(await Bun.file(join(dir, "region.html")).text());
  const blocked = await download("region.html", "pdf");
  expect(blocked.status).toBe(503);
  expect((await blocked.json()).error).toContain("download HTML");
  expect(exports).toBe(0);
}));

test("downloads reject unknown formats, paths, missing reports and escaping symlinks", () => withReports(async (dir) => {
  let exports = 0;
  const download = createReportDownloader({ artifactsDir: dir, exportPdf: async () => { exports++; }, pdfUnavailableReason: () => null });
  expect((await download("region.html", "xlsx")).status).toBe(400);
  for (const name of ["../region.html", "sub/region.html", ".env", "region.html\r\n"]) {
    expect((await download(name, "html")).status).toBe(400);
  }
  expect((await download("absent.html", "html")).status).toBe(404);
  await symlink("/etc/hosts", join(dir, "outside.html"));
  expect((await download("outside.html", "html")).status).toBe(404);
  // A dangling output symlink must not let Chrome write outside artifacts/.
  await symlink(join(dir, "..", `outside-${crypto.randomUUID()}.pdf`), join(dir, "region.pdf"));
  expect((await download("region.html", "pdf")).status).toBe(400);
  expect(exports).toBe(0);
}));

test("PDF clicks share one conversion, reuse the result, and refresh changed reports", () => withReports(async (dir) => {
  let exports = 0;
  let start!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const printing = new Promise<void>((resolve) => { finish = resolve; });
  const download = createReportDownloader({
    artifactsDir: dir, pdfUnavailableReason: () => null,
    exportPdf: async (_html, pdf) => {
      exports++;
      start();
      await printing;
      await writeFile(pdf, "%PDF-test");
    },
  });
  const first = download("region.html", "pdf", "Executive summary");
  await started;
  const second = download("region.html", "pdf");
  finish();
  const responses = await Promise.all([first, second]);
  expect(exports).toBe(1);
  expect(responses.every((r) => r.status === 200)).toBe(true);
  expect(responses[0].headers.get("content-type")).toBe("application/pdf");
  expect(responses[0].headers.get("content-disposition")).toBe('attachment; filename="Executive summary.pdf"');
  expect(await responses[1].text()).toBe("%PDF-test");
  expect((await download("region.html", "pdf")).status).toBe(200);
  expect(exports).toBe(1);
  const past = new Date(Date.now() - 10_000);
  await utimes(join(dir, "region.pdf"), past, past);
  expect((await download("region.html", "pdf")).status).toBe(200);
  expect(exports).toBe(2);
}));

test("failed PDF conversion leaves HTML downloadable and allows another attempt", () => withReports(async (dir) => {
  let exports = 0;
  const download = createReportDownloader({
    artifactsDir: dir, pdfUnavailableReason: () => null,
    exportPdf: async (_html, pdf) => {
      if (++exports === 1) throw new Error("Printing failed.");
      await writeFile(pdf, "%PDF-test");
    },
  });
  const failed = await download("region.html", "pdf");
  expect(failed.status).toBe(500);
  expect((await failed.json()).error).toContain("download HTML");
  expect((await download("region.html", "html")).status).toBe(200);
  expect((await download("region.html", "pdf")).status).toBe(200);
  expect(exports).toBe(2);
}));
