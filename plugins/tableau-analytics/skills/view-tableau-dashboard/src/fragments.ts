/**
 * fragments.ts — merge a workflow step's fragment results into one card value.
 *
 * A step may run several scripts (or one script in `batches`); each fragment's
 * value is merged here. Array values concatenate, scalar values take the first
 * non-undefined entry, and completeness is CONSERVATIVE: one incomplete
 * fragment makes the merged result incomplete, so an earlier `complete: true`
 * can never mask a later `complete: false`.
 */
export function mergeFragments(fragments: unknown[]): unknown {
  if (fragments.length === 0) return undefined;
  if (fragments.length === 1) return fragments[0];
  if (fragments.every((f) => Array.isArray(f))) {
    return (fragments as unknown[][]).flat();
  }
  const out: Record<string, unknown> = {};
  for (const f of fragments) {
    if (!f || typeof f !== "object" || Array.isArray(f)) continue;
    for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        const prev = out[k];
        out[k] = Array.isArray(prev) ? [...prev, ...v] : [...v];
      } else if (out[k] === undefined) {
        out[k] = v;
      }
    }
  }
  const objects = fragments.filter(
    (f): f is Record<string, unknown> =>
      !!f && typeof f === "object" && !Array.isArray(f)
  );
  if (
    objects.some((f) => f.complete === false) &&
    Object.prototype.hasOwnProperty.call(out, "complete")
  ) {
    out.complete = false;
    const note = objects
      .map((f) => f.note)
      .find((n) => typeof n === "string" && n.length);
    if (typeof note === "string") out.note = note;
  }
  return out;
}
