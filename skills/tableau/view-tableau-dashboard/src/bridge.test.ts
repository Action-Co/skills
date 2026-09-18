/**
 * bridge.test.ts — bridge relay, store, schemas, token guard, 401-probe
 * signature, and the closed-WS-equals-error guarantee.
 */

import { expect, test } from "bun:test";
import { startBridge } from "./bridge.ts";

function nextMsg(
  ws: WebSocket,
  match: (m: Record<string, unknown>) => boolean,
  timeoutMs = 4000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timeout waiting for ws message"));
    }, timeoutMs);
    const handler = (ev: { data?: unknown }): void => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (match(msg)) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        resolve(msg);
      }
    };
    ws.addEventListener("message", handler);
  });
}

function openSocket(
  port: number,
  token: string,
  client: "page" | "cli"
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}&client=${client}`
    );
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("socket failed to open")));
  });
}

function setup() {
  const token = "test-token";
  const bridge = startBridge({ port: 0, token });
  const port = bridge.port;
  return { bridge, port, token };
}

test("401-probe signature + token guard on /ws", async () => {
  const { bridge, port } = setup();
  try {
    // Unauthenticated request to /ws yields our unique 401 envelope — the
    // probePort signature.
    const res = await fetch(`http://127.0.0.1:${port}/ws`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });

    // Wrong token → 401.
    const bad = await fetch(`http://127.0.0.1:${port}/ws?token=wrong`);
    expect(bad.status).toBe(401);

    // Correct token without a websocket upgrade → 400 (upgrade required).
    const ok = await fetch(`http://127.0.0.1:${port}/ws?token=test-token`);
    expect(ok.status).toBe(400);
  } finally {
    bridge.stop();
  }
});

test("page hello + eval relay round trip", async () => {
  const { bridge, port, token } = setup();
  try {
    const page = await openSocket(port, token, "page");
    const cli = await openSocket(port, token, "cli");
    try {
      page.send(
        JSON.stringify({ type: "hello", session: "s1", ts: Date.now() })
      );

      // CLI sends a command; the page receives it and answers.
      const commandPromise = nextMsg(page, (m) => m.type === "command");
      cli.send(
        JSON.stringify({
          type: "command",
          session: "s1",
          id: "cmd-1",
          js: "return 1 + 1;",
        })
      );
      const command = await commandPromise;
      expect(command.id).toBe("cmd-1");
      expect(command.js).toBe("return 1 + 1;");

      const resultPromise = nextMsg(cli, (m) => m.id === "cmd-1");
      page.send(
        JSON.stringify({ type: "result", id: "cmd-1", status: "ok", value: 2 })
      );
      const result = await resultPromise;
      expect(result.status).toBe("ok");
      expect(result.value).toBe(2);
    } finally {
      page.close();
      cli.close();
    }
  } finally {
    bridge.stop();
  }
});

test("state pushes are stored and readable by a later CLI connection", async () => {
  const { bridge, port, token } = setup();
  try {
    const page = await openSocket(port, token, "page");
    try {
      page.send(
        JSON.stringify({ type: "hello", session: "s2", ts: Date.now() })
      );
      page.send(
        JSON.stringify({
          type: "state",
          session: "s2",
          state: "loading",
        })
      );
      page.send(
        JSON.stringify({
          type: "state",
          session: "s2",
          state: "interactive",
          snapshot: { workbook: { name: "W" } },
        })
      );

      // A fresh CLI connection reads the stored state without having been
      // connected at transition time.
      const cli = await openSocket(port, token, "cli");
      try {
        const reply = nextMsg(cli, (m) => m.type === "status" && m.session === "s2");
        cli.send(JSON.stringify({ type: "status", session: "s2" }));
        const status = await reply;
        expect(status.state).toBe("interactive");
        expect((status.snapshot as { workbook: { name: string } }).workbook.name).toBe("W");
      } finally {
        cli.close();
      }
    } finally {
      page.close();
    }
  } finally {
    bridge.stop();
  }
});

test("command to an unknown session fails fast", async () => {
  const { bridge, port, token } = setup();
  try {
    const cli = await openSocket(port, token, "cli");
    try {
      const reply = nextMsg(cli, (m) => m.id === "cmd-unknown");
      cli.send(
        JSON.stringify({
          type: "command",
          session: "nope",
          id: "cmd-unknown",
          js: "return 1;",
        })
      );
      const result = await reply;
      expect(result.status).toBe("error");
      expect(String(result.error)).toContain("unknown session");
    } finally {
      cli.close();
    }
  } finally {
    bridge.stop();
  }
});

test("command to a session with no live tab fails fast (closed WS = error)", async () => {
  const { bridge, port, token } = setup();
  try {
    const page = await openSocket(port, token, "page");
    page.send(JSON.stringify({ type: "hello", session: "s3", ts: Date.now() }));
    page.close();

    // Give the close handler a beat to flip the session to disconnected.
    await Bun.sleep(50);

    const cli = await openSocket(port, token, "cli");
    try {
      const reply = nextMsg(cli, (m) => m.id === "cmd-dead");
      cli.send(
        JSON.stringify({
          type: "command",
          session: "s3",
          id: "cmd-dead",
          js: "return 1;",
        })
      );
      const result = await reply;
      expect(result.status).toBe("error");
      expect(String(result.error)).toContain("no connected tab");
    } finally {
      cli.close();
    }
  } finally {
    bridge.stop();
  }
});

test("wait subscription streams state transitions", async () => {
  const { bridge, port, token } = setup();
  try {
    const page = await openSocket(port, token, "page");
    const cli = await openSocket(port, token, "cli");
    try {
      page.send(JSON.stringify({ type: "hello", session: "s4", ts: Date.now() }));

      const interactive = nextMsg(
        cli,
        (m) => m.type === "state" && m.session === "s4" && m.state === "interactive"
      );
      cli.send(JSON.stringify({ type: "wait", session: "s4" }));

      page.send(
        JSON.stringify({ type: "state", session: "s4", state: "loading" })
      );
      page.send(
        JSON.stringify({
          type: "state",
          session: "s4",
          state: "interactive",
          snapshot: { ok: true },
        })
      );
      const got = await interactive;
      expect((got.snapshot as { ok: boolean }).ok).toBe(true);
    } finally {
      page.close();
      cli.close();
    }
  } finally {
    bridge.stop();
  }
});

test("metadata progress is stored and streamed", async () => {
  const { bridge, port, token } = setup();
  try {
    const page = await openSocket(port, token, "page");
    const cli = await openSocket(port, token, "cli");
    try {
      page.send(JSON.stringify({ type: "hello", session: "s5", ts: Date.now() }));
      // Register the subscription and wait for the wait-ack so the metadata
      // push cannot race ahead of it.
      cli.send(JSON.stringify({ type: "wait", session: "s5" }));
      await nextMsg(cli, (m) => m.type === "state" && m.session === "s5");

      const metaMsg = nextMsg(cli, (m) => m.type === "metadata" && m.session === "s5");
      page.send(
        JSON.stringify({
          type: "metadata",
          session: "s5",
          status: "partial",
          progress: {
            completedCalls: 3,
            totalCalls: 4,
            completedWorksheets: 1,
            totalWorksheets: 2,
            elapsedMs: 5,
          },
          errors: ["x"],
        })
      );
      const got = await metaMsg;
      expect(got.status).toBe("partial");
      expect((got.progress as { completedCalls: number }).completedCalls).toBe(3);
      expect((got.errors as string[])[0]).toBe("x");
    } finally {
      page.close();
      cli.close();
    }
  } finally {
    bridge.stop();
  }
});