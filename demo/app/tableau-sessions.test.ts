import { expect, test } from "bun:test";
import { createTableauSessionLoader, type TableauSession } from "./tableau-sessions.ts";

const demo = { id: "overview", url: "https://public.tableau.com/views/Superstore/Overview", script: "overview-state-ranking" };
const old = { session: "old-session", tabUrl: "http://127.0.0.1:3000/?session=old-session" };
const fresh = { session: "new-session", tabUrl: "http://127.0.0.1:3000/?session=new-session" };
const ok = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

test("healthy and in-progress Tableau sessions are reused without resetting their filters", async () => {
  for (const state of ["interactive", "loading", "connecting", "auth"]) {
    const cache = new Map([[demo.id, old]]);
    const calls: string[][] = [];
    const load = createTableauSessionLoader(cache, async (args) => { calls.push(args); return ok({ state }); });
    expect(await load(demo)).toBe(old);
    expect(calls).toEqual([["status", "--session", old.session, "-f", "json"]]);
  }
});

test("missing, disconnected, failed and unreadable cached Tableau sessions are replaced", async () => {
  for (const reply of [ok({ state: "disconnected" }), ok({ state: "error" }),
    { code: 1, stdout: "", stderr: "unknown session" },
    { code: 0, stdout: "invalid reply", stderr: "" }, null]) {
    const cache = new Map([[demo.id, old]]);
    const calls: string[][] = [];
    const load = createTableauSessionLoader(cache, async (args) => {
      calls.push(args);
      if (args[0] === "start") return ok(fresh);
      if (!reply) throw new Error("bridge unavailable");
      return reply;
    });
    expect(await load(demo)).toEqual(fresh);
    expect(cache.get(demo.id)).toEqual(fresh);
    expect(calls[1]).toEqual(["start", "--url", demo.url, "--no-open", "-f", "json", "--script", demo.script]);
  }
});

test("concurrent requests share a replacement session, and a failed start can be retried", async () => {
  const cache = new Map<string, TableauSession>([[demo.id, old]]);
  let starts = 0;
  let fail = true;
  const load = createTableauSessionLoader(cache, async (args) => {
    if (args[0] === "status") return ok({ state: "disconnected" });
    starts++;
    return fail ? { code: 1, stdout: "", stderr: "could not start bridge" } : ok(fresh);
  });
  const first = load(demo);
  expect(load(demo)).toBe(first);
  await expect(first).rejects.toThrow("could not start bridge");
  expect(cache.has(demo.id)).toBe(false);
  fail = false;
  expect(await load(demo)).toEqual(fresh);
  expect(starts).toBe(2);
});

test("Run again replaces a healthy session explicitly", async () => {
  const cache = new Map([[demo.id, old]]);
  const calls: string[][] = [];
  const load = createTableauSessionLoader(cache, async (args) => { calls.push(args); return ok(fresh); });
  expect(await load(demo, true)).toEqual(fresh);
  expect(calls.map(args => args[0])).toEqual(["start"]);
});
