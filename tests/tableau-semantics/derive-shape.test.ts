/**
 * derive-shape.test.ts — the semantic-model shape contract.
 *
 * Every shipped derived model must come back in the shape the skills promise:
 * host-free slug + full canonical URL, placeholder notes for the identity /
 * freshness fields the Embedding-only pass cannot fill, and complete
 * structure (sheets, zones, visible controls, parameters, filters with
 * selection actions + applied). A future shape change fails here instead of
 * silently shipping a malformed model.
 *
 * The canon is the 8 Tableau Public Superstore views; legacy examples were
 * removed (we only keep the public Superstore).
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { viewSlugFromUrl } from "../../plugins/tableau-analytics/skills/tableau-semantics/scripts/derive-utils.ts";

// Tests live outside the shipped skill (repo-root tests/) so they are not
// distributed with it. Run from the repo root: `bun test tests/tableau-semantics`.
const SKILL = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "plugins",
  "tableau-analytics",
  "skills",
  "tableau-semantics"
);
const WORKBOOKS = join(SKILL, "your-site", "workbooks", "SUPERSTORE");

const VIEWS = [
  "Overview",
  "CommissionModel",
  "Performance",
  "Shipping",
  "Product",
  "WhatIfForecast",
  "Customers",
  "OrderDetails",
];

type Derived = {
  schema_version?: string;
  asset?: {
    type?: string;
    name?: string;
    url?: string | null;
    urlSlug?: string;
    luid?: string | null;
    site?: string | null;
    owner?: string | null;
    note?: string;
  };
  freshness?: { anchor?: string | null; retrievedAt?: string; source?: string; note?: string };
  structure?: {
    sheets?: Array<{ name?: string; url?: string; type?: string; index?: number }>;
    dashboards?: unknown[];
    zones?: unknown[];
    visibleControls?: { note?: string; controls?: unknown[] };
    parameters?: unknown[];
    filters?: { note?: string; selectionActions?: unknown[]; applied?: unknown[] };
    error?: unknown;
  };
  datasource?: { name?: string; id?: string; fullSchemaFieldCount?: number } | null;
  fields?: Array<{ name?: string }>;
  lineage?: { upstreamDatasources?: Array<{ name?: string }>; downstreamWorkbooks?: unknown[] };
  samples?: { note?: string; fieldDomainSamples?: Record<string, unknown> };
  _meta?: { derivationSource?: string; worksheets?: string[]; note?: string };
  error?: unknown;
};

function load(view: string): Derived {
  const file = join(WORKBOOKS, `SUPERSTORE.${view}.derived.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Derived;
}

for (const view of VIEWS) {
  test(`SUPERSTORE.${view}.derived.json matches the semantic-model contract`, () => {
    const m = load(view);
    const where = `SUPERSTORE.${view}.derived.json`;

    // --- identity: full URL + host-free slug + placeholder note --------------
    expect(m.schema_version, `${where}: schema_version`).toBe("1.0");
    expect(m.asset?.type, `${where}: asset.type`).toBe("workbook");
    expect(typeof m.asset?.name === "string" && m.asset.name.length > 0, `${where}: asset.name`).toBe(true);
    expect(m.asset?.url, `${where}: asset.url is the full canonical URL`).toMatch(
      /^https:\/\/public\.tableau\.com\/views\/.+/
    );
    // urlSlug is exactly the host-free /views/ path of the full URL.
    expect(m.asset?.urlSlug, `${where}: asset.urlSlug`).toBe(
      viewSlugFromUrl(String(m.asset?.url))
    );
    // Example-model placeholder notes: a real environment populates these.
    expect(m.asset?.note ?? "", `${where}: asset.note placeholder`).toContain("populate");
    expect(m.freshness?.note ?? "", `${where}: freshness.note placeholder`).toContain("populate");

    // --- freshness -----------------------------------------------------------
    expect(m.freshness?.anchor, `${where}: freshness.anchor`).toBeNull(); // Public: no REST catalog
    expect(typeof m.freshness?.retrievedAt === "string" && m.freshness.retrievedAt.length > 0, `${where}: retrievedAt`).toBe(true);

    // --- structure: sheets, zones, controls, parameters, filters ------------
    expect(Array.isArray(m.structure?.sheets), `${where}: structure.sheets`).toBe(true);
    for (const sheet of m.structure?.sheets ?? []) {
      expect(typeof sheet.name === "string" && sheet.name.length > 0, `${where}: sheet.name`).toBe(true);
      expect(sheet.url ?? "", `${where}: sheet.url is a public canonical URL`).toMatch(
        /^https:\/\/public\.tableau\.com\/views\/.+/
      );
    }
    expect(Array.isArray(m.structure?.zones), `${where}: structure.zones`).toBe(true);
    expect(m.structure?.visibleControls?.controls, `${where}: visibleControls.controls`).toBeDefined();
    expect(Array.isArray(m.structure?.parameters), `${where}: structure.parameters`).toBe(true);
    const filters = m.structure?.filters;
    expect(filters, `${where}: structure.filters`).toBeDefined();
    expect(Array.isArray(filters?.selectionActions), `${where}: filters.selectionActions`).toBe(true);
    expect(Array.isArray(filters?.applied), `${where}: filters.applied`).toBe(true);
    expect(m.structure?.error ?? m.error, `${where}: no derivation error`).toBeUndefined();

    // --- datasource / fields / lineage / samples / meta ---------------------
    expect(typeof m.datasource?.name === "string" && (m.datasource.name?.length ?? 0) > 0, `${where}: datasource.name`).toBe(true);
    expect(Array.isArray(m.fields), `${where}: fields`).toBe(true);
    for (const f of m.fields ?? []) {
      expect(typeof f.name === "string" && f.name.length > 0, `${where}: field.name`).toBe(true);
    }
    expect(Array.isArray(m.lineage?.upstreamDatasources), `${where}: lineage.upstreamDatasources`).toBe(true);
    expect(typeof m.samples?.note === "string", `${where}: samples.note`).toBe(true);
    expect(typeof m._meta?.derivationSource === "string" && (m._meta.derivationSource?.includes("view-tableau-dashboard") ?? false), `${where}: _meta.derivationSource`).toBe(true);
    expect(Array.isArray(m._meta?.worksheets), `${where}: _meta.worksheets`).toBe(true);
  });
}

test("the workbook canon is exactly the 8 public Superstore views (no legacy examples)", () => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(WORKBOOKS).filter((f) => f.endsWith(".derived.json")).sort();
  expect(files).toEqual(
    VIEWS.map((v) => `SUPERSTORE.${v}.derived.json`).sort()
  );
});