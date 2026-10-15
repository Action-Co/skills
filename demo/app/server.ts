// Tabby demo app: a small local web server for the demo window.
//
// Serves the side-panel page and runs the view-tableau-dashboard CLI on the
// page's behalf. Dashboards open inside this page (no extra browser tabs).
// Started by "Start Tabby Demo.command"; listens on 127.0.0.1 only.

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = import.meta.dir;
const REPO_DIR = join(APP_DIR, "..", "..");
const VIEW_DIR = join(REPO_DIR, "plugins/tableau-analytics/skills/view-tableau-dashboard");
const TABLEAU_VIZ = join(VIEW_DIR, "tableau-viz.sh");
const SESSIONS_FILE = join(VIEW_DIR, "temp/sessions.json");
const ARTIFACTS_DIR = join(VIEW_DIR, "artifacts");
const PORT = Number(process.env.TABBY_APP_PORT ?? 4747);
const PLUGIN_DIR = process.env.TABBY_PLUGIN_DIR ?? join(REPO_DIR, "plugins/tableau-analytics");
const DEMO_DIR = join(APP_DIR, "..");
const CONFIG_FILE = join(DEMO_DIR, "tabby-demo.conf");
const HOME = process.env.HOME ?? "";
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

// Bun looks commands up on the PATH the server started with and ignores later
// changes, so agent commands are found and run with the current PATH (which
// adds the agents' install folders and the presenter's shell PATH).
function which(cmd: string): string | null {
  return Bun.which(cmd, { PATH: process.env.PATH ?? "" });
}
function spawnCmd(cmd: string[], opts: Parameters<typeof Bun.spawn>[1] = {}) {
  return Bun.spawn([which(cmd[0]) ?? cmd[0], ...cmd.slice(1)], { env: { ...process.env }, ...opts });
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
// `context`: the dashboards a question was about (older chats saved one object).
type ChatMessage = { role: "user" | "assistant"; text: string; at: number; error?: boolean; context?: ChatContext[] | ChatContext };
type Chat = {
  id: string;
  title: string;
  sessionId: string | null; // the agent's own conversation id, for follow-ups
  agent?: string; // which agent sessionId belongs to (chats before Codex: Claude)
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
    const sub = String(input.command ?? "").match(/tableau-viz\.sh\s+([a-z-]+)/)?.[1];
    if (sub === "ls") return "Checking which dashboards are open";
    if (sub === "wait") return "Waiting for the dashboard to load";
    if (sub === "run") return "Running a dashboard walkthrough";
    if (sub === "say") return "Posting a note on the dashboard";
    if (sub === "report" || sub === "export") return "Building the branded report";
    if (sub && ["status", "summary", "describe", "meta", "filter"].includes(sub)) return "Reading the dashboard";
    if (sub) return "Working in the dashboard";
    return "Working";
  }
  if (name === "Read" || name === "Grep" || name === "Glob") return "Reading the dashboard guide";
  if (name === "Write" || name === "Edit") return "Writing the report";
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
  const proc = spawnCmd(args, { cwd: REPO_DIR, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
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

// OpenAI Codex CLI (signs in with a ChatGPT plan) in headless mode. Codex has
// no plugin flag or system-prompt flag, so the first message of a chat carries
// the opening prompt and points Codex at the skill guides; follow-ups resume
// the Codex thread, which keeps them. It runs in Codex's workspace-write
// sandbox (the repo folder) with local network on, which tableau-viz.sh needs
// to reach the dashboards, and never stops to ask for approval.
const CODEX_SKILLS = `Your skills are the guides in ${PLUGIN_DIR}/skills/*/SKILL.md. `
  + `Before your first dashboard command in this chat, read ${VIEW_DIR}/SKILL.md, and follow it. `
  + `The dashboard CLI is ${TABLEAU_VIZ}.`;

const codexAgent: AgentAdapter = (text, sessionId, emit) => {
  const prompt = sessionId
    ? text
    : `${readFileSync(join(DEMO_DIR, "opening-prompt.md"), "utf8")}\n${CODEX_SKILLS}\n\n---\n\n${text}`;
  const args = [
    "codex", "exec", "--json", "--skip-git-repo-check",
    "--cd", REPO_DIR,
    "--sandbox", "workspace-write",
    "-c", "sandbox_workspace_write.network_access=true",
    "-c", 'approval_policy="never"',
  ];
  if (sessionId) args.push("resume", sessionId);
  args.push("-"); // prompt on stdin: the opening prompt is too long for an argument
  const proc = spawnCmd(args, { cwd: REPO_DIR, stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" });
  let sid = sessionId;
  let answer = "";
  let lastError = "";
  let ended = false;
  let stopped = false;
  const end = (e: AgentEvent) => {
    if (ended) return;
    ended = true;
    emit(e);
  };

  // Codex sends whole messages, not text deltas, so each message replaces
  // the draft on the page.
  const onLine = (line: string) => {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === "thread.started" && ev.thread_id) sid = ev.thread_id;
    const item = ev.item ?? {};
    if (ev.type === "item.started") {
      if (item.type === "command_execution") emit({ type: "tool", status: toolStatus("Bash", { command: item.command }) });
      if (item.type === "file_change") emit({ type: "tool", status: toolStatus("Write", {}) });
    } else if (ev.type === "item.completed" && item.type === "agent_message") {
      answer = String(item.text ?? "");
      emit({ type: "turn" });
      emit({ type: "delta", text: answer });
    } else if (ev.type === "turn.completed") {
      end({ type: "done", text: answer, sessionId: sid });
    } else if (ev.type === "turn.failed") {
      end({ type: "error", message: String(ev.error?.message || lastError || "Tabby couldn’t answer that."), sessionId: sid });
    } else if (ev.type === "error") {
      // Codex also reports connection retries ("Reconnecting... 2/5") as
      // errors, so an error only ends the answer if Codex exits after it.
      lastError = String(ev.message ?? "");
    }
  };

  const finished = Promise.all([readLines(proc.stdout, onLine), new Response(proc.stderr).text()])
    .then(async ([, stderr]) => {
      const code = await proc.exited;
      const message = stopped
        ? "Stopped."
        : code === 0 ? "Tabby stopped without an answer." : `Tabby stopped: ${lastError || lastLine(stderr)}`;
      end({ type: "error", message, sessionId: sid });
    });
  const kill = () => {
    stopped = true;
    proc.kill();
  };
  return { kill, finished };
};

// --- Agents and in-app setup --------------------------------------------------
// One entry per supported agent, in the order AGENT=auto tries them. Each says
// how to install it (without an admin password) and how to sign in, so the
// page can set one up for a presenter who has never used a terminal.

type Agent = {
  id: string;
  name: string;
  command: string;
  adapter: AgentAdapter;
  install: string[];
  signIn: string[];
  signedIn: () => Promise<boolean>;
};

// Agents install to these folders; Finder-launched apps don't always have them
// on PATH.
function addToPath(...dirs: string[]) {
  const have = (process.env.PATH ?? "").split(":");
  process.env.PATH = [...dirs.filter((d) => d && !have.includes(d)), ...have].join(":");
}
addToPath(join(HOME, ".local/bin"), join(HOME, ".bun/bin"), join(HOME, ".npm-global/bin"), join(HOME, ".volta/bin"));

type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

// Stops a command and the programs it started (agents' commands are often a
// small launcher that starts the real program). SIGKILL, because a process
// the terminal has paused ignores gentler signals.
function killTree(pid: number) {
  Bun.spawnSync(["/usr/bin/pkill", "-KILL", "-P", String(pid)]);
  try { process.kill(pid, "SIGKILL"); } catch {}
}

// Runs a command until it exits or `timeout` ms pass, then kills it. Never
// waits on output that a leftover child keeps open. `detach` runs it in its
// own session with no terminal, so an interactive shell can't take over (and
// get paused by) the Terminal window the launcher runs in. `onSpawn` gets a
// function that stops the command, for Cancel.
async function runCmd(cmd: string[], opts: {
  timeout?: number;
  onLine?: (line: string) => void;
  cwd?: string;
  env?: Record<string, string | undefined>;
  detach?: boolean;
  onSpawn?: (stop: () => void) => void;
} = {}): Promise<RunResult> {
  const { timeout = 10000, onLine, cwd, env, detach = false, onSpawn } = opts;
  const resolved = [which(cmd[0]) ?? cmd[0], ...cmd.slice(1)];
  const full = detach ? ["/usr/bin/perl", "-MPOSIX", "-e", "POSIX::setsid(); exec @ARGV or exit 127", ...resolved] : resolved;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(full, { cwd, env: env ?? { ...process.env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    return { code: 127, stdout: "", stderr: String(e), timedOut: false };
  }
  const stop = () => killTree(proc.pid);
  onSpawn?.(stop);
  let timedOut = false;
  const timer = timeout ? setTimeout(() => { timedOut = true; stop(); }, timeout) : null;
  const out: string[] = [];
  const err: string[] = [];
  const reading = Promise.all([
    readLines(proc.stdout as ReadableStream<Uint8Array>, (l) => { out.push(l); onLine?.(l); }),
    readLines(proc.stderr as ReadableStream<Uint8Array>, (l) => { err.push(l); onLine?.(l); }),
  ]);
  const code = await proc.exited;
  if (timer) clearTimeout(timer);
  await Promise.race([reading, Bun.sleep(500)]);
  return { code, stdout: out.join("\n"), stderr: err.join("\n"), timedOut };
}

// An agent the presenter already installed (for example with npm under nvm)
// is often only on the PATH their shell profile sets up, so ask their login
// shell for its PATH and add any folders missing here.
async function loadShellPath() {
  const marker = "__TABBY_PATH__";
  const r = await runCmd([process.env.SHELL || "/bin/zsh", "-ilc", `printf '\\n${marker}%s\\n' "$PATH"`], { timeout: 5000, detach: true });
  const line = r.stdout.split("\n").find((l) => l.startsWith(marker));
  if (!line) return; // No shell PATH: the folders above still apply.
  const have = (process.env.PATH ?? "").split(":");
  process.env.PATH = [...have, ...line.slice(marker.length).split(":").filter((d) => d && !have.includes(d))].join(":");
}

const quiet = (cmd: string[], timeout = 10000) => runCmd(cmd, { timeout });

const AGENTS: Agent[] = [
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    adapter: claudeAgent,
    install: ["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"],
    signIn: ["claude", "auth", "login"],
    signedIn: async () => {
      const r = await quiet(["claude", "auth", "status"]);
      try { return JSON.parse(r.stdout).loggedIn === true; } catch { return false; }
    },
  },
  {
    id: "codex",
    name: "Codex (ChatGPT)",
    command: "codex",
    adapter: codexAgent,
    install: [process.execPath, "install", "-g", "@openai/codex"], // the Bun running this server
    signIn: ["codex", "login"],
    signedIn: async () => (await quiet(["codex", "login", "status"])).code === 0,
  },
];

// AGENT= in tabby-demo.conf: auto, none, or an agent id.
function configuredAgent(): string {
  try {
    return readFileSync(CONFIG_FILE, "utf8").match(/^AGENT=(\S*)/m)?.[1] || "auto";
  } catch {
    return "auto";
  }
}
function saveConfiguredAgent(id: string) {
  let text = "";
  try { text = readFileSync(CONFIG_FILE, "utf8"); } catch {}
  text = /^AGENT=/m.test(text) ? text.replace(/^AGENT=.*$/m, `AGENT=${id}`) : `${text}AGENT=${id}\n`;
  writeFileSync(CONFIG_FILE, text);
}

async function agentStates() {
  return Promise.all(AGENTS.map(async (a) => {
    const installed = Boolean(which(a.command));
    return { id: a.id, name: a.name, installed, signedIn: installed && (await a.signedIn()) };
  }));
}

// The agent Ask Tabby uses: the configured one, or for auto the first that is
// installed and signed in. Null turns the chat off.
let agent: Agent | null = null;
async function pickAgent() {
  const wanted = configuredAgent();
  const states = await agentStates();
  const ready = states.find((s) => s.installed && s.signedIn && (wanted === "auto" || wanted === s.id));
  agent = wanted === "none" ? null : AGENTS.find((a) => a.id === ready?.id) ?? null;
  return states;
}
const firstPick = loadShellPath().then(pickAgent);

type SetupStep = "install" | "signin" | "done" | "error";
// detail: the newest line of setup output, so a slow step visibly moves.
// code: a short id for the failure (shown to the presenter and in the copied
// details); message: what went wrong and what to do, in plain language.
type Setup = {
  agent: string;
  step: SetupStep;
  message: string | null;
  code: string | null;
  failedAt: SetupStep | null;
  raw: string | null;
  signInUrl: string | null;
  detail: string | null;
  stepStartedAt: number; // for the elapsed time the dialog shows
  cancelled?: boolean;
};

class SetupError extends Error {
  constructor(public code: string, message: string, public raw = "") {
    super(message);
  }
}

// Turns a failed install's output into a reason the presenter can act on.
// "Codex", not "Codex (ChatGPT)", inside sentences.
const shortName = (a: Agent) => a.name.replace(/ \(.*\)$/, "");

function installError(agentInfo: Agent, output: string, code: number, timedOut: boolean): SetupError {
  const a = { ...agentInfo, name: shortName(agentInfo) };
  const raw = lastLine(output);
  const from = a.id === "codex" ? "npm (registry.npmjs.org)" : "claude.ai and downloads.claude.ai";
  if (timedOut) {
    return new SetupError("INSTALL_TIMEOUT", `Installing ${a.name} took longer than 5 minutes, so Tabby stopped it. The network may be slow or blocking the download. Try again on a different network (for example, off VPN).`, raw);
  }
  if (/ConnectionRefused|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|could not resolve|network|proxy|certificate|SSL|TLS|UNABLE_TO_GET_ISSUER|SELF_SIGNED|\b40[37] (Forbidden|Proxy)/i.test(output)) {
    return new SetupError("INSTALL_NETWORK", `Tabby couldn’t download ${a.name}. This Mac’s network may be blocking it (a VPN or company firewall). Try a different network, or ask IT to allow downloads from ${from}.`, raw);
  }
  if (/ENOSPC|no space left/i.test(output)) {
    return new SetupError("INSTALL_DISK", `There isn’t enough free disk space to install ${a.name}. Free up some space and try again.`, raw);
  }
  if (/EACCES|EPERM|permission denied|operation not permitted/i.test(output)) {
    return new SetupError("INSTALL_PERMISSION", `This Mac didn’t let Tabby write to the install folder in your home folder. Ask IT whether software installs are restricted on this Mac.`, raw);
  }
  if (code === 0) {
    return new SetupError("INSTALL_NOT_FOUND", `${a.name} installed, but Tabby can’t find it. Quit the demo (press Return in the Terminal window), start it again, and choose Set up Ask Tabby.`, raw);
  }
  return new SetupError("INSTALL_FAILED", `Installing ${a.name} didn’t finish: ${raw.replace(/^error:\s*/i, "")}`, raw);
}

// Same for a sign-in that didn't leave the agent signed in.
function signInError(agentInfo: Agent, output: string, timedOut: boolean): SetupError {
  const a = { ...agentInfo, name: shortName(agentInfo) };
  const raw = lastLine(output);
  const account = a.id === "codex" ? "ChatGPT" : "Claude";
  if (timedOut) {
    return new SetupError("SIGNIN_TIMEOUT", `Sign-in wasn’t finished within 10 minutes. Try again, and finish signing in in the browser window that opens.`, raw);
  }
  if (/address already in use|EADDRINUSE|port \d+ .*in use/i.test(output)) {
    return new SetupError("SIGNIN_BUSY", `Another ${a.name} sign-in is already waiting. Close any other ${a.name} sign-in windows (including in Terminal), then try again.`, raw);
  }
  if (/workspace|not enabled|not allowed|disabled|admin|forbidden|\b403\b|unauthorized|\b401\b/i.test(output)) {
    return new SetupError("SIGNIN_NOT_ALLOWED", a.id === "codex"
      ? `Your ChatGPT account signed in, but it isn’t allowed to use Codex. On a ChatGPT Business or Enterprise plan, ask your workspace admin to turn on Codex, then try again.`
      : `Your Claude account signed in, but it isn’t allowed to use Claude Code. Ask your Claude admin to turn it on, then try again.`, raw);
  }
  return new SetupError("SIGNIN_FAILED", `Sign-in didn’t finish. Try again, and sign in with your ${account} account in the browser window that opens. If no window opens, use the “Open the sign-in page” link.`, raw);
}
let setup: Setup | null = null;
let stopSetupStep: (() => void) | null = null;
const SIGN_IN_TIMEOUT = 10 * 60 * 1000;
const INSTALL_TIMEOUT = 5 * 60 * 1000;
const SETUP_LOG = join(VIEW_DIR, "temp/tabby-setup.log");
const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;
function logSetup(line: string) {
  try { appendFileSync(SETUP_LOG, `${new Date().toISOString()} ${line}\n`); } catch {}
}

// Runs one setup command, passing each output line to onLine.
async function setupStep(cmd: string[], onLine: ((line: string) => void) | undefined, timeout: number) {
  logSetup(`$ ${cmd.join(" ")}`);
  const r = await runCmd(cmd, {
    timeout,
    cwd: HOME,
    env: { ...process.env, NO_COLOR: "1" },
    onLine: (raw) => {
      const line = raw.replace(ANSI, "");
      logSetup(line);
      onLine?.(line);
    },
    onSpawn: (stop) => { stopSetupStep = stop; },
  });
  stopSetupStep = null;
  logSetup(`exit ${r.code}${r.timedOut ? " (timed out)" : ""}`);
  return { code: r.code, output: `${r.stdout}\n${r.stderr}`.replace(ANSI, "").trim(), timedOut: r.timedOut };
}

// Installs the agent if needed, then signs in (the agent opens the browser),
// then makes it the demo's agent. The page polls /api/agents/setup.
async function runSetup(a: Agent) {
  const job: Setup = {
    agent: a.id, step: "install", message: null, code: null, failedAt: null, raw: null,
    signInUrl: null, detail: null, stepStartedAt: Date.now(),
  };
  const check = () => { if (job.cancelled) throw new SetupError("CANCELLED", "Setup was cancelled."); };
  const progress = (line: string) => {
    const text = line.trim();
    if (text) job.detail = text.length > 120 ? text.slice(0, 117) + "…" : text;
  };
  setup = job;
  try {
    if (!which(a.command)) await loadShellPath(); // installed since the demo started?
    check();
    if (!which(a.command)) {
      const r = await setupStep(a.install, progress, INSTALL_TIMEOUT);
      check();
      // Bun may install global commands outside ~/.bun/bin (BUN_INSTALL).
      const bin = (await quiet([process.execPath, "pm", "bin", "-g"])).stdout.trim();
      if (bin) addToPath(bin);
      if (r.timedOut || r.code !== 0 || !which(a.command)) throw installError(a, r.output, r.code, r.timedOut);
    }
    job.detail = null;
    const signedIn = await a.signedIn();
    check();
    if (!signedIn) {
      job.step = "signin";
      job.stepStartedAt = Date.now();
      const r = await setupStep(a.signIn, (line) => {
        job.signInUrl ??= line.match(/https:\/\/\S+/)?.[0] ?? null;
      }, SIGN_IN_TIMEOUT);
      job.detail = null;
      check();
      if (!(await a.signedIn())) throw signInError(a, r.output, r.timedOut);
    }
    check();
    saveConfiguredAgent(a.id);
    await pickAgent();
    job.step = "done";
  } catch (e) {
    if (job.cancelled) return; // Cancel already reported it
    job.failedAt = job.step;
    job.step = "error";
    job.message = e instanceof Error ? e.message : String(e);
    job.code = e instanceof SetupError ? e.code : "UNEXPECTED";
    job.raw = e instanceof SetupError ? e.raw : null;
    logSetup(`error ${job.code}: ${job.message}${job.raw ? ` [${job.raw}]` : ""}`);
  }
}

// A plain-text report the presenter copies from the setup dialog and sends to
// whoever helps them. Home folder paths, emails and link parameters are
// removed.
function scrub(text: string): string {
  return text
    .split(HOME).join("~")
    .replace(/\/Users\/[^/\s:]+/g, "~")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/(https?:\/\/[^\s?]+)\?\S*/g, "$1?<removed>");
}

async function diagnostics(): Promise<Response> {
  await firstPick;
  const run = async (cmd: string[]) => {
    const r = await quiet(cmd, 5000);
    return (r.stdout.trim() || r.stderr.trim() || `exit ${r.code}`).split("\n")[0];
  };
  const states = await agentStates();
  const lines: string[] = [];
  lines.push("Tabby Ask Tabby setup details");
  lines.push(`Time: ${new Date().toISOString()}`);
  if (setup) {
    lines.push("", "Setup");
    lines.push(`Agent: ${AGENTS.find((a) => a.id === setup?.agent)?.name ?? setup.agent}`);
    lines.push(`Result: ${setup.step}${setup.failedAt ? ` (failed at ${setup.failedAt === "signin" ? "sign-in" : setup.failedAt})` : ""}`);
    if (setup.code) lines.push(`Error code: ${setup.code}`);
    if (setup.message) lines.push(`Message: ${setup.message}`);
    if (setup.raw) lines.push(`Last output: ${setup.raw}`);
  }
  lines.push("", "Agents");
  lines.push(`AGENT setting: ${configuredAgent()}; in use: ${agent?.name ?? "none"}`);
  for (const st of states) {
    const a = AGENTS.find((x) => x.id === st.id)!;
    const path = which(a.command);
    const version = path ? await run([a.command, "--version"]) : "";
    lines.push(`${a.name}: ${path ? `installed at ${path} (${version})` : "not found"}; ${st.signedIn ? "signed in" : "not signed in"}`);
  }
  lines.push("", "This Mac");
  lines.push(`macOS ${await run(["sw_vers", "-productVersion"])} (${process.arch}); shell ${process.env.SHELL ?? "unknown"}; Bun ${Bun.version}`);
  lines.push(`Tabby: ${await run(["git", "-C", REPO_DIR, "rev-parse", "--short", "HEAD"])} on ${await run(["git", "-C", REPO_DIR, "branch", "--show-current"])}`);
  lines.push(`PATH: ${process.env.PATH ?? ""}`);
  let log = "";
  try { log = readFileSync(SETUP_LOG, "utf8"); } catch {}
  const tail = log.trim().split("\n").slice(-40);
  lines.push("", `Setup log (last ${tail.length} lines of view-tableau-dashboard/temp/tabby-setup.log)`, ...tail);
  return json({ text: scrub(lines.join("\n")) });
}

// The setup job as the page sees it, with seconds spent on the current step.
function setupView() {
  return setup && { ...setup, elapsed: Math.round((Date.now() - setup.stepStartedAt) / 1000) };
}

function startSetup(id: string): Response {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) return json({ error: `unknown agent: ${id}` }, 404);
  if (setup && (setup.step === "install" || setup.step === "signin")) return json({ error: "Setup is already running." }, 409);
  runSetup(a);
  return json(setupView());
}

// Cancel answers right away, whatever step setup is on: the page shows
// "cancelled" at once, and the step's command (if any) is stopped.
function cancelSetup(): Response {
  const job = setup;
  if (job && (job.step === "install" || job.step === "signin")) {
    job.cancelled = true;
    job.failedAt = job.step;
    job.step = "error";
    job.code = "CANCELLED";
    job.message = "Setup was cancelled.";
    logSetup("error CANCELLED: Setup was cancelled.");
  }
  stopSetupStep?.();
  stopSetupStep = null;
  return json({ cancelled: true, setup: job });
}

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

// The page sends the ids of the dashboards a question is about (the one on
// screen, or ones the presenter picked); names and dashboard sessions come
// from this server, not the page.
function contextFor(ids: unknown): ChatContext[] {
  const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
  return demos
    .filter((d) => list.includes(d.id))
    .map((d) => ({ id: d.id, name: "Superstore " + d.label.split(" — ")[0] }));
}

// Tells the agent which dashboards to answer from. The saved message keeps
// the presenter's own words.
function withContext(text: string, context: ChatContext[]): string {
  if (!context.length) return text;
  const named = context.map((c) => {
    const session = shown.get(c.id)?.session;
    return `${c.name}${session ? ` (dashboard session ${session})` : " (opening in the demo window; wait for it with tableau-viz.sh ls)"}`;
  });
  const which = named.length === 1 ? `the ${named[0]} dashboard` : `these dashboards: ${named.join("; ")}`;
  return `[Context: the presenter wants answers from ${which}. `
    + `Answer from ${context.length === 1 ? "it" : "them"} unless the question clearly asks about something else.]\n\n${text}`;
}

// Streams the agent's answer to the page as Server-Sent Events. The answer
// keeps going (and is saved) if the page goes away mid-answer.
async function sendMessage(chat: Chat, req: Request): Promise<Response> {
  const current = agent;
  if (!current) return json({ error: "No AI agent is running with this demo." }, 503);
  if (running.has(chat.id)) return json({ error: "Tabby is still answering in this chat." }, 409);
  const body = (await req.json().catch(() => ({}))) as { text?: string; context?: string | string[] };
  const text = String(body.text ?? "").trim();
  if (!text) return json({ error: "empty message" }, 400);
  const context = contextFor(body.context);

  const now = Date.now();
  chat.messages.push({ role: "user", text, at: now, ...(context.length && { context }) });
  if (!chat.title) chat.title = text.length > 60 ? text.slice(0, 57).trimEnd() + "…" : text;
  chat.updatedAt = now;
  // A conversation id only means something to the agent that made it; after
  // switching agents, a follow-up starts a new conversation.
  if (chat.sessionId && (chat.agent ?? "claude") !== current.id) chat.sessionId = null;
  chat.agent = current.id;
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
      const run = current.adapter(withContext(text, context), chat.sessionId, (e) => {
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

// --- Report downloads ----------------------------------------------------------
// The executive summary report as HTML, PDF or Excel. PDF and Excel are made
// from the HTML report by the skill's `export` command, once per report.

const REPORT_TITLE = "Superstore daily executive summary";
// PDF export prints with headless Chrome.
const HAS_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  `${process.env.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
].some((p) => existsSync(p));
const exporting = new Map<string, Promise<{ code: number; stderr: string }>>();

async function downloadReport(format: string): Promise<Response> {
  if (!["html", "pdf", "xlsx"].includes(format)) return json({ error: `unknown format: ${format}` }, 400);
  const htmlName = summary?.reportUrl?.split("/").pop() ?? "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.html$/.test(htmlName) || !existsSync(join(ARTIFACTS_DIR, htmlName))) {
    return json({ error: "The report isn't ready yet." }, 404);
  }
  const name = format === "html" ? htmlName : htmlName.replace(/\.html$/, `.${format}`);
  const file = join(ARTIFACTS_DIR, name);
  const stale = !existsSync(file) || statSync(file).mtimeMs < statSync(join(ARTIFACTS_DIR, htmlName)).mtimeMs;
  if (format !== "html" && stale) {
    // One export at a time per file, even if the button is pressed twice.
    let job = exporting.get(name);
    if (!job) {
      job = viz(["export", htmlName, "--as", format]).finally(() => exporting.delete(name));
      exporting.set(name, job);
    }
    const r = await job;
    if (r.code !== 0) return json({ error: lastLine(r.stderr) }, 500);
  }
  return new Response(Bun.file(file), {
    headers: { "content-disposition": `attachment; filename="${REPORT_TITLE}.${format}"` },
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
      await firstPick;
      return json({
        app: "tabby",
        agent: agent?.name ?? "",
        chat: Boolean(agent),
        pdf: HAS_CHROME,
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
    if (pathname === "/api/report/download") {
      return downloadReport(url.searchParams.get("format") ?? "");
    }
    if (pathname === "/api/agents") {
      await firstPick;
      return json({ agent: agent?.id ?? null, configured: configuredAgent(), agents: await agentStates(), setup: setupView() });
    }
    if (pathname === "/api/agents/setup") {
      return json({ setup: setupView(), agent: agent?.name ?? "" });
    }
    if (pathname === "/api/agents/setup/cancel" && req.method === "POST") return cancelSetup();
    if (pathname === "/api/agents/diagnostics") return diagnostics();
    const setupMatch = pathname.match(/^\/api\/agents\/([a-z]+)\/setup$/);
    if (setupMatch && req.method === "POST") return startSetup(setupMatch[1]);
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
