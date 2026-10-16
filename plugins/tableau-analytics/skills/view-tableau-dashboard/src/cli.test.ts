/**
 * cli.test.ts — end-to-end test of the real `say` CLI command against a real
 * bridge + a fake page socket (no browser). Exercises the full wire: the CLI
 * resolves the session from the registry, requires the bridge, sends
 * `{type:"say",...}`, the bridge relays it to the page, the page acks with the
 * standard `result` envelope, and the CLI renders the ack value.
 *
 * The registry (temp/sessions.json) is backed up and restored around the test;
 * the entry added here is a throwaway with pid = process.pid (alive), so
 * pruneRegistry keeps it while the test runs.
 */

import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startBridge } from "./bridge.ts";
import { SESSION_FILE, writeRegistry } from "./session.ts";
import { nextMsg, openSocket } from "./test-utils.ts";

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(SKILL_ROOT, "src", "cli.ts");
const TOKEN = "cli-test-token";

// Async (non-blocking) spawn is REQUIRED: the bridge and the page socket live
// in this process, so the event loop must stay free for the bridge to relay the
// CLI's `say` and for the page handler to ack — a blocking spawnSync would
// deadlock the round trip (the CLI waits up to 100s for the result; we cap at a
// modest timeout so a hung round trip fails fast).
function runSay(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [CLI, "say", ...args]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`CLI say ${args.join(" ")} failed (${code}): ${stderr}`));
      } else {
        resolve({ status: code, stdout, stderr });
      }
    });
  });
}

test("CLI `say` posts a toast on the tab and prints { delivered: true }", async () => {
  const backup = existsSync(SESSION_FILE) ? await readFile(SESSION_FILE, "utf8") : null;
  const bridge = startBridge({ port: 0, token: TOKEN });
  const sessionId = "sess-cli-say-test";
  try {
    await writeRegistry([
      {
        id: sessionId,
        url: "https://public.tableau.com/views/SOC/SecurityOperationsCentre",
        port: bridge.port,
        token: bridge.token,
        pid: process.pid,
        tabUrl: `http://127.0.0.1:${bridge.port}/`,
        createdAt: Date.now(),
      },
    ]);

    const page = await openSocket(bridge.port, bridge.token, "page");
    try {
      page.send(JSON.stringify({ type: "hello", session: sessionId, ts: Date.now() }));

      // Ack helper: wait for the bridge to deliver a `say` to the page, then
      // ack with the standard result envelope so the CLI completes.
      const sayAndAck = async (): Promise<Record<string, unknown>> => {
        const msg = await nextMsg(page, (m) => m.type === "say");
        page.send(
          JSON.stringify({
            type: "result",
            id: String(msg.id),
            status: "ok",
            value: { delivered: true },
          })
        );
        return msg;
      };

      // Default (no --hold). Start the CLI first, then await the page-side
      // `say` + ack — the CLI won't exit until the ack lands.
      const plainRun = runSay(["hello there", "--session", sessionId, "-f", "json"]);
      const plainSay = await sayAndAck();
      const plain = await plainRun;
      expect(plain.status).toBe(0);
      expect(JSON.parse(plain.stdout)).toEqual({ delivered: true });
      expect(plainSay.text).toBe("hello there");
      expect(plainSay.hold).toBeUndefined();

      // --hold variant passes hold: true through to the page.
      const heldRun = runSay(["please confirm", "--session", sessionId, "--hold", "-f", "json"]);
      const heldSay = await sayAndAck();
      const held = await heldRun;
      expect(held.status).toBe(0);
      expect(JSON.parse(held.stdout)).toEqual({ delivered: true });
      expect(heldSay.text).toBe("please confirm");
      expect(heldSay.hold).toBe(true);
    } finally {
      page.close();
    }
  } finally {
    bridge.stop();
    // Restore the pre-test registry exactly (or remove the file we created).
    if (backup === null) {
      await rm(SESSION_FILE, { force: true });
    } else {
      await writeFile(SESSION_FILE, backup, "utf8");
    }
  }
});