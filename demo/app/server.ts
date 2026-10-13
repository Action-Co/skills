// Tabby demo app: a small local web server for the demo window.
//
// Serves the side-panel page and runs the view-tableau-dashboard CLI on the
// page's behalf. Dashboards open inside this page (no extra browser tabs).
// Started by "Start Tabby Demo.command"; listens on 127.0.0.1 only.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = import.meta.dir;
const REPO_DIR = join(APP_DIR, "..", "..");
const VIEW_DIR = join(REPO_DIR, "plugins/tableau-analytics/skills/view-tableau-dashboard");
const TABLEAU_VIZ = join(VIEW_DIR, "tableau-viz.sh");
const SESSIONS_FILE = join(VIEW_DIR, "temp/sessions.json");
const PORT = Number(process.env.TABBY_APP_PORT ?? 4747);
const AGENT_NAME = process.env.TABBY_AGENT_NAME ?? "";
const AGENT_ID = process.env.TABBY_AGENT_ID ?? "";
const PLUGIN_DIR = process.env.TABBY_PLUGIN_DIR ?? join(REPO_DIR, "plugins/tableau-analytics");
const DEMO_DIR = join(APP_DIR, "..");
const CHATS_FILE = join(VIEW_DIR, "temp/chats.json");
const WORKFLOW = "daily-executive-summary";

type Demo = { id: string; label: string; url: string; script?: string; description?: string; audience?: string };
type Shown = { session: string; tabUrl: string };
type StepState = "ok" | "error" | "retrying";
type Summary = {
  running: boolean;
  startedAt: number;
  ok: boolean | null;
  reportUrl: string | null;
  error: string | null;
  done: Record<string, StepState>;
};

// The demo list comes from the workflow in scripts.json, so dashboards added
// there show up in the menu automatically. The title-area copy shown above
// each dashboard comes from demo/dashboards.json (optional per dashboard).
function loadDemos(): Demo[] {
  const all = JSON.parse(readFileSync(join(VIEW_DIR, "scripts.json"), "utf8"));
  let about: Record<string, { description?: string; audience?: string }> = {};
  try {
    about = JSON.parse(readFileSync(join(APP_DIR, "..", "dashboards.json"), "utf8"));
  } catch {
    // No descriptions: dashboards show their title only.
  }
  const wf = all.find((s: { name: string }) => s.name === WORKFLOW);
  return (wf?.steps ?? []).map((st: { name: string; label?: string; url: string; script?: string }) => ({
    id: st.name,
    label: st.label || st.name,
    url: st.url,
    script: st.script,
    description: about[st.name]?.description,
    audience: about[st.name]?.audience,
  }));
}

const demos = loadDemos();
const shown = new Map<string, Shown>();
let summary: Summary | null = null;

async function viz(
  args: string[],
  env: Record<string, string> = {},
  onStderrLine?: (line: string) => void,
) {
  const proc = Bun.spawn([TABLEAU_VIZ, ...args], {
    cwd: VIEW_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    readLines(proc.stderr, onStderrLine),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

// Reads a stream to the end, calling onLine for each complete line as it
// arrives. Returns the full text.
async function readLines(stream: ReadableStream<Uint8Array>, onLine?: (line: string) => void) {
  const decoder = new TextDecoder();
  let all = "";
  let pending = "";
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    all += text;
    pending += text;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    if (onLine) lines.forEach(onLine);
  }
  if (onLine && pending) onLine(pending);
  return all;
}

// Per-dashboard progress from the workflow's log lines.
function stepUpdate(line: string): [string, StepState] | null {
  let m = line.match(/^finished: (\S+) \((ok|error)\)/);
  if (m) return [m[1], m[2] as StepState];
  if ((m = line.match(/^retrying (\S+) after:/))) return [m[1], "retrying"];
  if ((m = line.match(/^retry collected: (\S+) \(ok\)/))) return [m[1], "ok"];
  if ((m = line.match(/^retry for (\S+) (failed|errored):/))) return [m[1], "error"];
  return null;
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
  const run: Summary = { running: true, startedAt: Date.now(), ok: null, reportUrl: null, error: null, done: {} };
  summary = run;
  // TABLEAU_VIZ_NO_OPEN keeps the workflow from opening browser tabs; this
  // page shows its dashboards and report instead.
  viz(["run", WORKFLOW, "--intent", "Building the daily executive summary"], {
    TABLEAU_VIZ_NO_OPEN: "1",
  }, (line) => {
    const update = stepUpdate(line);
    if (update) run.done[update[0]] = update[1];
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
  const steps = demos.map((d) => ({
    id: d.id,
    label: d.label,
    tabUrl: workflowTab(d.url, since),
    done: summary?.done[d.id] ?? null,
  }));
  return json({ ...summary, steps });
}

// --- Ask Tabby: chat with the agent ------------------------------------------
// The page talks to the agent through these endpoints. Each agent adapter
// turns its own output into AgentEvents, so the page (and a future React
// chat UI) never depends on which agent is running.

// The dashboard on screen when a question was asked.
type ChatContext = { id: string; name: string };
type ChatMessage = { role: "user" | "assistant"; text: string; at: number; error?: boolean; context?: ChatContext };
type Chat = {
  id: string;
  title: string;
  sessionId: string | null; // the agent's own conversation id, for follow-ups
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};
type AgentEvent =
  | { type: "turn" } // the agent started a new message; drop the draft so far
  | { type: "delta"; text: string }
  | { type: "tool"; status: string }
  | { type: "done"; text: string; sessionId: string | null }
  | { type: "error"; message: string; sessionId: string | null };
type AgentRun = { kill: () => void; finished: Promise<void> };
type AgentAdapter = (text: string, sessionId: string | null, emit: (e: AgentEvent) => void) => AgentRun;

// Plain-language status for a tool call, so the audience sees what Tabby is
// doing without commands or file paths.
function toolStatus(name: string, input: Record<string, unknown>): string {
  if (name === "Bash") {
    const sub = String(input.command ?? "").match(/tableau-viz\.sh\s+(\S+)/)?.[1];
    if (sub === "ls") return "Checking which dashboards are open";
    if (sub === "wait") return "Waiting for the dashboard to load";
    if (sub === "run") return "Running a dashboard walkthrough";
    if (sub === "say") return "Posting a note on the dashboard";
    if (sub && ["status", "summary", "describe", "meta", "filter"].includes(sub)) return "Reading the dashboard";
    if (sub) return "Working in the dashboard";
    return "Working";
  }
  if (name === "Read" || name === "Grep" || name === "Glob") return "Reading the dashboard guide";
  if (name === "Skill") return "Getting ready";
  return "Thinking";
}

// Claude Code in headless mode, with the same plugin and settings the
// launcher used to start it with in the Terminal.
const claudeAgent: AgentAdapter = (text, sessionId, emit) => {
  const args = [
    "claude", "-p", text,
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--plugin-dir", PLUGIN_DIR,
    "--settings", join(DEMO_DIR, "agents/claude-settings.json"),
    "--append-system-prompt", readFileSync(join(DEMO_DIR, "opening-prompt.md"), "utf8"),
  ];
  if (sessionId) args.push("--resume", sessionId);
  const proc = Bun.spawn(args, { cwd: REPO_DIR, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let sid = sessionId;
  let ended = false;
  let stopped = false;
  const end = (e: AgentEvent) => {
    if (ended) return;
    ended = true;
    emit(e);
  };

  const onLine = (line: string) => {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.session_id) sid = ev.session_id;
    if (ev.parent_tool_use_id) return; // subagent chatter
    if (ev.type === "stream_event") {
      const e = ev.event;
      if (e.type === "message_start") emit({ type: "turn" });
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") emit({ type: "delta", text: e.delta.text });
    } else if (ev.type === "assistant") {
      for (const block of ev.message?.content ?? []) {
        if (block.type === "tool_use") emit({ type: "tool", status: toolStatus(block.name, block.input ?? {}) });
      }
    } else if (ev.type === "result") {
      if (ev.is_error) end({ type: "error", message: String(ev.result || "Tabby couldn’t answer that."), sessionId: sid });
      else end({ type: "done", text: String(ev.result ?? ""), sessionId: sid });
    }
  };

  const finished = Promise.all([readLines(proc.stdout, onLine), new Response(proc.stderr).text()])
    .then(async ([, stderr]) => {
      const code = await proc.exited;
      const message = stopped
        ? "Stopped."
        : code === 0 ? "Tabby stopped without an answer." : `Tabby stopped: ${lastLine(stderr)}`;
      end({ type: "error", message, sessionId: sid });
    });
  const kill = () => {
    stopped = true;
    proc.kill();
  };
  return { kill, finished };
};

// One entry per supported agent; the id matches AGENTS in the launcher.
const AGENT_ADAPTERS: Record<string, AgentAdapter> = { claude: claudeAgent };
const agent = AGENT_ADAPTERS[AGENT_ID] ?? null;

function loadChats(): Chat[] {
  try {
    return JSON.parse(readFileSync(CHATS_FILE, "utf8"));
  } catch {
    return [];
  }
}
const chats = loadChats();
const running = new Map<string, AgentRun>();
function saveChats() {
  writeFileSync(CHATS_FILE, JSON.stringify(chats.filter((c) => c.messages.length), null, 2));
}

function chatList(): Response {
  const list = chats
    .filter((c) => c.messages.length)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt, running: running.has(id) }));
  return json(list);
}

function createChat(): Response {
  const now = Date.now();
  const chat: Chat = { id: crypto.randomUUID(), title: "", sessionId: null, createdAt: now, updatedAt: now, messages: [] };
  chats.push(chat);
  return json({ id: chat.id });
}

// Deleting a chat stops an answer in progress and drops it from the saved list.
function deleteChat(chat: Chat): Response {
  running.get(chat.id)?.kill();
  running.delete(chat.id);
  chats.splice(chats.indexOf(chat), 1);
  saveChats();
  return json({ deleted: true });
}

// The page sends the id of the dashboard on screen; the name and the
// dashboard session come from this server, not the page.
function contextFor(id: string | undefined): ChatContext | null {
  const demo = demos.find((d) => d.id === id);
  return demo ? { id: demo.id, name: "Superstore " + demo.label.split(" — ")[0] } : null;
}

// Tells the agent which dashboard the presenter is looking at. The saved
// message keeps the presenter's own words.
function withContext(text: string, context: ChatContext | null): string {
  if (!context) return text;
  const session = shown.get(context.id)?.session;
  const where = session ? ` (dashboard session ${session})` : "";
  return `[Context: the presenter is viewing the ${context.name} dashboard${where} in the demo window. `
    + `Answer about this dashboard unless the question clearly asks about something else.]\n\n${text}`;
}

// Streams the agent's answer to the page as Server-Sent Events. The answer
// keeps going (and is saved) if the page goes away mid-answer.
async function sendMessage(chat: Chat, req: Request): Promise<Response> {
  if (!agent) return json({ error: "No AI agent is running with this demo." }, 503);
  if (running.has(chat.id)) return json({ error: "Tabby is still answering in this chat." }, 409);
  const body = (await req.json().catch(() => ({}))) as { text?: string; context?: string };
  const text = String(body.text ?? "").trim();
  if (!text) return json({ error: "empty message" }, 400);
  const context = contextFor(body.context);

  const now = Date.now();
  chat.messages.push({ role: "user", text, at: now, ...(context && { context }) });
  if (!chat.title) chat.title = text.length > 60 ? text.slice(0, 57).trimEnd() + "…" : text;
  chat.updatedAt = now;
  saveChats();

  const enc = new TextEncoder();
  let open = true;
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(chunk)); } catch { open = false; }
      };
      ping = setInterval(() => write(": ping\n\n"), 15000);
      const run = agent(withContext(text, context), chat.sessionId, (e) => {
        if (e.type === "done" || e.type === "error") {
          chat.sessionId = e.sessionId ?? chat.sessionId;
          const reply = e.type === "done" ? e.text : e.message;
          chat.messages.push({ role: "assistant", text: reply, at: Date.now(), ...(e.type === "error" && { error: true }) });
          chat.updatedAt = Date.now();
          saveChats();
        }
        write(`data: ${JSON.stringify(e)}\n\n`);
      });
      running.set(chat.id, run);
      run.finished.finally(() => {
        running.delete(chat.id);
        clearInterval(ping);
        if (open) controller.close();
        open = false;
      });
    },
    cancel() {
      open = false;
      clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

// Stop answering agents when the demo ends.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    for (const run of running.values()) run.kill();
    process.exit(0);
  });
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
        chat: Boolean(agent),
        demos: demos.map(({ id, label, description, audience }) => ({ id, label, description, audience })),
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
    if (pathname === "/api/chats") {
      return req.method === "POST" ? createChat() : chatList();
    }
    const chatMatch = pathname.match(/^\/api\/chats\/([a-zA-Z0-9_-]+)(\/messages|\/stop)?$/);
    if (chatMatch) {
      const chat = chats.find((c) => c.id === chatMatch[1]);
      if (!chat) return json({ error: "unknown chat" }, 404);
      if (chatMatch[2] === "/messages" && req.method === "POST") return sendMessage(chat, req);
      if (chatMatch[2] === "/stop" && req.method === "POST") {
        running.get(chat.id)?.kill();
        return json({ stopped: true });
      }
      if (!chatMatch[2] && req.method === "DELETE") return deleteChat(chat);
      return json({ ...chat, running: running.has(chat.id) });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Tabby demo app on http://127.0.0.1:${PORT}`);
