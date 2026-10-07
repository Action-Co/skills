/**
 * derive-utils.test.ts — pure-function tests for the host-free slug helpers,
 * plus a drift guard against scripts/derive-workbook.js.
 *
 * derive-workbook.js is an eval script (run as a string in the browser page)
 * and cannot import modules, so it carries inline copies of viewSlugFromUrl /
 * nameSlug. The canonical implementations live in scripts/derive-utils.ts and
 * are tested here; the drift guard extracts the inline copies from the eval
 * script and asserts they behave identically on every case.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nameSlug, viewSlugFromUrl } from "../../plugins/tableau-analytics/skills/tableau-semantics/scripts/derive-utils.ts";

// Tests live outside the shipped skill (repo-root tests/) so they are not
// distributed with it. Run from the repo root: `bun test tests/tableau-semantics`.
const SCRIPTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "plugins",
  "tableau-analytics",
  "skills",
  "tableau-semantics",
  "scripts"
);

const SLUG_CASES: Array<[string | null | undefined, string]> = [
  // public /views/ embed URL → host-free slug
  ["https://public.tableau.com/views/Superstore/Overview", "Superstore/Overview"],
  // query string is stripped
  [
    "https://public.tableau.com/views/Superstore-Overview_17909191002920/Overview?language=en-US&publish=yes&:sid=&:redirect=auth",
    "Superstore-Overview_17909191002920/Overview",
  ],
  // private Cloud site: host + /t/<site>/ are stripped, only the /views/ path remains
  [
    "https://tableau.example.com/t/mysite/views/Superstore/CommissionModel",
    "Superstore/CommissionModel",
  ],
  // trailing slash is trimmed
  ["https://public.tableau.com/views/Superstore/Shipping/", "Superstore/Shipping"],
  // not a /views/ URL (e.g. the share-link profile form) — the CLI normalizes
  // to /views/ before it ever becomes the embed src, so no slug is derivable
  [
    "https://public.tableau.com/app/profile/stprice/viz/Superstore-Performance_17909203588290/Performance?publish=yes",
    "",
  ],
  [null, ""],
  [undefined, ""],
];

const NAME_SLUG_CASES: Array<[string | null | undefined, string]> = [
  ["Overview", "Overview"],
  ["Commission Model", "CommissionModel"],
  ["What If Forecast", "WhatIfForecast"],
  ["Superstore", "Superstore"],
  [null, ""],
  [undefined, ""],
];

test("viewSlugFromUrl extracts the host-free /views/ path", () => {
  for (const [input, expected] of SLUG_CASES) {
    expect(viewSlugFromUrl(input), `viewSlugFromUrl(${JSON.stringify(input)})`).toBe(expected);
  }
});

test("nameSlug slugifies names the way Tableau URLs do (spaces removed)", () => {
  for (const [input, expected] of NAME_SLUG_CASES) {
    expect(nameSlug(input), `nameSlug(${JSON.stringify(input)})`).toBe(expected);
  }
});

test("derive-workbook.js inline copies behave identically (drift guard)", () => {
  const src = readFileSync(join(SCRIPTS, "derive-workbook.js"), "utf8");

  const inline = <T>(fnName: string): ((...args: unknown[]) => T) => {
    const m = src.match(new RegExp(`function ${fnName}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    if (!m) {
      throw new Error(`derive-workbook.js is missing the inline ${fnName} copy`);
    }
    // eslint-disable-next-line no-new-func
    return new Function(`return (${m[0]})`)() as (...args: unknown[]) => T;
  };

  const inlineViewSlug = inline<string>(viewSlugFromUrl.name);
  const inlineNameSlug = inline<string>(nameSlug.name);

  for (const [input, expected] of SLUG_CASES) {
    expect(inlineViewSlug(input)).toBe(expected);
    expect(inlineViewSlug(input)).toBe(viewSlugFromUrl(input));
  }
  for (const [input, expected] of NAME_SLUG_CASES) {
    expect(inlineNameSlug(input)).toBe(expected);
    expect(inlineNameSlug(input)).toBe(nameSlug(input));
  }
});