import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorldBankSource, WORLD_BANK_COLUMN, WORLD_BANK_INDICATOR, worldBankPrompt, worldBankProvenance } from "./world-bank.ts";
import { loadTables, readTable } from "../tools/csv.ts";

const metric = { id: WORLD_BANK_INDICATOR, name: WORLD_BANK_COLUMN, source: { id: "2" }, sourceNote: "GDP per person in constant 2015 US dollars.", sourceOrganization: "World Bank and national accounts sources" };
const countries = [
  { id: "CAN", name: "Canada", region: { id: "NAC" } },
  { id: "JPN", name: "Japan", region: { id: "EAS" } },
  { id: "USA", name: "United States", region: { id: "NAC" } },
  { id: "WLD", name: "World", region: { id: "NA" } },
];
const row = (code: string, year: number, value: number | null) => ({ countryiso3code: code, date: String(year), value, indicator: { id: WORLD_BANK_INDICATOR } });
const observations = [row("CAN", 2000, 30000.1234), row("CAN", 2001, 31000.5678), row("JPN", 2000, 35000), row("JPN", 2001, null), row("USA", 2000, 40000), row("USA", 2001, 41000), row("WLD", 2000, 10000)];
const envelope = (records: unknown[], extra = {}) => new Response(JSON.stringify([{ page: 1, pages: 1, total: records.length, lastupdated: "2026-11-11", ...extra }, records]));

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tabby-wb-"));
  try { await run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function api(rows = observations) {
  return async (url: string) => url.includes("/country?") ? envelope(countries)
    : url.includes("/country/all/") ? envelope(rows) : envelope([metric]);
}

test("World Bank chart and SQL extract share exactly the applied country/year values and precision", () => fixture(async dir => {
  const source = createWorldBankSource(dir, api());
  const info = await source.load();
  expect(info.countries.map(c => c.code)).not.toContain("WLD");
  const prepared = source.prepare({ countries: ["CAN", "USA"], from: 2000, to: 2001 }, info.snapshotId);
  const a = prepared.analysis;
  expect(a.rows).toBe(4);
  expect(a.observations.map(r => r.code)).toEqual(["CAN", "CAN", "USA", "USA"]);
  const csv = readFileSync(prepared.csvPath, "utf8");
  const db = loadTables([readTable(prepared.csvPath, csv)]);
  const delta = db.query(`SELECT MAX("${WORLD_BANK_COLUMN}") - MIN("${WORLD_BANK_COLUMN}") FROM data WHERE Code = 'CAN'`).values()[0][0] as number;
  expect(delta).toBeCloseTo(1000.4444, 8);
  expect(a.observations[0].value).toBe(30000.1234);
  expect(a.limitations).toEqual([]);
  expect(worldBankPrompt(prepared, "/demo/csv.sh")).toContain(prepared.csvPath);
  expect(worldBankProvenance(a)).toContain("constant 2015 US$");
}));

test("World Bank missing observations remain null in the chart and SQL, with no fabricated endpoints", () => fixture(async dir => {
  const source = createWorldBankSource(dir, api());
  const info = await source.load();
  const p = source.prepare({ countries: ["JPN"], from: 2000, to: 2001 }, info.snapshotId);
  expect(p.analysis.observations[1].value).toBeNull();
  expect(p.analysis.limitations[0]).toContain("1 year(s)");
  const csv = readFileSync(p.csvPath, "utf8");
  const db = loadTables([readTable(p.csvPath, csv)]);
  expect(db.query(`SELECT "${WORLD_BANK_COLUMN}" FROM data WHERE Year = 2001`).values()[0][0]).toBeNull();
  expect(() => source.prepare({ countries: ["JPN"], from: 2001, to: 2001 }, info.snapshotId)).toThrow("No observations");
}));

test("World Bank pagination is complete and rejects updates between pages", () => fixture(async dir => {
  let change = false;
  const source = createWorldBankSource(dir, async url => {
    if (!url.includes("/country/all/")) return api()(url);
    const page = Number(new URL(url).searchParams.get("page"));
    return envelope(page === 1 ? observations.slice(0, 3) : observations.slice(3), {
      page, pages: 2, total: observations.length, lastupdated: change && page === 2 ? "2026-11-12" : "2026-11-11",
    });
  });
  const info = await source.load();
  expect(source.prepare({ countries: ["USA"], from: 2000, to: 2001 }, info.snapshotId).analysis.rows).toBe(2);
  change = true;
  await expect(source.load(true)).rejects.toThrow("changed while downloading");
}));

test("World Bank refresh retains old snapshots and rejects wrong scopes and metadata drift", () => fixture(async dir => {
  let updated = false;
  const source = createWorldBankSource(dir, url => api(updated ? observations.map(r => r.countryiso3code === "USA" ? { ...r, value: 9 } : r) : observations)(url));
  const info = await source.load();
  const scope = { countries: ["USA"], from: 2000, to: 2001 };
  const old = source.prepare(scope, info.snapshotId);
  updated = true;
  const next = await source.load(true);
  expect(next.snapshotId).not.toBe(info.snapshotId);
  expect(source.prepare(scope, next.snapshotId).analysis.observations[0].value).toBe(9);
  expect(source.prepare(scope, info.snapshotId).analysis.observations[0].value).toBe(40000);
  expect(readFileSync(old.csvPath, "utf8")).toContain('"40000"');
  for (const invalid of [null, { countries: [], from: 2000, to: 2001 }, { countries: ["USA", "USA"], from: 2000, to: 2001 }, { countries: ["https://example.com"], from: 2000, to: 2001 }]) expect(() => source.prepare(invalid, info.snapshotId)).toThrow();
  expect(() => source.prepare({ ...scope, countries: ["WLD"] }, info.snapshotId)).toThrow("country code");
  expect(() => source.prepare(scope, "../../snapshot")).toThrow("snapshot");
  expect(() => source.prepare({ ...scope, from: 1999 }, info.snapshotId)).toThrow("covers");
  const changed = createWorldBankSource(dir, async url => url.includes("/indicator/NY.GDP.PCAP.KD?") && !url.includes("/country/") ? envelope([{ ...metric, name: "GDP per capita (current US$)" }]) : api()(url));
  await expect(changed.load()).rejects.toThrow("definition or units");
}));

test("World Bank fails explicitly on API errors, duplicates, incomplete pages and oversized responses", () => fixture(async dir => {
  for (const fetchData of [
    async () => new Response("Down", { status: 503 }),
    async () => new Response(JSON.stringify([{ message: [{ id: "120" }] }])),
    api([...observations, observations[0]]),
    async (url: string) => url.includes("/country/all/") ? envelope(observations, { total: observations.length + 1 }) : api()(url),
    async () => new Response("x".repeat(8 * 1024 * 1024 + 1)),
  ]) await expect(createWorldBankSource(dir, fetchData).load()).rejects.toThrow();
}));
