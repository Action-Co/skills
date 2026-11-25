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

test("returning from OWID revalidates a Tableau dashboard even when its cached label says Live", () => {
  const selectCode = script.slice(script.indexOf("function select(id)"), script.indexOf("// --- Our World in Data"));
  const state = { source: "owid", items: { overview: { status: "live" } } };
  const opened: string[] = [];
  const select = runInNewContext(`${selectCode}; select;`, {
    state, OWID: "owid-life-expectancy", SUMMARY: "summary", show: () => { state.source = "tableau"; },
    openDemo: (id: string) => opened.push(id),
  }) as (id: string) => void;
  select("overview");
  expect(opened).toEqual(["overview"]);
  select("welcome");
  expect(opened).toEqual(["overview"]);
});

test("a healthy Tableau iframe survives revalidation and duplicate opens share the in-flight check", async () => {
  const openCode = script.slice(script.indexOf("async function openDemo("), script.indexOf("// Default demo:"));
  const state = { items: { overview: { status: "live", opening: false } } };
  const iframe = { src: "http://127.0.0.1:3000/?session=existing" };
  const frame = { querySelector: () => iframe };
  let finish!: (value: { session: string; tabUrl: string }) => void;
  const check = new Promise<{ session: string; tabUrl: string }>(resolve => { finish = resolve; });
  const calls: string[] = [];
  const openDemo = runInNewContext(`${openCode}; openDemo;`, {
    state, dashFrame: () => frame,
    setStatus: (_id: string, status: string) => { state.items.overview.status = status; },
    api: (path: string) => { calls.push(path); return path.startsWith("/api/show/") ? check : { ready: true }; },
    // Any attempted iframe replacement fails this healthy-session test.
    document: { createElement: () => { throw new Error("Dashboard was unnecessarily reloaded"); } },
  }) as (id: string) => Promise<void>;
  const opening = openDemo("overview");
  await openDemo("overview");
  expect(calls).toEqual(["/api/show/overview"]);
  finish({ session: "existing", tabUrl: iframe.src });
  await opening;
  expect(calls).toEqual(["/api/show/overview", "/api/ready/existing"]);
  expect(state.items.overview).toEqual({ status: "live", opening: false });
});

test("country search matches names and codes, ignores accents, and excludes selected chips", () => {
  const search = script.slice(script.indexOf("function matchingCountries("), script.indexOf("function countryResults("));
  const countries = [
    { code: "BRA", name: "Brazil" },
    { code: "CIV", name: "Côte d’Ivoire" },
    { code: "USA", name: "United States" },
  ];
  const find = (query: string, selected: string[] = []) => runInNewContext(
    `${search}; matchingCountries(countries, selected, query).map(c => c.code);`,
    { countries, selected, query },
  );
  expect(find("  bRaZ  ")).toEqual(["BRA"]);
  expect(find("usa")).toEqual(["USA"]);
  expect(find("cote")).toEqual(["CIV"]);
  expect(find("", ["BRA", "USA"])).toEqual(["CIV"]);
  expect(find("not a country")).toEqual([]);
});

test("country additions respect the limit, avoid duplicates, and leave the applied scope untouched", () => {
  const add = script.slice(script.indexOf("function addCountry("), script.indexOf("function removeCountry("));
  const countries = Array.from({ length: 11 }, (_, i) => ({ code: `C${i}`, name: `Country ${i}` }));
  const countryPicker = { selected: countries.slice(0, 9).map(c => c.code), active: 0 };
  const applied = { countries: ["C0"], from: 2000, to: 2020 };
  const state = { owid: { countries }, owidAnalysis: { scope: applied }, owidDirty: false };
  const input = { disabled: false, value: "C9", focus() {} };
  const addCode = runInNewContext(`${add}; addCountry;`, {
    countryPicker, state, $: () => input, renderCountryPicker() {}, setCountryMenu() {},
    markOwidScopeDirty: () => { state.owidDirty = true; },
  }) as (code: string) => boolean;
  expect(addCode("C0")).toBe(false);
  expect(addCode("invalid")).toBe(false);
  expect(state.owidDirty).toBe(false);
  expect(addCode("C9")).toBe(true);
  expect(countryPicker.selected).toHaveLength(10);
  expect(input.value).toBe("");
  expect(state.owidDirty).toBe(true);
  expect(addCode("C10")).toBe(false);
  expect(state.owidAnalysis.scope).toEqual({ countries: ["C0"], from: 2000, to: 2020 });
});

test("a source switch while chat creation is pending cannot retarget the submitted question", async () => {
  const sendCode = script.slice(script.indexOf("async function send(text)"), script.indexOf("async function readEvents("));
  const state = { source: "owid", owidAnalysis: { scope: { countries: ["CAN", "USA"], from: 2000, to: 2020 }, snapshotId: "original-data" } };
  const chat = { id: null as string | null, busy: false, context: [{ id: "owid-life-expectancy", name: "Life expectancy" }], files: [] };
  const node = { value: "", hidden: false, textContent: "", querySelector: () => null, append() {}, insertBefore() {}, remove() {} };
  let resolveCreate!: (value: { id: string }) => void;
  const create = new Promise<{ id: string }>((resolve) => { resolveCreate = resolve; });
  let submitted: Record<string, unknown> | undefined;
  const answering = runInNewContext(`${sendCode}; send('Which country leads?');`, {
    state, chat, $: () => node, uploading: () => false, owidReady: () => true,
    resetOwidChart() {}, stopDictation() {}, setBusy: (v: boolean) => { chat.busy = v; },
    autosize() {}, renderFiles() {}, setEmpty() {}, appendUser() {}, workingEl: () => node, scrollDown() {}, shortTitle: (s: string) => s,
    api: () => create, renderChatList() {}, readEvents: async () => {},
    fetch: async (_url: string, request: { body: string }) => { submitted = JSON.parse(request.body); return new Response(""); },
  });
  // The user switches sources while the first request is awaiting its new chat ID.
  state.source = "tableau";
  state.owidAnalysis = { scope: { countries: ["JPN"], from: 2015, to: 2020 }, snapshotId: "different-data" };
  chat.context = [{ id: "overview", name: "Superstore Overview" }];
  resolveCreate({ id: "test-chat" });
  await answering;
  expect(submitted).toEqual({
    text: "Which country leads?", source: "owid", context: ["owid-life-expectancy"], files: [],
    owidScope: { countries: ["CAN", "USA"], from: 2000, to: 2020 }, snapshotId: "original-data",
  });
});
