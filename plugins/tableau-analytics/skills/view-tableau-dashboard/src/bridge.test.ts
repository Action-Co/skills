/**
 * bridge.test.ts — bridge relay, store, schemas, token guard, 401-probe
 * signature, and the closed-WS-equals-error guarantee.
 */

import { expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startBridge } from "./bridge.ts";
import { BridgeInboundSchema } from "./protocol.ts";
import { nextMsg, openSocket } from "./test-utils.ts";

const ARTIFACTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "artifacts"
);

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

test("artifacts route serves files from artifacts/ and rejects traversal", async () => {
  const { bridge, port } = setup();
  const file = join(ARTIFACTS_DIR, "test-report.html");
  await writeFile(file, "<h1>report</h1>", "utf8");
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/artifacts/test-report.html`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/html");
    expect(await ok.text()).toBe("<h1>report</h1>");

    const missing = await fetch(`http://127.0.0.1:${port}/artifacts/nope.html`);
    expect(missing.status).toBe(404);

    // Traversal attempt and dotted names are rejected by the safe-name regex.
    const traversal = await fetch(
      `http://127.0.0.1:${port}/artifacts/../package.json`
    );
    expect(traversal.status).toBe(404);
    const dotfile = await fetch(`http://127.0.0.1:${port}/artifacts/.env`);
    expect(dotfile.status).toBe(404);
  } finally {
    await rm(file, { force: true });
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

test("command schema accepts optional intent and rejects non-strings", () => {
  const ok = BridgeInboundSchema.safeParse({
    type: "command",
    session: "s",
    id: "i",
    js: "return 1;",
    intent: "Filtering to country = Canada",
  });
  expect(ok.success).toBe(true);

  // intent is optional — a bare command still validates.
  const bare = BridgeInboundSchema.safeParse({
    type: "command",
    session: "s",
    id: "i",
    js: "return 1;",
  });
  expect(bare.success).toBe(true);

  // Non-string intent is rejected (never reaches the page).
  const bad = BridgeInboundSchema.safeParse({
    type: "command",
    session: "s",
    id: "i",
    js: "return 1;",
    intent: 42,
  });
  expect(bad.success).toBe(false);
});

test("command intent passes through the bridge to the page", async () => {
  const { bridge, port, token } = setup();
  try {
    const page = await openSocket(port, token, "page");
    const cli = await openSocket(port, token, "cli");
    try {
      page.send(JSON.stringify({ type: "hello", session: "s-intent", ts: Date.now() }));

      const commandPromise = nextMsg(page, (m) => m.type === "command");
      cli.send(
        JSON.stringify({
          type: "command",
          session: "s-intent",
          id: "cmd-intent",
          js: "return 1;",
          intent: "Filtering to country = Canada",
        })
      );
      const command = await commandPromise;
      expect(command.id).toBe("cmd-intent");
      expect(command.js).toBe("return 1;");
      expect(command.intent).toBe("Filtering to country = Canada");
    } finally {
      page.close();
      cli.close();
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

test("say schema accepts text+hold and rejects bare say / non-boolean hold", () => {
  const ok = BridgeInboundSchema.safeParse({
    type: "say",
    session: "s",
    id: "say-1",
    text: "Please confirm the split before I proceed",
    hold: true,
  });
  expect(ok.success).toBe(true);

  // hold is optional — a bare say (with text) still validates.
  const noHold = BridgeInboundSchema.safeParse({
    type: "say",
    session: "s",
    id: "say-1",
    text: "Please confirm the split before I proceed",
  });
  expect(noHold.success).toBe(true);

  // bare say without text fails (never reaches the page).
  const bare = BridgeInboundSchema.safeParse({
    type: "say",
    session: "s",
    id: "say-1",
  });
  expect(bare.success).toBe(false);

  // Non-boolean hold is rejected.
  const badHold = BridgeInboundSchema.safeParse({
    type: "say",
    session: "s",
    id: "say-1",
    text: "Please confirm",
    hold: "yes",
  });
  expect(badHold.success).toBe(false);
});

test("say relay round trip: CLI -> bridge -> page, acked via result", async () => {
  const { bridge, port, token } = setup();
  try {
    const page = await openSocket(port, token, "page");
    const cli = await openSocket(port, token, "cli");
    try {
      page.send(JSON.stringify({ type: "hello", session: "s-say", ts: Date.now() }));

      // CLI sends a say; the page receives it and answers with the standard
      // result envelope (same correlation as an eval command).
      const sayPromise = nextMsg(page, (m) => m.type === "say");
      cli.send(
        JSON.stringify({
          type: "say",
          session: "s-say",
          id: "say-1",
          text: "hello there",
          hold: true,
        })
      );
      const say = await sayPromise;
      expect(say.id).toBe("say-1");
      expect(say.text).toBe("hello there");
      expect(say.hold).toBe(true);

      const resultPromise = nextMsg(cli, (m) => m.id === "say-1");
      page.send(
        JSON.stringify({
          type: "result",
          id: say.id,
          status: "ok",
          value: { delivered: true },
        })
      );
      const result = await resultPromise;
      expect(result.status).toBe("ok");
      expect((result.value as { delivered: boolean }).delivered).toBe(true);
    } finally {
      page.close();
      cli.close();
    }
  } finally {
    bridge.stop();
  }
});

test("say to an unknown session fails fast", async () => {
  const { bridge, port, token } = setup();
  try {
    const cli = await openSocket(port, token, "cli");
    try {
      const reply = nextMsg(cli, (m) => m.id === "say-unknown");
      cli.send(
        JSON.stringify({
          type: "say",
          session: "nope",
          id: "say-unknown",
          text: "hi",
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

test("say to a session with no live tab fails fast", async () => {
  const { bridge, port, token } = setup();
  try {
    const page = await openSocket(port, token, "page");
    page.send(JSON.stringify({ type: "hello", session: "s-say-dead", ts: Date.now() }));
    page.close();

    // Give the close handler a beat to flip the session to disconnected.
    await Bun.sleep(50);

    const cli = await openSocket(port, token, "cli");
    try {
      const reply = nextMsg(cli, (m) => m.id === "say-dead");
      cli.send(
        JSON.stringify({
          type: "say",
          session: "s-say-dead",
          id: "say-dead",
          text: "hi",
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