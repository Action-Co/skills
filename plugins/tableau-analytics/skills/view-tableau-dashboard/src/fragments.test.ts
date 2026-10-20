import { expect, test } from "bun:test";
import { mergeFragments } from "./fragments.ts";

test("concatenates all-array fragments", () => {
  expect(mergeFragments([[1, 2], [3]])).toEqual([1, 2, 3]);
});

test("concatenates array-valued keys across object fragments", () => {
  expect(mergeFragments([{ rows: [1] }, { rows: [2] }])).toEqual({ rows: [1, 2] });
});

test("completeness is conservative — a later incomplete fragment wins", () => {
  const merged = mergeFragments([
    { complete: true, states: [1] },
    { complete: false, note: "capped", states: [2] },
  ]) as Record<string, unknown>;
  expect(merged.complete).toBe(false);
  expect(merged.note).toBe("capped");
  expect(merged.states).toEqual([1, 2]);
});

test("an earlier incomplete fragment also wins over a later complete", () => {
  const merged = mergeFragments([
    { complete: false, note: "first" },
    { complete: true },
  ]) as Record<string, unknown>;
  expect(merged.complete).toBe(false);
  expect(merged.note).toBe("first");
});

test("a single fragment passes through unchanged", () => {
  expect(mergeFragments([{ a: 1 }])).toEqual({ a: 1 });
});
