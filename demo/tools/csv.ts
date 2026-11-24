// CSV files for Ask Tabby: parsing, column types, and loading into SQLite.
// Shared by the demo app's upload endpoint (row and column counts) and the
// tabby-csv tool the agent uses to analyze attached files.

import { Database } from "bun:sqlite";
import { basename } from "node:path";

export type ColumnType = "number" | "date" | "text";
export type Column = { name: string; type: ColumnType };
export type Table = { name: string; file: string; columns: Column[]; rows: (string | number | null)[][] };

// RFC 4180: quoted fields, "" inside quotes, CRLF or LF line ends. The
// delimiter is a comma, semicolon or tab, whichever the header line uses most.
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function detectDelimiter(text: string): string {
  const first = text.slice(0, text.search(/\r?\n|$/)).replace(/"[^"]*"/g, "");
  let best = ",";
  let most = 0;
  for (const d of [",", ";", "\t"]) {
    const n = first.split(d).length - 1;
    if (n > most) { best = d; most = n; }
  }
  return best;
}

// Header names: blanks become column_N, duplicates get _2, _3…
export function headerNames(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((h, i) => {
    let name = h.trim() || `column_${i + 1}`;
    const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), n);
    if (n > 1) name = `${name}_${n}`;
    return name;
  });
}

// Numbers as people write them: 1,234.50  $99  (12.5)  -3%  1.2e3
const NUMBER = /^[-+]?\(?[-+]?[$€£]?\s*(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?\)?%?$/;
export function toNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s || !NUMBER.test(s) || !/\d/.test(s)) return null;
  // Codes with leading zeros (ZIP codes, account numbers) stay text.
  if (/^0\d/.test(s.replace(/^[-+$€£(\s]+/, ""))) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^\(/, ""));
  const n = Number(s.replace(/[^\d.eE+-]/g, "").replace(/^[-+]/, ""));
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

// Dates: ISO (2024-03-31, optional time) or slashed (3/31/2024, 31/03/2024).
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})([T ]\d{1,2}:\d{2}(:\d{2})?)?$/;
const SLASHED = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;
function dayFirst(values: string[]): boolean {
  // Slashed dates are month-first unless the first part is ever over 12.
  return values.some((v) => { const m = v.trim().match(SLASHED); return !!m && Number(m[1]) > 12; });
}
export function toDate(raw: string, dmy: boolean): string | null {
  const s = raw.trim();
  let y: number, mo: number, d: number, time = "";
  let m = s.match(ISO);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; time = m[4] ? " " + m[4].trim().replace("T", "") : ""; }
  else if ((m = s.match(SLASHED))) {
    [mo, d] = dmy ? [+m[2], +m[1]] : [+m[1], +m[2]];
    y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}${time}`;
}

// A column is a number or a date when every non-empty value is one.
export function inferType(values: string[]): ColumnType {
  const filled = values.filter((v) => v.trim() !== "");
  if (!filled.length) return "text";
  if (filled.every((v) => toNumber(v) !== null)) return "number";
  const dmy = dayFirst(filled);
  if (filled.every((v) => toDate(v, dmy) !== null)) return "date";
  return "text";
}

// SQL table name from a file name: sales-2024.csv -> sales_2024
export function tableName(file: string): string {
  const stem = basename(file).replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(stem) ? stem : `t_${stem || "data"}`;
}

export function readTable(file: string, text: string): Table {
  const parsed = parseCsv(text);
  if (!parsed.length) return { name: tableName(file), file, columns: [], rows: [] };
  const names = headerNames(parsed[0]);
  const body = parsed.slice(1);
  const columns: Column[] = names.map((name, j) => ({ name, type: inferType(body.map((r) => r[j] ?? "")) }));
  const dmy = columns.map((c, j) => c.type === "date" && dayFirst(body.map((r) => r[j] ?? "")));
  const rows = body.map((r) =>
    columns.map((c, j) => {
      const v = (r[j] ?? "").trim();
      if (v === "") return null;
      if (c.type === "number") return toNumber(v);
      if (c.type === "date") return toDate(v, dmy[j]);
      return v;
    })
  );
  return { name: tableName(file), file, columns, rows };
}

export const quoteId = (name: string) => `"${name.replace(/"/g, '""')}"`;

// Loads tables into an in-memory database. Numbers are REAL, dates are ISO
// text (so they sort and work with strftime), everything else is TEXT.
export function loadTables(tables: Table[]): Database {
  const db = new Database(":memory:");
  const used = new Set<string>();
  for (const t of tables) {
    let name = t.name;
    for (let n = 2; used.has(name); n++) name = `${t.name}_${n}`;
    used.add(name);
    t.name = name;
    const cols = t.columns.map((c) => `${quoteId(c.name)} ${c.type === "number" ? "REAL" : "TEXT"}`);
    db.run(`CREATE TABLE ${quoteId(name)} (${cols.join(", ")})`);
    if (!t.columns.length) continue;
    const insert = db.prepare(`INSERT INTO ${quoteId(name)} VALUES (${t.columns.map(() => "?").join(", ")})`);
    db.transaction(() => { for (const r of t.rows) insert.run(...r); })();
  }
  // One file: it's also available as "data".
  if (tables.length === 1) db.run(`CREATE VIEW data AS SELECT * FROM ${quoteId(tables[0].name)}`);
  return db;
}
