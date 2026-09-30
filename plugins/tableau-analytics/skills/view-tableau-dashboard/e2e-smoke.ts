#!/usr/bin/env bun
/**
 * e2e-smoke.ts — end-to-end smoke test of the CLI + bridge without a browser.
 *
 * 1. `start --no-open` spawns the real bridge + writes the session registry.
 * 2. We simulate the embed page over WS (hello, state -> interactive).
 * 3. We run `eval` / `status` / `wait` / `meta` / `scripts` / `ls` / `stop --session`
 *    and assert the CLI behaves.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = dirname(fileURLToPath(import.meta.url));
const CLI = join(SKILL, "src", "cli.ts");
const VIZ_URL = "https://public.tableau.com/views/SOC/SecurityOperationsCentre";

function run(args, opts = {}) {
  const out = spawnSync("bun", [CLI, ...args], {
    encoding: "utf8",
    ...opts,
  });
  if (out.status !== 0) {
    throw new Error(`CLI ${args.join(" ")} failed (${out.status}): ${out.stderr}`);
  }
  return out;
}

/** Async variant — uses real (non-blocking) spawn, required when the page must
 *  respond to the eval concurrently. */
function runAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [CLI, ...args], { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`CLI ${args.join(" ")} failed (${code}): ${stderr}`));
      } else {
        resolve({ status: code, stdout, stderr });
      }
    });
  });
}

function json(args) {
  const out = run([...args, "-f", "json"]);
  return JSON.parse(out.stdout);
}

const port = 39481;

// --- start ------------------------------------------------------------------
const started = run(["start", "--url", VIZ_URL, "--port", String(port), "--no-open", "-f", "json"]);
console.log("start stderr:\n" + started.stderr);
const startData = JSON.parse(started.stdout.trim());
const sid = startData.session;
console.log("session =", sid);

// registry written?
const registry = JSON.parse(readFileSync(join(SKILL, "temp", "sessions.json"), "utf8"));
if (!registry.some((s) => s.id === sid && s.port === port)) throw new Error("registry entry missing");
const token = registry.find((s) => s.port === port)?.token ?? "";
if (!token) throw new Error("no token in registry");

// --- static hosting ---------------------------------------------------------
const html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
if (!html.includes("tableau-viz")) throw new Error("HTML does not mention tableau-viz");
const executorJs = await fetch(`http://127.0.0.1:${port}/client/executor.js`).then((r) => r.text());
if (!executorJs.includes("startExecutor")) throw new Error("executor bundle missing startExecutor");
console.log("executor bundle bytes:", executorJs.length);

// scripts served?
const explore = await fetch(`http://127.0.0.1:${port}/scripts/explore.js`).then((r) => r.text());
if (!explore.includes("return meta")) throw new Error("explore script not served");
const badScript = await fetch(`http://127.0.0.1:${port}/scripts/../../../etc/passwd.js`);
if (badScript.status !== 404) throw new Error("script path traversal not blocked");

// --- simulate the page ------------------------------------------------------
const page = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}&client=page`);
await new Promise((res, rej) => { page.addEventListener("open", res); page.addEventListener("error", rej); });

function nextPageMessage(match, timeoutMs = 5000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout waiting for page message")), timeoutMs);
    const h = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (match(m)) { clearTimeout(t); page.removeEventListener("message", h); res(m); }
    };
    page.addEventListener("message", h);
  });
}

page.send(JSON.stringify({ type: "hello", session: sid, ts: Date.now(), url: VIZ_URL, script: "explore" }));
page.send(JSON.stringify({ type: "state", session: sid, state: "loading" }));
page.send(JSON.stringify({ type: "state", session: sid, state: "interactive", snapshot: { workbook: { name: "SOC" }, sheets: [] }, scriptResult: { status: "ok", value: { explored: true } } }));

// --- eval round trip --------------------------------------------------------
const cmdPromise = nextPageMessage((m) => m.type === "command");
const evalResPromise = runAsync(["eval", "return 6 * 7;", "--session", sid, "-f", "json"]);
const cmd = await cmdPromise;
console.log("page received command:", cmd.js);
page.send(JSON.stringify({ type: "result", id: cmd.id, status: "ok", value: 42 }));
const evalRes = await evalResPromise;
if (JSON.parse(evalRes.stdout) !== 42) throw new Error("eval result wrong: " + evalRes.stdout);
console.log("eval ->", evalRes.stdout.trim());

// eval to dead session fails fast
const dead = spawnSync("bun", [CLI, "eval", "return 1", "--session", "does-not-exist"], { encoding: "utf8" });
if (dead.status === 0) throw new Error("unknown session should fail");

// --- status ---------------------------------------------------------------
const status = json(["status", "--session", sid]);
if (status.state !== "interactive") throw new Error("status.state wrong: " + JSON.stringify(status));
if (status.snapshot.workbook.name !== "SOC") throw new Error("status.snapshot wrong");
console.log("status ->", status.state);

// --- wait (already interactive) --------------------------------------------
const waited = json(["wait", "--session", sid]);
if (waited.state.state !== "interactive") throw new Error("wait state wrong");

// --- metadata progress via wait --------------------------------------------
// send metadata then wait --meta should stream it
page.send(JSON.stringify({ type: "metadata", session: sid, status: "loaded", progress: { completedCalls: 4, totalCalls: 4, completedWorksheets: 2, totalWorksheets: 2, elapsedMs: 12 }, errors: [] }));
const metaWaited = spawnSync("bun", [CLI, "wait", "--session", sid, "--meta", "-f", "json"], { encoding: "utf8" });
if (metaWaited.status !== 0) throw new Error("wait --meta failed: " + metaWaited.stderr);
const metaWaitedJson = JSON.parse(metaWaited.stdout);
if (metaWaitedJson.metadata?.status !== "loaded") throw new Error("wait --meta metadata wrong: " + metaWaited.stdout);

// --- meta command -----------------------------------------------------------
// our fake page returns meta contents for the eval; simulate
const metaCmdPromise = nextPageMessage((m) => m.type === "command");
const metaResPromise = runAsync(["meta", "--session", sid, "-f", "json"]);
const metaCmd = await metaCmdPromise;
page.send(JSON.stringify({ type: "result", id: metaCmd.id, status: "ok", value: { state: "loaded", worksheets: {} } }));
const metaRes = await metaResPromise;
console.log("meta ->", metaRes.stdout.trim());

// --- scripts ----------------------------------------------------------------
const scripts = json(["scripts", "-f", "json"]);
if (!scripts.some((s) => s.name === "explore")) throw new Error("explore script not listed");

// --- ls ---------------------------------------------------------------------
const ls = json(["ls", "-f", "json"]);
const mine = ls.find((r) => r.session === sid);
if (!mine || mine.state !== "interactive") throw new Error("ls state wrong: " + JSON.stringify(ls));
console.log("ls ->", JSON.stringify(ls));

// --- stop --session ---------------------------------------------------------
run(["stop", "--session", sid]);
const registryAfter = JSON.parse(readFileSync(join(SKILL, "temp", "sessions.json"), "utf8"));
if (registryAfter.some((s) => s.id === sid)) throw new Error("session not removed from registry");

// --- stop (bridge) ----------------------------------------------------------
run(["stop"]);
await Bun.sleep(300);
const deadProbe = await fetch(`http://127.0.0.1:${port}/ws`).catch(() => null);
if (deadProbe && deadProbe.status !== 401) throw new Error("bridge still alive after stop");

console.log("\nE2E SMOKE PASSED");
process.exit(0);