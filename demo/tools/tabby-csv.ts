// tabby-csv: read-only analysis of CSV files attached in Ask Tabby.
//
//   tabby-csv.sh describe <file.csv>...          columns, types and summary stats
//   tabby-csv.sh head <file.csv> [rows]          the first rows (default 10)
//   tabby-csv.sh sql <file.csv>... "<SELECT …>"  query the files with SQLite
//
// Each file is a table named after the file (sales-2024.csv -> sales_2024);
// with one file it's also "data". Quote column names with spaces: "Order Date".
// Numbers are stored as numbers ($1,234 -> 1234; 20% -> 20), dates as
// YYYY-MM-DD text.
// Files are loaded into an in-memory database, so nothing is ever changed.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadTables, quoteId, readTable, type Table } from "./csv.ts";

const MAX_ROWS = 200;

function fail(message: string): never {
  console.error(`tabby-csv: ${message}`);
  process.exit(1);
}

function load(files: string[]): Table[] {
  if (!files.length) fail("name at least one .csv file");
  return files.map((f) => {
    let text: string;
    try { text = readFileSync(f, "utf8"); } catch { fail(`can't read ${f}`); }
    return readTable(f, text);
  });
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 10000) / 10000);
  }
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function markdownTable(head: string[], rows: unknown[][]): string {
  const lines = [`| ${head.map(fmt).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.map(fmt).join(" | ")} |`);
  return lines.join("\n");
}

function describe(files: string[]) {
  const tables = load(files);
  const db = loadTables(tables);
  for (const t of tables) {
    console.log(`## ${basename(t.file)}`);
    console.log(`Table: ${t.name}${tables.length === 1 ? ' (also "data")' : ""}. ${t.rows.length} rows, ${t.columns.length} columns.\n`);
    const out: unknown[][] = [];
    for (const c of t.columns) {
      const q = quoteId(c.name);
      const base = db.query(`SELECT COUNT(${q}), COUNT(DISTINCT ${q}) FROM ${quoteId(t.name)}`).values()[0] as number[];
      const empty = t.rows.length - base[0];
      let summary = "";
      if (c.type === "number") {
        const [min, max, sum, avg] = db.query(`SELECT MIN(${q}), MAX(${q}), SUM(${q}), AVG(${q}) FROM ${quoteId(t.name)}`).values()[0];
        summary = `min ${fmt(min)}, max ${fmt(max)}, sum ${fmt(sum)}, avg ${fmt(avg)}`;
      } else if (c.type === "date") {
        const [min, max] = db.query(`SELECT MIN(${q}), MAX(${q}) FROM ${quoteId(t.name)}`).values()[0];
        summary = `${fmt(min)} to ${fmt(max)}`;
      } else {
        const top = db
          .query(`SELECT ${q}, COUNT(*) n FROM ${quoteId(t.name)} WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY n DESC, 1 LIMIT 3`)
          .values()
          .map(([v, n]) => `${fmt(v).slice(0, 40)} (${n})`);
        summary = top.length ? `most common: ${top.join(", ")}` : "";
      }
      out.push([c.name, c.type, base[1], empty, summary]);
    }
    console.log(markdownTable(["column", "type", "distinct", "empty", "summary"], out));
    console.log("");
  }
}

function head(args: string[]) {
  const [file, n] = args;
  const rows = Math.min(Math.max(Number(n ?? 10) || 10, 1), MAX_ROWS);
  const [t] = load([file]);
  console.log(`${t.rows.length} rows in ${basename(t.file)}; showing ${Math.min(rows, t.rows.length)}.\n`);
  console.log(markdownTable(t.columns.map((c) => c.name), t.rows.slice(0, rows)));
}

// Read-only: one SELECT (or WITH … SELECT). The database is in memory, so the
// only ways to touch disk (ATTACH, VACUUM INTO, extensions) are refused.
function sql(args: string[]) {
  const query = (args.at(-1) ?? "").trim().replace(/;\s*$/, "");
  const files = args.slice(0, -1);
  if (!query || /\.csv$/i.test(query)) fail('the last argument must be the query, for example "SELECT * FROM data LIMIT 5"');
  if (!/^(select|with)\b/i.test(query)) fail("only SELECT queries are allowed");
  if (query.includes(";")) fail("run one query at a time");
  if (/\b(attach|detach|vacuum|pragma|load_extension)\b/i.test(query)) fail("that query isn't allowed");
  const tables = load(files);
  const db = loadTables(tables);
  let stmt;
  try { stmt = db.prepare(query); } catch (err) {
    const known = tables.map((t) => `${t.name} (${t.columns.map((c) => quoteId(c.name)).join(", ")})`).join("; ");
    fail(`${(err as Error).message}. Tables: ${known}`);
  }
  const rows = stmt.values();
  const head = stmt.columnNames;
  console.log(markdownTable(head, rows.slice(0, MAX_ROWS)));
  if (rows.length > MAX_ROWS) console.log(`\n(${rows.length - MAX_ROWS} more rows not shown; add LIMIT or aggregate.)`);
  else console.log(`\n(${rows.length} row${rows.length === 1 ? "" : "s"})`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "describe") describe(args);
else if (cmd === "head") head(args);
else if (cmd === "sql") sql(args);
else fail('use describe <file.csv>..., head <file.csv> [rows], or sql <file.csv>... "<SELECT …>"');
