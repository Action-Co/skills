#!/usr/bin/env bun
/**
 * bridge.ts — the session-bridge daemon.
 *
 * A single Bun.serve process that is the "seam" between browser tabs (the viz
 * pages) and agent CLI invocations. One daemon per port; many tabs (sessions)
 * and many CLI invocations share it. See docs/PROTOCOL.md for the wire shapes.
 *
 * Responsibilities:
 *   - static host: the embed page, the bundled executor, and scripts/
 *   - WS relay: sessionId -> tab socket; commandId -> CLI socket
 *   - per-session store: lifecycle state, snapshot, metadata progress,
 *     scriptResult — any later CLI connection can read it without having been
 *     connected at the time of the transition
 *   - token guard on every upgrade (401-envelope doubles as the probe signature)
 *   - heartbeat: silent tabs are dropped -> session flips to `disconnected`
 *
 * This module exports `startBridge()` and the store so bridge.test.ts can unit
 * test the relay/store without a separate process.
 */

import type { ServerWebSocket } from "bun";
import { mkdirSync } from "node:fs";
import {
  BridgeInboundSchema,
  type BridgeInbound,
  type MetadataProgress,
  type MetadataStatus,
  type ResultMessage,
  type SessionState,
  type StateMessage,
} from "./protocol.ts";

const HERE = new URL(".", import.meta.url);
const HTML_PATH = new URL("./embed-tableau.html", HERE);
const EXECUTOR_PATH = new URL("./client/executor.ts", HERE);
const SCRIPTS_JSON = new URL("../scripts.json", HERE);
const SCRIPTS_DIR = new URL("../scripts/", HERE);
// Agent-produced artifacts (HTML reports, exported JSON, ...) served at
// /artifacts/<name> so the human can open them from the same localhost origin
// the demos run on. Gitignored scratch output, like temp/sessions.json.
const ARTIFACTS_DIR = new URL("../temp/artifacts/", HERE);

const HEARTBEAT_INTERVAL_MS = 15_000;
// Stale-tab threshold must sit ABOVE the in-page eval cap (55s) and the CLI
// timeout (70s) so a long-but-alive eval can never be killed by the heartbeat
// before the page returns its clean "eval exceeded …" error. It stays the
// backstop for a genuinely wedged page (blocked event loop can't answer pings).
const STALE_TAB_MS = 75_000;

// ---------------------------------------------------------------------------
// Per-session store
// ---------------------------------------------------------------------------

export interface StoredSession {
  state: SessionState;
  snapshot?: unknown;
  error?: string;
  scriptResult?: unknown;
  metadata?: { status: MetadataStatus; progress: MetadataProgress; errors: string[] };
  url?: string;
  script?: string;
  tabSocket?: ServerWebSocket<SocketData>;
}

type SocketData = {
  kind: "page" | "cli" | "unknown";
  session?: string;
  lastSeen: number;
};

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

/** Parse scripts.json into a name->metadata map (for serving + validation). */
async function readScriptManifest(): Promise<Map<string, { description?: string; onInteractive?: boolean }>> {
  const raw = await Bun.file(SCRIPTS_JSON).json();
  const out = new Map<string, { description?: string; onInteractive?: boolean }>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry.name === "string") {
        out.set(entry.name, {
          description: typeof entry.description === "string" ? entry.description : undefined,
          onInteractive: Boolean(entry.onInteractive),
        });
      }
    }
  }
  return out;
}

let executorJsCache: string | null = null;

/** Bundle the in-page executor (TS) into a single browser JS file. */
async function getExecutorJs(): Promise<string> {
  if (executorJsCache === null) {
    const result = await Bun.build({
      entrypoints: [EXECUTOR_PATH.pathname],
      target: "browser",
      format: "esm",
      minify: false,
    });
    if (!result.success) {
      throw new Error(
        `executor bundle failed: ${result.logs.map((l) => l.message).join("; ")}`
      );
    }
    const out = result.outputs[0];
    executorJsCache = await out.text();
  }
  return executorJsCache;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export interface BridgeConfig {
  port: number;
  token: string;
}

export interface Bridge {
  port: number;
  token: string;
  store: Map<string, StoredSession>;
  stop: () => void;
}

const SCRIPT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function startBridge(config: BridgeConfig): Bridge {
  const store = new Map<string, StoredSession>();
  const pendingResults = new Map<string, ServerWebSocket<SocketData>>();
  const subscribers = new Map<string, Set<ServerWebSocket<SocketData>>>();

  const send = (ws: ServerWebSocket<SocketData>, msg: unknown): void => {
    if (ws.readyState === 1 /* OPEN */) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // socket closing — ignore
      }
    }
  };

  const ensureStore = (session: string): StoredSession => {
    let s = store.get(session);
    if (!s) {
      s = { state: "connecting" };
      store.set(session, s);
    }
    return s;
  };

  const broadcast = (session: string, envelope: unknown): void => {
    const set = subscribers.get(session);
    if (!set) {
      return;
    }
    for (const sock of [...set]) {
      send(sock, envelope);
    }
  };

  const stateEnvelope = (
    session: string,
    s: StoredSession
  ): StateMessage => ({
    type: "state",
    session,
    state: s.state,
    snapshot: s.snapshot,
    error: s.error,
    scriptResult: s.scriptResult,
  });

  const buildStatusReply = (session: string): unknown => {
    const s = store.get(session);
    if (!s) {
      return {
        type: "status",
        session,
        state: "disconnected",
        error: "unknown session on this bridge — tab closed? reopen with start",
      };
    }
    return {
      type: "status",
      session,
      state: s.state,
      snapshot: s.snapshot,
      error: s.error,
      metadata: s.metadata,
    };
  };

  const handleMessage = (ws: ServerWebSocket<SocketData>, raw: string): void => {
    const data = ws.data;
    data.lastSeen = Date.now();

    let parsed;
    try {
      parsed = BridgeInboundSchema.safeParse(JSON.parse(raw));
    } catch {
      return;
    }
    if (!parsed.success) {
      return;
    }
    const msg = parsed.data as BridgeInbound;

    switch (msg.type) {
      // ---- page -> bridge -------------------------------------------------
      case "hello": {
        data.kind = "page";
        data.session = msg.session;
        const s = ensureStore(msg.session);
        s.tabSocket = ws;
        s.url = msg.url ?? s.url;
        s.script = msg.script ?? s.script;
        // A (re)connect resets the background fill; the page re-fills.
        s.metadata = undefined;
        break;
      }
      case "state": {
        const s = ensureStore(msg.session);
        s.state = msg.state;
        if (msg.snapshot !== undefined) {
          s.snapshot = msg.snapshot;
        }
        if (msg.error !== undefined) {
          s.error = msg.error;
        }
        if (msg.scriptResult !== undefined) {
          s.scriptResult = msg.scriptResult;
        }
        broadcast(msg.session, stateEnvelope(msg.session, s));
        break;
      }
      case "metadata": {
        const s = ensureStore(msg.session);
        s.metadata = {
          status: msg.status,
          progress: msg.progress,
          errors: msg.errors,
        };
        broadcast(msg.session, msg);
        break;
      }
      case "result": {
        const target = pendingResults.get(msg.id);
        if (target) {
          pendingResults.delete(msg.id);
          send(target, msg as ResultMessage);
        }
        break;
      }
      case "pong": {
        // lastSeen already updated at the top
        break;
      }

      // ---- CLI -> bridge ---------------------------------------------------
      case "command": {
        data.kind = "cli";
        const s = store.get(msg.session);
        if (!s) {
          send(ws, {
            type: "result",
            id: msg.id,
            status: "error",
            error: `unknown session: ${msg.session}`,
          });
          return;
        }
        const tab = s.tabSocket;
        if (!tab || tab.readyState !== 1 /* OPEN */) {
          send(ws, {
            type: "result",
            id: msg.id,
            status: "error",
            error:
              "session has no connected tab — tab closed? reopen with start",
          });
          return;
        }
        pendingResults.set(msg.id, ws);
        send(tab, { type: "command", id: msg.id, js: msg.js, intent: msg.intent });
        break;
      }
      case "say": {
        // One-way agent→human toast on the tab. Mirrors `command`: correlated
        // via pendingResults, acks with the same `result` envelope, and needs
        // no eval and no viz interactivity (the page shows the toast regardless
        // of lifecycle state, even while waiting on sign-in).
        data.kind = "cli";
        const s = store.get(msg.session);
        if (!s) {
          send(ws, {
            type: "result",
            id: msg.id,
            status: "error",
            error: `unknown session: ${msg.session}`,
          });
          return;
        }
        const tab = s.tabSocket;
        if (!tab || tab.readyState !== 1 /* OPEN */) {
          send(ws, {
            type: "result",
            id: msg.id,
            status: "error",
            error:
              "session has no connected tab — tab closed? reopen with start",
          });
          return;
        }
        pendingResults.set(msg.id, ws);
        send(tab, { type: "say", id: msg.id, text: msg.text, hold: msg.hold });
        break;
      }
      case "status": {
        data.kind = "cli";
        send(ws, buildStatusReply(msg.session));
        break;
      }
      case "wait": {
        data.kind = "cli";
        let set = subscribers.get(msg.session);
        if (!set) {
          set = new Set();
          subscribers.set(msg.session, set);
        }
        set.add(ws);
        const s = store.get(msg.session);
        if (s) {
          // Current state first; subsequent transitions stream in.
          send(ws, stateEnvelope(msg.session, s));
          // Replay stored metadata so `wait --meta` against an already-filled
          // cache resolves instead of waiting for a push that already happened.
          if (s.metadata) {
            send(ws, {
              type: "metadata",
              session: msg.session,
              status: s.metadata.status,
              progress: s.metadata.progress,
              errors: s.metadata.errors,
            });
          }
        }
        break;
      }
      case "list": {
        data.kind = "cli";
        const sessions = [...store.entries()].map(([session, s]) => ({
          session,
          state: s.state,
          metadataStatus: s.metadata?.status,
          script: s.script,
          url: s.url,
        }));
        send(ws, { type: "list", sessions });
        break;
      }
      case "drop": {
        data.kind = "cli";
        const s = store.get(msg.session);
        if (s?.tabSocket) {
          try {
            s.tabSocket.close();
          } catch {
            // already closing
          }
        }
        store.delete(msg.session);
        subscribers.delete(msg.session);
        send(ws, {
          type: "status",
          session: msg.session,
          state: "disconnected",
        });
        break;
      }
    }
  };

  const handleClose = (ws: ServerWebSocket<SocketData>): void => {
    const data = ws.data;
    if (!data) {
      return;
    }
    if (data.kind === "page" && data.session) {
      const s = store.get(data.session);
      if (s && s.tabSocket === ws) {
        s.tabSocket = undefined;
        // A closed tab WS is an implied error state: evals fail fast instead
        // of hanging.
        if (s.state !== "error") {
          s.state = "disconnected";
        }
        broadcast(data.session, stateEnvelope(data.session, s));
      }
    } else if (data.kind === "cli") {
      for (const set of subscribers.values()) {
        set.delete(ws);
      }
      for (const [id, sock] of pendingResults) {
        if (sock === ws) {
          pendingResults.delete(id);
        }
      }
    }
  };

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const s of store.values()) {
      const tab = s.tabSocket;
      if (!tab) {
        continue;
      }
      const data = tab.data as SocketData;
      if (now - data.lastSeen > STALE_TAB_MS) {
        try {
          tab.close();
        } catch {
          // close handler will flip the session to disconnected
        }
      } else {
        send(tab, { type: "ping", ts: now });
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Artifacts dir may not exist yet (fresh clone, or nothing written so far).
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: config.port,
    idleTimeout: 60,
    fetch(req, srv) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (process.env.BRIDGE_DEBUG) {
        process.stderr.write(`[bridge] ${req.method} ${pathname}\n`);
      }

      // --- static host ------------------------------------------------------
      if (pathname === "/" || pathname === "/embed-tableau.html") {
        return new Response(Bun.file(HTML_PATH), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === "/client/executor.js") {
        return getExecutorJs().then(
          (js) =>
            new Response(js, {
              headers: { "content-type": "text/javascript; charset=utf-8" },
            }),
          (err) => json({ error: String(err) }, 500)
        );
      }
      const scriptMatch = pathname.match(/^\/scripts\/([a-zA-Z0-9_-]+)\.js$/);
      if (scriptMatch) {
        return (async () => {
          const name = scriptMatch[1];
          if (!SCRIPT_NAME_RE.test(name)) {
            return json({ error: "invalid script name" }, 400);
          }
          const manifest = await readScriptManifest();
          if (!manifest.has(name)) {
            return json({ error: `unknown script: ${name}` }, 404);
          }
          const file = Bun.file(new URL(`${name}.js`, SCRIPTS_DIR));
          if (!(await file.exists())) {
            return json({ error: `script file missing: ${name}` }, 404);
          }
          return new Response(file, {
            headers: { "content-type": "text/javascript; charset=utf-8" },
          });
        })();
      }

      // --- artifacts host ----------------------------------------------------
      // Serve agent-produced artifacts (reports, exports) from temp/artifacts/
      // at /artifacts/<name>. Single-segment safe names only — no slashes, so
      // no path traversal; content-type is inferred from the file extension.
      const artifactMatch = pathname.match(/^\/artifacts\/([a-zA-Z0-9][a-zA-Z0-9._-]*)$/);
      if (artifactMatch) {
        return (async () => {
          const file = Bun.file(new URL(artifactMatch[1], ARTIFACTS_DIR));
          if (!(await file.exists())) {
            return json({ error: "artifact not found" }, 404);
          }
          return new Response(file);
        })();
      }

      // --- WS upgrade (token-guarded; the 401 doubles as the probe signature)
      if (pathname === "/ws") {
        if (url.searchParams.get("token") !== config.token) {
          return json({ error: "unauthorized" }, 401);
        }
        if (srv.upgrade(req, { data: { kind: "unknown", lastSeen: Date.now() } })) {
          return undefined;
        }
        return json({ error: "websocket upgrade required" }, 400);
      }

      return json({ error: "not found" }, 404);
    },
    websocket: {
      open() {
        // socket data is set at upgrade time
      },
      message(ws, raw) {
        handleMessage(ws, String(raw));
      },
      close(ws) {
        handleClose(ws);
      },
    },
  });

  return {
    port: server.port ?? config.port,
    token: config.token,
    store,
    stop: () => {
      clearInterval(heartbeat);
      server.stop(true);
    },
  };
}

// ---------------------------------------------------------------------------
// Direct-run entrypoint (spawned by the CLI's `start`)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  // PORT / BRIDGE_TOKEN are the internal handoff from the CLI's `start`
  // command to this spawned process — not user-facing config.
  const token = process.env.BRIDGE_TOKEN ?? crypto.randomUUID();
  const bridge = startBridge({
    port: Number(process.env.PORT ?? 3000),
    token,
  });
  process.stdout.write(
    [
      "Tableau session-bridge",
      `  URL:    http://localhost:${bridge.port}`,
      "  Ctrl+C to stop.",
      "",
    ].join("\n")
  );
}