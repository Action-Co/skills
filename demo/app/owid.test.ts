import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTables, readTable } from "../tools/csv.ts";
import { createOwidSource, DEFAULT_OWID_SCOPE, OWID_CSV_URL, OWID_METADATA_URL, owidEmbedUrl, owidPrompt, owidProvenance, validateOwidScope } from "./owid.ts";

const csv = `Entity,Code,Year,Life expectancy
Canada,CAN,2000,79.233
Canada,CAN,2001,79.4779
Japan,JPN,2000,81.1788
Japan,JPN,2001,
United States,USA,2000,76.8058
United States,USA,2001,77.0256
World,OWID_WRL,2000,67.1
`;
const metadata = JSON.stringify({ columns: { "Period life expectancy at birth": {
  titleShort: "Life expectancy", unit: "years", descriptionShort: "Period life expectancy at birth.",
  citationShort: "Fixture source — with processing by Our World in Data", lastUpdated: "2025-10-22",
} } });

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tabby-owid-test-"));
  try { await run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the applied extract excludes other countries and years and retains numeric precision", () => fixture(async (dir) => {
  const calls: string[] = [];
  const source = createOwidSource(dir, async (url) => {
    calls.push(url); return new Response(url === OWID_CSV_URL ? csv : metadata);
  });
  const info = await source.load();
  const prepared = source.prepare({ countries: ["USA", "CAN"], from: 2000, to: 2001 }, info.snapshotId);
  const contents = readFileSync(prepared.csvPath, "utf8");
  const db = loadTables([readTable(prepared.csvPath, contents)]);
  expect(db.query('SELECT COUNT(*) FROM data').values()).toEqual([[4]]);
  expect(db.query('SELECT DISTINCT Code FROM data ORDER BY Code').values()).toEqual([["CAN"], ["USA"]]);
  const change = db.query('SELECT MAX("Life expectancy (years)") - MIN("Life expectancy (years)") FROM data WHERE Code = \'USA\'').values()[0][0] as number;
  expect(change).toBeCloseTo(0.2198, 8);
  expect(prepared.analysis.limitations).toEqual([]);
  expect(calls.sort()).toEqual([OWID_CSV_URL, OWID_METADATA_URL].sort());
  const embed = new URL(prepared.analysis.embedUrl);
  expect(embed.searchParams.get("country")).toBe("CAN~USA");
  expect(embed.searchParams.get("time")).toBe("2000..2001");
  expect(info.countries.map((c) => c.code)).not.toContain("OWID_WRL");
}));

test("missing observations are preserved as null and reported, never replaced by zero", () => fixture(async (dir) => {
  const source = createOwidSource(dir, async (url) => new Response(url === OWID_CSV_URL ? csv : metadata));
  const info = await source.load();
  const p = source.prepare({ countries: ["JPN"], from: 2000, to: 2001 }, info.snapshotId);
  expect(p.analysis.limitations).toEqual(["Japan: 1 year(s) have no observation in the selected range; do not interpolate or assume zero."]);
  const db = loadTables([readTable(p.csvPath, readFileSync(p.csvPath, "utf8"))]);
  expect(db.query('SELECT "Life expectancy (years)" FROM data WHERE Year = 2001').values()[0][0]).toBeNull();
  expect(() => source.prepare({ countries: ["JPN"], from: 2001, to: 2001 }, info.snapshotId)).toThrow("No observations");
  expect(owidProvenance(p.analysis)).toContain("Data limitations");
}));

test("refresh creates a new immutable snapshot while old questions retain their data", () => fixture(async (dir) => {
  let changed = false;
  let calls = 0;
  const source = createOwidSource(dir, async (url) => {
    calls++; return new Response(url === OWID_CSV_URL ? changed ? csv.replace("76.8058", "70") : csv : metadata);
  });
  const [info, same] = await Promise.all([source.load(), source.load()]);
  expect(info.snapshotId).toBe(same.snapshotId);
  expect(calls).toBe(2);
  const scope = { countries: ["USA"], from: 2000, to: 2000 };
  const old = source.prepare(scope, info.snapshotId);
  changed = true;
  const fresh = await source.load(true);
  expect(fresh.snapshotId).not.toBe(info.snapshotId);
  const next = source.prepare(scope, fresh.snapshotId);
  expect(readFileSync(old.csvPath, "utf8")).toContain("76.8058");
  expect(readFileSync(next.csvPath, "utf8")).toContain('"70"');
  expect(owidPrompt(old, "/demo/tabby-csv.sh")).toContain(old.csvPath);
  expect(owidPrompt(old, "/demo/tabby-csv.sh")).not.toContain(next.csvPath);
}));

test("invalid scopes and unknown snapshots fail before any arbitrary fetch", () => fixture(async (dir) => {
  for (const scope of [null, {}, { countries: [], from: 2000, to: 2001 },
    { countries: ["USA", "USA"], from: 2000, to: 2001 },
    { countries: ["https://example.com"], from: 2000, to: 2001 },
    { countries: ["USA"], from: "2000", to: 2001 },
    { countries: ["USA"], from: 2001, to: 2000 }]) {
    expect(() => validateOwidScope(scope)).toThrow();
  }
  const source = createOwidSource(dir, async (url) => new Response(url === OWID_CSV_URL ? csv : metadata));
  const info = await source.load();
  expect(() => source.prepare(DEFAULT_OWID_SCOPE, "../../outside")).toThrow("snapshot");
  expect(() => source.prepare({ countries: ["ZZZ"], from: 2000, to: 2001 }, info.snapshotId)).toThrow("country code");
  expect(() => source.prepare({ countries: ["USA"], from: 2000, to: 2020 }, info.snapshotId)).toThrow("2000–2001");
  expect(new URL(owidEmbedUrl(DEFAULT_OWID_SCOPE)).hostname).toBe("ourworldindata.org");
}));

test("network, schema drift, duplicate observations and oversized responses fail explicitly", () => fixture(async (dir) => {
  const cases = [
    async () => new Response("Denied", { status: 403 }),
    async (url: string) => new Response(url === OWID_CSV_URL ? csv : metadata.replace('"years"', '"percent"')),
    async (url: string) => new Response(url === OWID_CSV_URL ? csv + "United States,USA,2000,99\n" : metadata),
    async (url: string) => new Response(url === OWID_CSV_URL ? csv : "x".repeat(1024 * 1024 + 1)),
    async () => { throw new Error("Network unavailable"); },
  ];
  for (const fetchData of cases) await expect(createOwidSource(dir, fetchData).load()).rejects.toThrow();
}));
