/**
 * test-utils.ts — shared helpers for bridge/CLI unit tests.
 *
 * Every test that talks to a bridge does the same two things: open a WS socket
 * to it, and wait for a specific message to arrive. Extract them here so
 * bridge.test.ts and cli.test.ts stop duplicating the wiring.
 */

/** Open a WebSocket to a bridge on localhost, tagged as a page or CLI client. */
export function openSocket(
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

/**
 * Resolve with the next WS message matching `match`. The listener is removed on
 * match; on timeout the socket is closed and the promise rejects.
 */
export function nextMsg(
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