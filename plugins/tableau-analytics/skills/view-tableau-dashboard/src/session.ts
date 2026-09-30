/**
 * session.ts — the CLI-side session registry.
 *
 * One bridge daemon per port; many sessions (browser tabs) share it. The bridge
 * holds live state; `temp/sessions.json` is the CLI's durable registry of what
 * tabs it opened and how to reach them (port + token + bridge pid).
 *
 * Responsibilities:
 *   - mint session ids
 *   - read/write/prune the registry
 *   - resolve the target session for a command (--session / --latest / default)
 *   - probe localhost ports (free | our-bridge | foreign) and reclaim orphans
 *   - validate viz URLs + derive the Embedding API library URL
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = join(HERE, "..");
export const TEMP_DIR = join(SKILL_ROOT, "temp");
export const SESSION_FILE = join(TEMP_DIR, "sessions.json");

export const DEFAULT_PORT = 3000;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const SessionSchema = z.object({
  id: z.string().min(1),
  url: z.string(),
  port: z.number(),
  token: z.string(),
  pid: z.number(),
  tabUrl: z.string(),
  script: z.string().optional(),
  createdAt: z.number(),
});
export type Session = z.infer<typeof SessionSchema>;

export const RegistrySchema = z.array(SessionSchema);

// ---------------------------------------------------------------------------
// Id minting
// ---------------------------------------------------------------------------

let seq = 0;
/** Mint a unique, monotonic session id. */
export function mintSessionId(): string {
  seq += 1;
  return `sess-${Date.now().toString(36)}-${seq}`;
}

// ---------------------------------------------------------------------------
// Registry persistence
// ---------------------------------------------------------------------------

/** Read the registry; returns [] when absent or corrupt. */
export async function readRegistry(file = SESSION_FILE): Promise<Session[]> {
  if (!existsSync(file)) {
    return [];
  }
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    return RegistrySchema.parse(raw);
  } catch {
    return [];
  }
}

export async function writeRegistry(
  sessions: Session[],
  file = SESSION_FILE
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(sessions, null, 2));
}

export function isAlive(pid: number): boolean {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Drop registry entries whose bridge process is no longer alive. */
export async function pruneRegistry(
  sessions: Session[]
): Promise<Session[]> {
  const live = sessions.filter((s) => isAlive(s.pid));
  if (live.length !== sessions.length) {
    await writeRegistry(live);
  }
  return live;
}

/**
 * Resolve the session a command should target.
 * - explicit id (--session) wins and must exist.
 * - --latest picks the most recent entry.
 * - with exactly one session it is the default; with several, the caller must
 *   pass an id or --latest (throws otherwise).
 */
export function resolveSession(
  sessions: Session[],
  opts: { session?: string; latest?: boolean } = {}
): Session {
  if (opts.session) {
    const found = sessions.find((s) => s.id === opts.session);
    if (!found) {
      throw new Error(
        `unknown session '${opts.session}' — run 'tableau-viz ls' to list sessions`
      );
    }
    return found;
  }
  if (opts.latest) {
    const latest = [...sessions].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) {
      throw new Error("no sessions — run 'tableau-viz start --url <url>' first");
    }
    return latest;
  }
  if (sessions.length === 1) {
    return sessions[0];
  }
  if (sessions.length === 0) {
    throw new Error(
      "no sessions — run 'tableau-viz start --url <url>' first (or pass --session)"
    );
  }
  throw new Error(
    `${sessions.length} sessions exist — pass --session <id> or --latest to choose (see 'tableau-viz ls')`
  );
}

// ---------------------------------------------------------------------------
// Port probe / reclaim
// ---------------------------------------------------------------------------

export type PortProbe =
  | { state: "free" }
  | { state: "our-bridge" } // one of our bridges is bound to the port
  | { state: "foreign" }; // something else is bound to the port

/**
 * Classify a localhost port. Distinguishes "our bridge" from an unrelated
 * process without needing the token: an *unauthenticated* request to `/ws`
 * hits our token guard, which returns `401 { "error": "unauthorized" }` — a
 * signature no unrelated server will produce. A refused connection means free.
 */
export async function probePort(port: number): Promise<PortProbe> {
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/ws`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.status === 401) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (body?.error === "unauthorized") {
        return { state: "our-bridge" };
      }
    }
    return { state: "foreign" };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (
      code === "ConnectionRefused" ||
      code === "ECONNREFUSED" ||
      code === "FailedToOpenSocket"
    ) {
      return { state: "free" };
    }
    return { state: "foreign" };
  }
}

/** Find the PID listening on a TCP port via lsof (best-effort, POSIX only). */
export async function pidOnPort(port: number): Promise<number | null> {
  try {
    const proc = Bun.spawn(["lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = (await new Response(proc.stdout).text()).trim();
    const first = out.split("\n")[0];
    const pid = Number(first);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL handling (no hardcoding)
// ---------------------------------------------------------------------------

/**
 * Validate a viz URL: parseable, http(s), and looks like a Tableau view path
 * (/views/... on Public, or /#/views/... UI form on Server/Cloud).
 */
export function validateVizUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`viz URL must be http(s): ${raw}`);
  }
  const looksLikeView =
    url.pathname.includes("/views/") || url.hash.includes("/views/");
  if (!looksLikeView) {
    throw new Error(
      `'${raw}' does not look like a Tableau view URL (expected a /views/... path)`
    );
  }
  return url.toString();
}

/**
 * Derive the Embedding API library URL from the viz URL's origin. Valid for
 * Tableau Public, Server, and Cloud. `--lib-url` overrides for edge cases.
 */
export function deriveLibUrl(vizUrl: string, override?: string): string {
  if (override) {
    try {
      new URL(override);
      return override;
    } catch {
      throw new Error(`--lib-url is not a valid URL: ${override}`);
    }
  }
  const origin = new URL(vizUrl).origin;
  return `${origin}/javascripts/api/tableau.embedding.3.latest.min.js`;
}

/** The Tableau origin for a viz URL (for `open-site`). */
export function originOf(vizUrl: string): string {
  return new URL(vizUrl).origin;
}

/** Build the embed-page URL for a new session. */
export function buildTabUrl(opts: {
  port: number;
  session: string;
  url: string;
  token: string;
  script?: string;
  libUrl?: string;
  tableauToken?: string;
  vizWidth?: string;
  vizHeight?: string;
}): string {
  const q = new URLSearchParams({
    session: opts.session,
    url: opts.url,
    token: opts.token,
  });
  if (opts.script) {
    q.set("script", opts.script);
  }
  if (opts.libUrl) {
    q.set("lib-url", opts.libUrl);
  }
  if (opts.tableauToken) {
    q.set("tableau-token", opts.tableauToken);
  }
  if (opts.vizWidth) {
    q.set("viz-width", opts.vizWidth);
  }
  if (opts.vizHeight) {
    q.set("viz-height", opts.vizHeight);
  }
  return `http://127.0.0.1:${opts.port}/?${q.toString()}`;
}

/** Open a URL in the platform browser (best-effort, non-blocking). */
export function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd = "xdg-open";
  if (platform === "darwin") {
    cmd = "open";
  } else if (platform === "win32") {
    cmd = "cmd";
  }
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  Bun.spawn([cmd, ...args], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  }).unref();
}

/**
 * The dedicated Chrome profile used by the login automation. Once a `login`
 * completes, the Tableau session cookie lives in this profile's partition jar
 * (top-level = 127.0.0.1), so embed tabs MUST run in this profile to reuse it.
 */
export const BROWSER_PROFILE_DIR = join(TEMP_DIR, "chrome-profile");

/**
 * Open an embed tab. If the login profile exists (a `login` was completed), it
 * launches a dedicated Chrome instance on that profile so the partitioned
 * Tableau session cookie carries; otherwise it falls back to the normal
 * browser (e.g. Tableau Public, which needs no session).
 */
export function openEmbedTab(url: string): void {
  if (existsSync(BROWSER_PROFILE_DIR)) {
    launchChromeWithProfile(url, BROWSER_PROFILE_DIR);
    return;
  }
  openBrowser(url);
}

function launchChromeWithProfile(url: string, profile: string): void {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          `${process.env.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
        ]
      : [];
  const chrome = candidates.find((c) => existsSync(c));
  if (chrome) {
    Bun.spawn([chrome, `--user-data-dir=${profile}`, url], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    }).unref();
    return;
  }
  // Fallback: ask the OS to open the URL (profile may not be honored).
  openBrowser(url);
}