// Exercise the shipped inline renderer and download handler without launching a browser.
import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const page = await Bun.file(new URL("./index.html", import.meta.url)).text();
const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];
const renderer = script.slice(script.indexOf("function esc("), script.indexOf("function autosize("));

function render(text: string, unavailable = "") {
  return runInNewContext(
    `const DL_NAMES = { html: 'HTML', pdf: 'PDF' }; const pdfUnavailableReason = unavailable; ${renderer}; markdown(text);`,
    { text, unavailable },
  ) as string;
}

test("chat HTML reports render opening, HTML download and PDF download controls together", () => {
  const html = render("[Open report](http://127.0.0.1:3000/artifacts/region.html)");
  expect(html).toStartWith('<div class="files">');
  expect(html).toContain('href="http://127.0.0.1:3000/artifacts/region.html"');
  expect(html).toContain('data-format="html" data-report="region.html"');
  expect(html).toContain('data-format="pdf" data-report="region.html"');
  expect(html).not.toContain("disabled");
});

test("unavailable PDF leaves HTML enabled and external links never trigger local exports", () => {
  const html = render("[Open report](http://localhost:3000/artifacts/region.html)", 'Chrome unavailable "here"');
  expect(html).toContain('data-format="html" data-report="region.html"><svg');
  expect(html).toContain('data-format="pdf" data-report="region.html" disabled title="Chrome unavailable &quot;here&quot;"');
  expect(render("[Report](https://example.com/artifacts/region.html)")).not.toContain("data-report");
  expect(render("[Report](http://127.0.0.1:3000/artifacts/../secret.html)")).not.toContain("data-report");
  expect(render("[Bad](javascript:alert(1))")).not.toContain("href=");
});

test("HTML button downloads the named chat report as a file and restores its state", async () => {
  const downloads = script.slice(script.indexOf("const DL_NAMES ="), script.indexOf("$('tab-report').addEventListener"));
  const requests: string[] = [];
  const anchor = { href: "", download: "", click: () => { clicked = true; } };
  let clicked = false;
  const button = { disabled: false, lastChild: { textContent: "HTML" } };
  const TestURL = class extends URL {
    static createObjectURL(blob: Blob) { expect(blob.size).toBeGreaterThan(0); return "blob:test-report"; }
    static revokeObjectURL() {}
  };
  await runInNewContext(`${downloads}; downloadReport(button, 'html', 'region.html');`, {
    button, URL: TestURL, URLSearchParams,
    document: { querySelectorAll: () => [], addEventListener() {}, createElement: () => anchor },
    fetch: async (url: string) => {
      requests.push(url);
      return new Response("<!doctype html><h1>Regional profit</h1>", {
        headers: { "content-type": "text/html", "content-disposition": 'attachment; filename="region.html"' },
      });
    },
    setTimeout() {},
    alert: (message: string) => { throw new Error(message); },
  });
  expect(requests).toEqual(["/api/report/download?format=html&name=region.html"]);
  expect(clicked).toBe(true);
  expect(anchor.download).toBe("region.html");
  expect(button.disabled).toBe(false);
  expect(button.lastChild.textContent).toBe("HTML");
});

test("Tabby's shipped page script parses", () => {
  expect(() => new Function(script)).not.toThrow();
});
