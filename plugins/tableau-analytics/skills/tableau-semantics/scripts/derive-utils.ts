/**
 * derive-utils.ts — pure helpers for the workbook derivation.
 *
 * These are the CANONICAL, unit-tested implementations. `derive-workbook.js`
 * carries inline copies of the same functions because it is an eval script
 * (run as a string in the browser page) and cannot `import` modules — keep the
 * two in sync. tests/derive-utils.test.ts guards against drift by extracting
 * the inline copies from the eval script and asserting they behave identically.
 */

/** The host-free slug for a view URL: the path after `/views/`, query stripped.
 *  Returns "" when the URL is not a `/views/` embed URL (e.g. a share-link form
 *  the CLI normalizes before it ever becomes the embed src). */
export function viewSlugFromUrl(url: unknown): string {
  const m = /\/views\/([^?#]+)/.exec(String(url ?? ""));
  if (!m) return "";
  return m[1].replace(/\/+$/, "");
}

/** Tableau slugifies sheet/workbook names in URLs by removing spaces. */
export function nameSlug(name: unknown): string {
  return String(name ?? "").replace(/\s+/g, "");
}