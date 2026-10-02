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
 * The /views/<workbook>/<view> segment inside a path or fragment string, or
 * null when absent. Trailing slashes and any `?`-style suffix (e.g. Tableau's
 * `?:iid=` web params inside a fragment) are stripped.
 */
function viewsSegment(s: string): string | null {
  const marker = "/views/";
  const i = s.indexOf(marker);
  if (i === -1) {
    return null;
  }
  let seg = s.slice(i + marker.length);
  const q = seg.search(/[?]/);
  if (q !== -1) {
    seg = seg.slice(0, q);
  }
  seg = seg.replace(/\/+$/, "");
  return seg || null;
}

/** The site name from a `/t/<site>/views/...` path, or null. */
function siteFromPath(pathname: string): string | null {
  const m = /^\/t\/([^/]+)\/views\//.exec(pathname);
  return m ? m[1] : null;
}

/** The site name from a `#/site/<site>/views/...` fragment, or null. */
function siteFromHash(hash: string): string | null {
  const m = /\/site\/([^/]+)\/views\//.exec(hash);
  return m ? m[1] : null;
}

/**
 * Validate + normalize a Tableau view URL into the canonical embed form.
 *
 * Accepts any of the forms a human or agent can produce:
 *   - <origin>/t/<site>/views/<workbook>/<view>        (canonical Cloud/Server embed path)
 *   - <origin>/#/site/<site>/views/<workbook>/<view>   (browser address-bar / web-UI route)
 *   - <origin>/views/<workbook>/<view>                 (Tableau Public)
 *
 * and rebuilds <origin>/t/<site>/views/<workbook>/<view> (or
 * <origin>/views/<workbook>/<view> when there is no site), stripping the query
 * string and fragment. The /views/... segment is preserved verbatim — Tableau
 * Cloud slugs multi-word sheet names (spaces removed), so the segment must
 * already be the slug form (see docs/TROUBLESHOOTING.md).
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

  // The /views/... segment is present in both the path (embed form) and the
  // fragment (browser/web-UI form); prefer the path.
  const pathViews = viewsSegment(url.pathname);
  const hashViews = viewsSegment(url.hash);
  const views = pathViews ?? hashViews;
  if (!views) {
    throw new Error(
      `'${raw}' does not look like a Tableau view URL (expected a /views/... path)`
    );
  }

  const site = pathViews ? siteFromPath(url.pathname) : siteFromHash(url.hash);
  return site
    ? `${url.origin}/t/${site}/views/${views}`
    : `${url.origin}/views/${views}`;
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

function findChrome(): string | null {
  if (process.platform !== "darwin") {
    return null;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    `${process.env.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Open a URL in the platform browser (best-effort, non-blocking).
 *
 * Chrome is preferred on macOS: authenticated Cloud/Server embeds rely on
 * Tableau's in-frame sign-in, which opens an SSO popup that Safari blocks for
 * cross-origin iframes. If Chrome is installed it gets the tab; otherwise we
 * fall back to the OS default browser (fine for Tableau Public, which needs no
 * session).
 */
export function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    const chrome = findChrome();
    if (chrome) {
      Bun.spawn([chrome, url], {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
      }).unref();
      return;
    }
    Bun.spawn(["open", url], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    }).unref();
    return;
  }
  if (platform === "win32") {
    Bun.spawn(["cmd", "/c", "start", "", url], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    }).unref();
    return;
  }
  Bun.spawn(["xdg-open", url], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  }).unref();
}

/**
 * Open an embed tab in a real browser. For authenticated Cloud/Server embeds
 * the human completes Tableau's in-frame sign-in once; the partition-scoped
 * session cookie (top-level = 127.0.0.1) is then reused by every later tab in
 * the same browser profile, so later `start` calls need no sign-in.
 */
export function openEmbedTab(url: string): void {
  openBrowser(url);
}
