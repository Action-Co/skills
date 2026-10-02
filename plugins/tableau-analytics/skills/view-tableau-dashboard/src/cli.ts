#!/usr/bin/env bun
/**
 * cli.ts — `tableau-viz` agent-facing CLI for the session-bridge.
 *
 * The agent talks to THIS CLI, never to the bridge directly. The bridge is the
 * seam; the CLI is one adapter on it (the browser page is the other).
 *
 * Commands: start, ls, status, wait, meta, eval, run, scripts, open-site, stop.
 *
 * House conventions: stdout = data, stderr = chrome (status/tips); commander
 * exitOverride(); -f/--format json|table, -o/--output <file>, -v/--verbose,
 * -s/--session <id>, --latest.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { z } from "zod";
import {
  buildTabUrl,
  DEFAULT_PORT,
  deriveLibUrl,
  isAlive,
  mintSessionId,
  openBrowser,
  openEmbedTab,
  originOf,
  pidOnPort,
  probePort,
  pruneRegistry,
  readRegistry,
  resolveSession,
  SESSION_FILE,
  SKILL_ROOT,
  TEMP_DIR,
  validateVizUrl,
  writeRegistry,
  type Session,
} from "./session.ts";
import type { ResultMessage } from "./protocol.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = join(HERE, "bridge.ts");
const SCRIPTS_JSON = join(SKILL_ROOT, "scripts.json");
const SCRIPTS_DIR = join(SKILL_ROOT, "scripts");

const START_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 150;
const EVAL_TIMEOUT_MS = 70_000;
const WAIT_TIMEOUT_MS = 90_000;

const ScriptEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional().default(""),
  onInteractive: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// stdout = data; stderr = chrome.
// ---------------------------------------------------------------------------

function info(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function out(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function verbose(msg: string): void {
  if (VERBOSE) {
    process.stderr.write(`[verbose] ${msg}\n`);
  }
}

let VERBOSE = false;

// ---------------------------------------------------------------------------
// Bridge WS client
// ---------------------------------------------------------------------------

function openWs(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(
        `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}&client=cli`
      );
    } catch (err) {
      reject(new Error(`cannot open WebSocket to bridge on port ${port}: ${err}`));
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`bridge on port ${port} did not accept the WebSocket connection`)),
      5000
    );
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`cannot reach a bridge on port ${port} — run 'tableau-viz start --url <url>' first`));
    });
  });
}

type JsonMsg = Record<string, unknown>;

/** Open a WS, send one message, resolve when `match` returns a value. */
async function wsRequest<T>(
  port: number,
  token: string,
  send: JsonMsg,
  match: (msg: JsonMsg) => T | null,
  timeoutMs = EVAL_TIMEOUT_MS
): Promise<T> {
  const ws = await openWs(port, token);
  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for the bridge to respond"));
      }, timeoutMs);
      ws.addEventListener("message", (ev) => {
        let msg: JsonMsg;
        try {
          msg = JSON.parse(String(ev.data)) as JsonMsg;
        } catch {
          return;
        }
        const hit = match(msg);
        if (hit !== null) {
          clearTimeout(timer);
          resolve(hit);
        }
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        reject(new Error("bridge WebSocket closed unexpectedly"));
      });
      ws.send(JSON.stringify(send));
    });
  } finally {
    ws.close();
  }
}

async function bridgeAlive(port: number): Promise<boolean> {
  const probe = await probePort(port);
  return probe.state === "our-bridge";
}

async function requireBridge(session: Session): Promise<void> {
  if (!(await bridgeAlive(session.port))) {
    throw new Error(
      `bridge on port ${session.port} is not running — run 'tableau-viz start --url <url>'`
    );
  }
}

// ---------------------------------------------------------------------------
// Registry + session resolution helpers
// ---------------------------------------------------------------------------

async function loadSessions(): Promise<Session[]> {
  const sessions = await readRegistry();
  return await pruneRegistry(sessions);
}

async function requireSession(opts: {
  session?: string;
  latest?: boolean;
}): Promise<Session> {
  const sessions = await loadSessions();
  return resolveSession(sessions, opts);
}

// ---------------------------------------------------------------------------
// Eval execution (shared by eval / run / meta)
// ---------------------------------------------------------------------------

async function submitEval(
  session: Session,
  js: string,
  intent?: string
): Promise<{ value?: unknown; error?: string }> {
  await requireBridge(session);
  const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await wsRequest<JsonMsg>(
    session.port,
    session.token,
    {
      type: "command",
      session: session.id,
      id,
      js,
      ...(intent ? { intent } : {}),
    },
    (msg) => (msg.type === "result" && msg.id === id ? msg : null),
    EVAL_TIMEOUT_MS
  );
  if (result.status === "ok") {
    return { value: result.value };
  }
  return { error: String(result.error ?? "unknown eval error") };
}

async function runEvalCommand(
  js: string,
  opts: { session?: string; latest?: boolean; format: string; output?: string; intent?: string }
): Promise<void> {
  const session = await requireSession(opts);
  const { value, error } = await submitEval(session, js, opts.intent);
  if (error !== undefined) {
    throw new Error(enhanceEvalError(error));
  }
  renderValue(value, opts);
}

function enhanceEvalError(error: string): string {
  if (/not ready|not interactive|still loading/i.test(error)) {
    return `${error}\nhint: the viz is still loading — run 'tableau-viz wait [--session ${""}] first`;
  }
  return error;
}

function renderValue(value: unknown, opts: { format: string; output?: string }): void {
  const rendered =
    opts.format === "json" ? JSON.stringify(value, null, 2) : renderTable(value);
  if (opts.output) {
    void writeFile(opts.output, `${rendered}\n`).then(() =>
      info(`Output written to ${opts.output}`)
    );
  } else {
    out(rendered);
  }
}

function renderTable(value: unknown): string {
  if (Array.isArray(value) && value.every((v) => v && typeof v === "object")) {
    const rows = value as Record<string, unknown>[];
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const header = cols.join("\t");
    const body = rows
      .map((r) => cols.map((c) => String(r[c] ?? "")).join("\t"))
      .join("\n");
    return `${header}\n${body}`;
  }
  return JSON.stringify(value, null, 2);
}

// ---------------------------------------------------------------------------
// Scripts manifest
// ---------------------------------------------------------------------------

async function readScripts(): Promise<z.infer<typeof ScriptEntrySchema>[]> {
  const raw = JSON.parse(await readFile(SCRIPTS_JSON, "utf8"));
  return z.array(ScriptEntrySchema).parse(raw);
}

async function scriptSource(name: string): Promise<string> {
  const manifest = await readScripts();
  if (!manifest.some((s) => s.name === name)) {
    throw new Error(`unknown script '${name}' — run 'tableau-viz scripts' to list`);
  }
  const file = join(SCRIPTS_DIR, `${name}.js`);
  if (!existsSync(file)) {
    throw new Error(`script file missing: ${file}`);
  }
  return await readFile(file, "utf8");
}

// ---------------------------------------------------------------------------
// Bridge lifecycle
// ---------------------------------------------------------------------------

async function assertPortStartable(port: number): Promise<void> {
  const probe = await probePort(port);
  if (probe.state === "our-bridge") {
    throw new Error(
      `a bridge is already listening on port ${port} but has no tracked session (orphaned). Run 'tableau-viz stop --port ${port}' to reclaim it, then retry.`
    );
  }
  if (probe.state === "foreign") {
    throw new Error(
      `port ${port} is already in use by another process. Stop it or pass --port <port>.`
    );
  }
}

async function awaitBridgeReady(
  child: ReturnType<typeof spawn>,
  port: number
): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `bridge process exited during startup (code ${child.exitCode ?? child.signalCode}).`
      );
    }
    const probe = await probePort(port);
    if (probe.state === "our-bridge") {
      return true;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function spawnBridge(
  port: number,
  token: string
): Promise<number> {
  const child = spawn("bun", [BRIDGE_ENTRY], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      BRIDGE_TOKEN: token,
    },
  });
  child.unref();
  const ready = await awaitBridgeReady(child, port);
  if (!ready) {
    if (child.pid && isAlive(child.pid)) {
      try {
        process.kill(child.pid);
      } catch {
        // already gone
      }
    }
    throw new Error(`bridge failed to start on port ${port} within timeout`);
  }
  return child.pid ?? -1;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

interface SessionStartOpts {
  url?: string;
  script?: string;
  port?: string;
  libUrl?: string;
  vizWidth?: string;
  vizHeight?: string;
}

/**
 * Ensure the bridge is running for a port, mint + register a session for the
 * URL, and return the session + its embed tab URL.
 */
async function ensureSession(
  opts: SessionStartOpts
): Promise<{ session: Session; url: string; tabUrl: string }> {
  if (!opts.url) {
    throw new Error("requires --url <viz-url> (the direct /views/... URL)");
  }
  const url = validateVizUrl(opts.url);
  const port = Number(opts.port ?? DEFAULT_PORT);
  const libUrl = deriveLibUrl(url, opts.libUrl);

  let sessions = await loadSessions();
  const existing = sessions.find((s) => s.port === port);
  const probe = await probePort(port);

  let token: string;
  let pid: number;
  if (probe.state === "our-bridge") {
    if (!existing) {
      throw new Error(
        `a bridge is already listening on port ${port} but no session token is tracked (orphaned). Run 'tableau-viz stop --port ${port}' to reclaim it, then retry.`
      );
    }
    token = existing.token;
    pid = existing.pid;
    info(`Reusing bridge on port ${port} (pid ${pid}).`);
  } else {
    await assertPortStartable(port);
    token = crypto.randomUUID();
    pid = await spawnBridge(port, token);
    info(`Started bridge on port ${port} (pid ${pid}).`);
  }

  const id = mintSessionId();
  const tabUrl = buildTabUrl({
    port,
    session: id,
    url,
    token,
    script: opts.script,
    libUrl,
    vizWidth: opts.vizWidth,
    vizHeight: opts.vizHeight,
  });
  const session: Session = {
    id,
    url,
    port,
    token,
    pid,
    tabUrl,
    script: opts.script,
    createdAt: Date.now(),
  };

  sessions = sessions.filter((s) => s.id !== id);
  sessions.push(session);
  await writeRegistry(sessions);

  return { session, url, tabUrl };
}

async function cmdStart(opts: {
  url?: string;
  script?: string;
  port?: string;
  open?: boolean;
  libUrl?: string;
  vizWidth?: string;
  vizHeight?: string;
  format: string;
  output?: string;
}): Promise<void> {
  const { session, url, tabUrl } = await ensureSession(opts);

  const payload = {
    session: session.id,
    tabUrl,
    script: opts.script ?? null,
    url,
    port: session.port,
  };
  if (opts.format === "json") {
    out(JSON.stringify(payload, null, 2));
  } else {
    out(`session: ${session.id}`);
    out(`tabUrl: ${tabUrl}`);
  }
  if (opts.output) {
    await writeFile(opts.output, `${JSON.stringify(payload, null, 2)}\n`);
    info(`Output written to ${opts.output}`);
  }

  if (opts.open === false) {
    info(`Open this tab in a browser yourself: ${tabUrl}`);
  } else {
    info(`Opening browser tab: ${tabUrl}`);
    openEmbedTab(tabUrl);
  }
}

async function cmdLs(opts: { format: string; output?: string }): Promise<void> {
  const sessions = await loadSessions();
  const rows: unknown[] = [];

  // One WS per distinct (port, token) — sessions on one bridge share it.
  const bridges = new Map<string, { port: number; token: string }>();
  for (const s of sessions) {
    bridges.set(`${s.port}:${s.token}`, { port: s.port, token: s.token });
  }

  for (const s of sessions) {
    const b = bridges.get(`${s.port}:${s.token}`);
    let state = "offline";
    let metadataStatus: string | undefined;
    if (b) {
      try {
        const reply = await wsRequest<JsonMsg>(
          b.port,
          b.token,
          { type: "list" },
          (msg) => (msg.type === "list" ? msg : null),
          5000
        );
        const live = (reply.sessions as JsonMsg[] | undefined) ?? [];
        const mine = live.find((x) => x.session === s.id);
        state = mine ? String(mine.state ?? "unknown") : "disconnected";
        metadataStatus = mine?.metadataStatus
          ? String(mine.metadataStatus)
          : undefined;
      } catch {
        state = "offline";
      }
    }
    rows.push({
      session: s.id,
      state,
      metadata: metadataStatus ?? "",
      url: s.url,
      script: s.script ?? "",
      port: s.port,
      pid: s.pid,
      createdAt: new Date(s.createdAt).toISOString(),
    });
  }

  const payload = rows.length === 0 ? [] : rows;
  renderValue(payload, opts);
}

async function cmdStatus(opts: {
  session?: string;
  latest?: boolean;
  format: string;
  output?: string;
}): Promise<void> {
  const session = await requireSession(opts);
  await requireBridge(session);
  const reply = await wsRequest<JsonMsg>(
    session.port,
    session.token,
    { type: "status", session: session.id },
    (msg) => (msg.type === "status" && msg.session === session.id ? msg : null)
  );
  renderValue(reply, opts);
}

async function cmdWait(opts: {
  session?: string;
  latest?: boolean;
  timeout?: string;
  meta?: boolean;
  format: string;
  output?: string;
}): Promise<void> {
  const session = await requireSession(opts);
  await requireBridge(session);
  const timeoutMs = Number(opts.timeout ?? WAIT_TIMEOUT_MS);

  const ws = await openWs(session.port, session.token);
  try {
    const result = await new Promise<JsonMsg>((resolve, reject) => {
      let stateEnvelope: JsonMsg | null = null;
      let metaEnvelope: JsonMsg | null = null;
      let metaTerminal = false;
      const timer = setTimeout(() => {
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for session ${session.id} to become interactive`
          )
        );
      }, timeoutMs);
      ws.addEventListener("message", (ev) => {
        let msg: JsonMsg;
        try {
          msg = JSON.parse(String(ev.data)) as JsonMsg;
        } catch {
          return;
        }
        if (msg.type === "state") {
          if (msg.state === "interactive") {
            stateEnvelope = msg;
            if (!opts.meta || metaTerminal) {
              clearTimeout(timer);
              resolve({ state: msg, metadata: metaEnvelope, error: null });
            }
          } else if (msg.state === "error" || msg.state === "disconnected") {
            clearTimeout(timer);
            resolve({
              state: msg,
              metadata: metaEnvelope,
              error: msg.error ?? `session state is ${msg.state}`,
            });
          }
        } else if (msg.type === "metadata") {
          metaEnvelope = msg;
          if (msg.status === "loaded" || msg.status === "partial") {
            metaTerminal = true;
            if (stateEnvelope) {
              clearTimeout(timer);
              resolve({ state: stateEnvelope, metadata: msg, error: null });
            }
          }
        }
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        reject(new Error("bridge WebSocket closed while waiting"));
      });
      ws.send(JSON.stringify({ type: "wait", session: session.id }));
    });

    const payload = {
      session: session.id,
      state: result.state,
      metadata: result.metadata,
    };
    if (result.error) {
      // Still render the state so the agent sees WHY it failed, then fail.
      renderValue(payload, opts);
      throw new Error(String(result.error));
    }
    renderValue(payload, opts);
  } finally {
    ws.close();
  }
}

async function cmdMeta(opts: {
  session?: string;
  latest?: boolean;
  worksheet?: string;
  wait?: boolean;
  format: string;
  output?: string;
}): Promise<void> {
  let js: string;
  let intent: string;
  if (opts.worksheet) {
    const w = JSON.stringify(opts.worksheet);
    intent = `Reading metadata for ${opts.worksheet}`;
    if (opts.wait) {
      js = `await meta.load(${w}); return meta.worksheets[${w}];`;
    } else {
      js = `return meta.worksheets[${w}];`;
    }
  } else if (opts.wait) {
    intent = "Reading metadata cache (waiting for fill)";
    js = "await meta.ready(); return meta;";
  } else {
    intent = "Reading metadata cache";
    js = "return meta;";
  }
  await runEvalCommand(js, { ...opts, intent });
}

async function cmdEval(
  jsArg: string | undefined,
  opts: {
    file?: string;
    session?: string;
    latest?: boolean;
    format: string;
    output?: string;
    intent: string;
  }
): Promise<void> {
  let js = jsArg;
  if (opts.file) {
    js = await readFile(opts.file, "utf8");
  }
  if (!js || !js.trim()) {
    throw new Error("no JS provided — pass a string or use --file <path>");
  }
  await runEvalCommand(js, opts);
}

/** `summary` — the static, cheap snapshot (workbook, sheets, zones, params, filters). */
async function cmdSummary(opts: {
  session?: string;
  latest?: boolean;
  format: string;
  output?: string;
}): Promise<void> {
  const session = await requireSession(opts);
  await requireBridge(session);
  const reply = await wsRequest<JsonMsg>(
    session.port,
    session.token,
    { type: "status", session: session.id },
    (msg) => (msg.type === "status" && msg.session === session.id ? msg : null)
  );
  const snapshot = (reply.snapshot as JsonMsg | undefined) ?? {};
  renderValue(snapshot, opts);
}

/** `describe` — deep metadata scan (the CLI's own implementation, formerly the
 * `describe` reusable script). Almost as deep as the tableau-semantics derive
 * script, minus `getDataSourcesAsync` — that performance-flagged call belongs
 * to the semantic model at build time, never this runtime.
 *
 * Base filter list comes from the single dashboard `getFiltersAsync()` call
 * (never a per-worksheet loop), then each distinct filter is described in
 * depth (appliedWorksheets + relative-date period) via `describeFilter`. */
async function cmdDescribe(opts: {
  session?: string;
  latest?: boolean;
  format: string;
  output?: string;
}): Promise<void> {
  const js = [
    `await meta.ready();`,
    `const zones = activeSheet.sheetType === "dashboard" ? activeSheet.objects.map((z) => ({ name: z.name, type: z.type, worksheet: z.worksheet?.name ?? null, floating: z.isFloating, visible: z.isVisible })) : [];`,
    `const baseFilters = await activeSheet.getFiltersAsync();`,
    `const seen = new Set();`,
    `const filters = [];`,
    `for (const f of baseFilters) {`,
    `  if (seen.has(f.fieldName)) continue;`,
    `  seen.add(f.fieldName);`,
    `  try {`,
    `    const desc = await helpers.describeFilter(f.fieldName, { worksheet: f.worksheetName });`,
    `    filters.push({ worksheet: desc.worksheet, fieldName: desc.fieldName, filterType: desc.filterType, period: desc.periodType ? { anchorDate: desc.anchorDate, periodType: desc.periodType, rangeN: desc.rangeN, rangeType: desc.rangeType } : undefined, appliedWorksheets: desc.appliedWorksheets ?? undefined });`,
    `  } catch {`,
    `    filters.push({ worksheet: f.worksheetName, fieldName: f.fieldName, filterType: f.filterType });`,
    `  }`,
    `}`,
    `return {`,
    `  workbook: workbook.name,`,
    `  sheets: helpers.listSheets(),`,
    `  activeSheet: helpers.getActiveSheet(),`,
    `  worksheetNames: activeSheet.sheetType === "dashboard" ? activeSheet.worksheets.map((w) => w.name) : [activeSheet.name],`,
    `  zones,`,
    `  visibleControls: helpers.visibleControls(zones),`,
    `  parameters: await helpers.getParameters(),`,
    `  filterGroups: helpers.classifyFilters(filters),`,
    `  worksheets: meta.worksheets,`,
    `};`,
  ].join("\n");
  await runEvalCommand(js, { ...opts, intent: "Describing dashboard (full metadata scan)" });
}

/** `filter <field>` — full typed definition for one filter (any of the 4 types). */
async function cmdFilter(
  fieldName: string,
  opts: {
    worksheet?: string;
    domain?: string;
    session?: string;
    latest?: boolean;
    format: string;
    output?: string;
  }
): Promise<void> {
  const worksheetArg = opts.worksheet ? JSON.stringify(opts.worksheet) : "undefined";
  const domainArg = JSON.stringify(opts.domain ?? "relevant");
  const js = `return helpers.describeFilter(${JSON.stringify(fieldName)}, { worksheet: ${worksheetArg}, domainType: ${domainArg} });`;
  await runEvalCommand(js, { ...opts, intent: `Reading filter "${fieldName}"` });
}

async function cmdRun(
  name: string,
  opts: {
    session?: string;
    latest?: boolean;
    format: string;
    output?: string;
    intent: string;
  }
): Promise<void> {
  const js = await scriptSource(name);
  info(`Running script '${name}' (${(js.length / 1024).toFixed(1)} kB).`);
  await runEvalCommand(js, opts);
}

async function cmdScripts(opts: { format: string; output?: string }): Promise<void> {
  const manifest = await readScripts();
  const rows = manifest.map((s) => ({
    name: s.name,
    description: s.description,
    onInteractive: s.onInteractive,
  }));
  renderValue(rows, opts);
}

async function cmdOpenSite(opts: { url?: string; format: string }): Promise<void> {
  let url: string;
  if (opts.url) {
    url = validateVizUrl(opts.url);
  } else {
    const sessions = await loadSessions();
    const latest = [...sessions].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) {
      throw new Error("no sessions — pass --url <viz-url> or start a session first");
    }
    url = latest.url;
  }
  const origin = originOf(url);
  info(
    `Opening the Tableau origin (${origin}) so you can log in. ` +
      "Once signed in, run 'tableau-viz start --url <url>' — embed tabs reuse this session."
  );
  openBrowser(origin);
  out(`origin: ${origin}`);
}

async function cmdStop(opts: { session?: string; port?: string }): Promise<void> {
  // 1. Drop a single session (keep the bridge).
  if (opts.session) {
    const sessions = await loadSessions();
    const target = resolveSession(sessions, { session: opts.session });
    try {
      await requireBridge(target);
      await wsRequest<JsonMsg>(
        target.port,
        target.token,
        { type: "drop", session: target.id },
        (msg) => (msg.type === "status" && msg.session === target.id ? msg : null),
        5000
      );
    } catch {
      // Bridge already gone — just clean the registry.
    }
    const remaining = sessions.filter((s) => s.id !== target.id);
    await writeRegistry(remaining);
    info(`Dropped session ${target.id} (${target.url}).`);
    return;
  }

  // 2. Reclaim a specific orphaned bridge.
  if (opts.port) {
    const port = Number(opts.port);
    const probe = await probePort(port);
    if (probe.state !== "our-bridge") {
      info(`No bridge on port ${port}.`);
      return;
    }
    const pid = await pidOnPort(port);
    if (pid && isAlive(pid)) {
      process.kill(pid);
      info(`Stopped orphaned bridge on port ${port} (pid ${pid}).`);
    } else {
      info(`Orphaned bridge on port ${port} but its PID could not be resolved. Kill it manually (lsof -ti tcp:${port} | xargs kill).`);
    }
    return;
  }

  // 3. Default: stop every tracked bridge and clear the registry.
  const sessions = await loadSessions();
  const stopped = new Set<number>();
  for (const s of sessions) {
    if (stopped.has(s.pid)) {
      continue;
    }
    stopped.add(s.pid);
    if (isAlive(s.pid)) {
      try {
        process.kill(s.pid);
        info(`Stopped bridge (pid ${s.pid}).`);
      } catch (err) {
        info(`Could not stop pid ${s.pid}: ${err}`);
      }
    }
  }
  if (sessions.length === 0) {
    const probe = await probePort(Number(DEFAULT_PORT));
    if (probe.state === "our-bridge") {
      const pid = await pidOnPort(Number(DEFAULT_PORT));
      if (pid && isAlive(pid)) {
        process.kill(pid);
        info(`Stopped orphaned bridge on port ${DEFAULT_PORT} (pid ${pid}).`);
      }
    } else {
      info("No bridge session recorded.");
    }
  }
  await rm(SESSION_FILE, { force: true });
  await mkdir(TEMP_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Program wiring
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("tableau-viz")
  .description(
    [
      "Embed a live Tableau view once, keep it stable on screen, and drive it",
      "with agent-authored JavaScript against the Embedding API v3 — no DOM",
      "automation, no page reloads, no command catalog.",
      "",
      "Every eval runs with `viz`, `workbook`, `activeSheet`, `helpers`, and",
      "`meta` in scope. Write `return <expr>`; the result is safe-serialized.",
      "See docs/EMBEDDING_API.md for the object tree, enum literals, and helpers.",
      "",
      "Commands:",
      "  start        open a tab for a viz URL (reuses a running bridge)",
      "  ls           list sessions + live states",
      "  status       live viz state + snapshot + metadata progress",
      "  wait         block until interactive (+ snapshot + scriptResult)",
      "  meta         read the background metadata cache",
      "  eval '<js>'  run arbitrary JS against the live viz",
      "  run <name>   run a reusable script by name",
      "  summary      static, cheap snapshot (workbook, sheets, zones, params, filters)",
      "  describe     full metadata scan (columns + visual specs, zones, filters, params)",
      "  filter <f>   full typed definition for one filter (any type + domain)",
      "  scripts      list reusable scripts",
      "  open-site    open the Tableau origin to establish a browser session",
      "  stop         close a session and/or the bridge",
      "",
      "Examples:",
      "  tableau-viz start --url https://public.tableau.com/views/SOC/SecurityOps --script explore",
      "  tableau-viz wait --meta",
      "  tableau-viz eval 'return helpers.listSheets()' -f json",
      "  tableau-viz eval 'return helpers.applyCategoricalFilter(\"Table\", \"Region\", [\"APAC\"], \"replace\")' -f json",
      "  tableau-viz meta --worksheet 'Table - Open Cases' -f json",
    ].join("\n")
  )
  .option("-f, --format <format>", "output format: json|table", "table")
  .option("-o, --output <file>", "write output to a file")
  .option("-v, --verbose", "verbose logging")
  .option("-s, --session <id>", "target a session by id (required when several exist)")
  .option("--latest", "target the newest session");

program
  .command("start")
  .description("open a tab for a viz URL, reusing a running bridge")
  .requiredOption("--url <url>", "the direct Tableau view URL (/views/...)")
  .option("--script <name>", "schedule a script to auto-fire on firstinteractive")
  .option("--port <port>", `bridge port (default ${DEFAULT_PORT})`)
  .option("--no-open", "do not auto-open the browser")
  .option("--lib-url <url>", "override the Embedding API library URL")
  .option("--width <px>", "native viz width to render before fit-to-card scaling (default 1920)")
  .option("--height <px>", "native viz height to render before fit-to-card scaling (default 1080)")
  .action((opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdStart({
      url: opts.url,
      script: opts.script,
      port: opts.port,
      open: opts.open,
      libUrl: opts.libUrl,
      vizWidth: opts.width,
      vizHeight: opts.height,
      format: globals.format ?? "table",
      output: globals.output,
    });
  });

program
  .command("ls")
  .description("list sessions + live states")
  .action((opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdLs({ format: globals.format ?? "table", output: globals.output });
  });

program
  .command("status")
  .description("live viz state + snapshot + metadata progress")
  .action((opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdStatus({
      session: globals.session,
      latest: globals.latest,
      format: globals.format ?? "table",
      output: globals.output,
    });
  });

program
  .command("wait")
  .description("block until the viz is interactive (+ snapshot, scriptResult)")
  .option("--timeout <ms>", `max wait in ms (default ${WAIT_TIMEOUT_MS})`)
  .option("--meta", "also wait for the background metadata cache fill")
  .action((opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdWait({
      session: globals.session,
      latest: globals.latest,
      timeout: opts.timeout,
      meta: opts.meta,
      format: globals.format ?? "table",
      output: globals.output,
    });
  });

program
  .command("meta")
  .description("read the background metadata cache (columns + visual specs)")
  .option("--worksheet <name>", "read just one worksheet's cache entry")
  .option("--wait", "block until the cache is filled (or the worksheet lands)")
  .action((opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdMeta({
      session: globals.session,
      latest: globals.latest,
      worksheet: opts.worksheet,
      wait: opts.wait,
      format: globals.format ?? "table",
      output: globals.output,
    });
  });

program
  .command("eval [js]")
  .description("run arbitrary JS against the live viz")
  .requiredOption(
    "--intent <text>",
    "human-readable description of what the code does — REQUIRED; it is shown " +
      "as a notification on the viz page so a human sees agent activity"
  )
  .option("--file <path>", "read JS from a file instead of an argument")
  .action((js, opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdEval(js, {
      file: opts.file,
      intent: opts.intent,
      session: globals.session,
      latest: globals.latest,
      format: globals.format ?? "table",
      output: globals.output,
    });
  });

program
  .command("run <name>")
  .description("run a reusable script by name")
  .requiredOption(
    "--intent <text>",
    "human-readable description of what the script does — REQUIRED; it is shown " +
      "as a notification on the viz page so a human sees agent activity"
  )
  .action((name, opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdRun(name, {
      intent: opts.intent,
      session: globals.session,
      latest: globals.latest,
      format: globals.format ?? "table",
      output: globals.output,
    });
  });

program
  .command("summary")
  .description("the static, cheap snapshot: workbook, sheets, zones, parameters, filters")
  .action((opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdSummary({
      session: globals.session,
      latest: globals.latest,
      format: globals.format ?? "table",
      output: globals.output,
    });
  });

program
  .command("describe")
  .description(
    "full metadata scan: per-worksheet columns + visual specs (meta), zones, filters, parameters"
  )
  .action((opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdDescribe({
      session: globals.session,
      latest: globals.latest,
      format: globals.format ?? "table",
      output: globals.output,
    });
  });

program
  .command("filter <field>")
  .description(
    "full typed definition for one filter: categorical/range/relative-date/hierarchical, incl. appliedValues, domain, appliedWorksheets"
  )
  .option("--worksheet <name>", "target a specific worksheet (disambiguates sheet-local filters)")
  .option("--domain <type>", "domain type: relevant (default) | database")
  .action((field, opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdFilter(field, {
      worksheet: opts.worksheet,
      domain: opts.domain,
      session: globals.session,
      latest: globals.latest,
      format: globals.format ?? "table",
      output: globals.output,
    });
  });

program
  .command("scripts")
  .description("list reusable scripts")
  .action((opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdScripts({ format: globals.format ?? "table", output: globals.output });
  });

program
  .command("open-site")
  .description("open the Tableau origin to establish a browser session")
  .option("--url <url>", "viz URL whose origin to open (defaults to the newest session)")
  .action((opts, command) => {
    const globals = command.parent?.opts() ?? {};
    VERBOSE = Boolean(globals.verbose);
    return cmdOpenSite({ url: opts.url, format: globals.format ?? "table" });
  });

program
  .command("stop")
  .description("close a session and/or the bridge")
  .option("--session <id>", "drop a single session (keep the bridge)")
  .option("--port <port>", "reclaim an orphaned bridge on this port")
  .action((opts, command) => {
    // `--session` collides with the global `-s/--session`; commander routes the
    // value to the parent's opts, so read both.
    const globals = command.parent?.opts() ?? {};
    return cmdStop({
      session: opts.session ?? globals.session,
      port: opts.port,
    });
  });

program.on("command:*", () => {
  info(`error: unknown command '${program.args.join(" ")}'`);
  info("Run 'tableau-viz --help' for usage.");
  process.exit(1);
});

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (err) {
  const e = err as { code?: string; message?: string };
  if (e.code === "commander.helpDisplayed" || e.code === "commander.version") {
    process.exit(0);
  }
  info(`❌ Error: ${e.message ?? String(err)}`);
  process.exit(1);
}