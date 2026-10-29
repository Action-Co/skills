// Run with: bun test demo/tools

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headerNames, inferType, loadTables, parseCsv, readTable, tableName, toDate, toNumber } from "./csv.ts";

describe("parseCsv", () => {
  test("quoted fields, escaped quotes, CRLF and a BOM", () => {
    const text = '﻿name,note\r\n"Smith, J","said ""hi"""\r\nLee,"two\nlines"\r\n';
    expect(parseCsv(text)).toEqual([["name", "note"], ["Smith, J", 'said "hi"'], ["Lee", "two\nlines"]]);
  });
  test("semicolon and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  test("skips blank lines, keeps a last line without a newline", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

test("headerNames fills blanks and numbers duplicates", () => {
  expect(headerNames(["Sales", "", "sales", "Sales"])).toEqual(["Sales", "column_2", "sales_2", "Sales_3"]);
});

test("toNumber reads money, percentages and accounting negatives", () => {
  expect(toNumber("$1,234.50")).toBe(1234.5);
  expect(toNumber("(12.5)")).toBe(-12.5);
  expect(toNumber("-3%")).toBe(-3);
  expect(toNumber("1.2e3")).toBe(1200);
  expect(toNumber("02139")).toBeNull(); // ZIP code stays text
  expect(toNumber("abc")).toBeNull();
});

test("toDate reads ISO and slashed dates", () => {
  expect(toDate("2024-03-31", false)).toBe("2024-03-31");
  expect(toDate("3/31/2024", false)).toBe("2024-03-31");
  expect(toDate("31/03/24", true)).toBe("2024-03-31");
  expect(toDate("13/13/2024", false)).toBeNull();
});

test("inferType", () => {
  expect(inferType(["1", "2.5", ""])).toBe("number");
  expect(inferType(["1/2/2024", "25/2/2024"])).toBe("date");
  expect(inferType(["East", "2"])).toBe("text");
});

test("tableName", () => {
  expect(tableName("/x/Sales Targets-2024.csv")).toBe("sales_targets_2024");
  expect(tableName("2024.csv")).toBe("t_2024");
});

test("loadTables queries typed columns, with data as an alias for one file", () => {
  const t = readTable("targets.csv", "Region,Target,Month\nEast,\"$1,000\",1/31/2024\nWest,500,2/29/2024\n");
  const db = loadTables([t]);
  expect(db.query("SELECT SUM(Target) s FROM data").get()).toEqual({ s: 1500 });
  expect(db.query("SELECT strftime('%m', Month) m FROM targets WHERE Region = 'West'").get()).toEqual({ m: "02" });
});

describe("tabby-csv.sh", () => {
  const dir = mkdtempSync(join(tmpdir(), "tabby-csv-"));
  const file = join(dir, "sales.csv");
  writeFileSync(file, "Region,Sales\nEast,100\nWest,250\nEast,50\n");
  const run = (...args: string[]) => {
    const p = Bun.spawnSync(["bash", join(import.meta.dir, "tabby-csv.sh"), ...args]);
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  };

  test("describe", () => {
    const r = run("describe", file);
    expect(r.code).toBe(0);
    expect(r.out).toContain("3 rows, 2 columns");
    expect(r.out).toContain("| Sales | number | 3 | 0 | min 50, max 250, sum 400, avg 133.3333 |");
  });
  test("sql", () => {
    const r = run("sql", file, "SELECT Region, SUM(Sales) total FROM data GROUP BY 1 ORDER BY 2 DESC");
    expect(r.code).toBe(0);
    expect(r.out).toContain("| West | 250 |\n| East | 150 |");
  });
  test("sql refuses anything but one SELECT", () => {
    expect(run("sql", file, "DELETE FROM data").err).toContain("only SELECT");
    expect(run("sql", file, "SELECT 1; SELECT 2").err).toContain("one query");
    expect(run("sql", file, "SELECT load_extension('/tmp/x')").err).toContain("isn't allowed");
  });
});
