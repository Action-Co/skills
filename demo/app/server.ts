// Tabby demo app: a small local web server for the demo window.
//
// Serves the side-panel page and runs the view-tableau-dashboard CLI on the
// page's behalf. Dashboards open inside this page (no extra browser tabs).
// Started by "Start Tabby Demo.command"; listens on 127.0.0.1 only.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = import.meta.dir;
const REPO_DIR = join(APP_DIR, "..", "..");
const VIEW_DIR = join(REPO_DIR, "plugins/tableau-analytics/skills/view-tableau-dashboard");
const TABLEAU_VIZ = join(VIEW_DIR, "tableau-viz.sh");
const SESSIONS_FILE = join(VIEW_DIR, "temp/sessions.json");
const PORT = Number(process.env.TABBY_APP_PORT ?? 4747);
const AGENT_NAME = process.env.TABBY_AGENT_NAME ?? "";
const WORKFLOW = "daily-executive-summary";

type Demo = { id: string; label: string; url: string; script?: string };
type Shown = { session: string; tabUrl: string };
type Summary = {
  running: boolean;
  startedAt: number;
  ok: boolean | null;
  reportUrl: string | null;
  error: string | null;
};

// The demo list comes from the workflow in scripts.json, so dashboards added
// there show up in the menu automatically.
function loadDemos(): Demo[] {
  const all = JSON.parse(readFileSync(join(VIEW_DIR, "scripts.json"), "utf8"));
  const wf = all.find((s: { name: string }) => s.name === WORKFLOW);
  return (wf?.steps ?? []).map((st: { name: string; label?: string; url: string; script?: string }) => ({
    id: st.name,
    label: st.label || st.name,
    url: st.url,
    script: st.script,
  }));
}

const demos = loadDemos();
const shown = new Map<string, Shown>();
let summary: Summary | null = null;

async function viz(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn([TABLEAU_VIZ, ...args], {
    cwd: VIEW_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1] ?? "unknown error";
}

function parseJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Newest session the workflow opened for a dashboard URL since `since`.
function workflowTab(url: string, since: number): string | null {
  if (!existsSync(SESSIONS_FILE)) return null;
  try {
    const path = new URL(url).pathname;
    const sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as {
      url: string;
      tabUrl: string;
      createdAt: number;
    }[];
    const match = sessions
      .filter((s) => s.createdAt >= since && s.url.includes(path))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return match?.tabUrl ?? null;
  } catch {
    return null;
  }
}

async function showDemo(id: string, replay: boolean): Promise<Response> {
  const demo = demos.find((d) => d.id === id);
  if (!demo) return json({ error: `unknown demo: ${id}` }, 404);
  const existing = shown.get(id);
  if (existing && !replay) return json(existing);

  const args = ["start", "--url", demo.url, "--no-open", "-f", "json"];
  if (demo.script) args.push("--script", demo.script);
  const r = await viz(args);
  if (r.code !== 0) return json({ error: lastLine(r.stderr) }, 500);
  const payload = parseJson(r.stdout);
  const entry = { session: String(payload.session), tabUrl: String(payload.tabUrl) };
  shown.set(id, entry);
  return json(entry);
}

async function waitReady(session: string): Promise<Response> {
  const r = await viz(["wait", "--session", session, "-f", "json"]);
  return r.code === 0 ? json({ ready: true }) : json({ ready: false, error: lastLine(r.stderr) });
}

function startSummary(): Response {
  if (summary?.running) return summaryStatus();
  const run: Summary = { running: true, startedAt: Date.now(), ok: null, reportUrl: null, error: null };
  summary = run;
  // TABLEAU_VIZ_NO_OPEN keeps the workflow from opening browser tabs; this
  // page shows its dashboards and report instead.
  viz(["run", WORKFLOW, "--intent", "Building the daily executive summary"], {
    TABLEAU_VIZ_NO_OPEN: "1",
  }).then((r) => {
    run.running = false;
    run.ok = r.code === 0;
    run.reportUrl = r.stdout.trim().split("\n").reverse().find((l) => l.startsWith("http")) ?? null;
    if (!run.ok) run.error = lastLine(r.stderr);
  });
  return summaryStatus();
}

function summaryStatus(): Response {
  if (!summary) return json({ running: false, steps: [] });
  const since = summary.startedAt - 1000;
  const steps = demos.map((d) => ({ id: d.id, label: d.label, tabUrl: workflowTab(d.url, since) }));
  return json({ ...summary, steps });
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 120, // /api/ready waits up to 90s for a dashboard to load
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (pathname === "/") {
      return new Response(Bun.file(join(APP_DIR, "index.html")), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (pathname === "/logo.svg") {
      const logo = Bun.file(join(APP_DIR, "logo.svg"));
      return (await logo.exists()) ? new Response(logo) : new Response("", { status: 404 });
    }
    if (pathname === "/api/config") {
      return json({
        app: "tabby",
        agent: AGENT_NAME,
        demos: demos.map(({ id, label }) => ({ id, label })),
      });
    }
    const showMatch = pathname.match(/^\/api\/show\/([a-zA-Z0-9_-]+)$/);
    if (showMatch && req.method === "POST") {
      return showDemo(showMatch[1], url.searchParams.has("replay"));
    }
    const readyMatch = pathname.match(/^\/api\/ready\/([a-zA-Z0-9_-]+)$/);
    if (readyMatch) {
      return waitReady(readyMatch[1]);
    }
    if (pathname === "/api/summary") {
      return req.method === "POST" ? startSummary() : summaryStatus();
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Tabby demo app on http://127.0.0.1:${PORT}`);
