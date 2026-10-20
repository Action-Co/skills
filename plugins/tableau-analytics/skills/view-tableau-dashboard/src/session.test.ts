/**
 * session.test.ts — session registry, id minting, resolution, port probe,
 * URL validation + library derivation.
 */

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTabUrl,
  deriveLibUrl,
  isAlive,
  mintSessionId,
  originOf,
  probePort,
  readRegistry,
  resolveSession,
  validateVizUrl,
  writeRegistry,
  type Session,
} from "./session.ts";
import { startBridge } from "./bridge.ts";

function fakeSession(over: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    url: "https://public.tableau.com/views/SOC/Security",
    port: 3000,
    token: "t",
    pid: -1,
    tabUrl: "http://127.0.0.1:3000/?session=sess-1",
    createdAt: 1,
    ...over,
  };
}

test("mintSessionId produces unique ids", () => {
  const a = mintSessionId();
  const b = mintSessionId();
  expect(a).not.toBe(b);
  expect(a.startsWith("sess-")).toBe(true);
});

test("registry write/read round trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vtv-session-"));
  const file = join(dir, "sessions.json");
  try {
    await writeRegistry([fakeSession()], file);
    const raw = await readFile(file, "utf8");
    expect(JSON.parse(raw)).toHaveLength(1);
    const sessions = await readRegistry(file);
    expect(sessions[0]?.id).toBe("sess-1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readRegistry tolerates a corrupt file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vtv-session-"));
  const file = join(dir, "sessions.json");
  try {
    await writeFile(file, "not json {");
    expect(await readRegistry(file)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveSession: default, explicit, latest, and ambiguity errors", () => {
  const older = fakeSession({ id: "sess-a", createdAt: 10 });
  const newer = fakeSession({ id: "sess-b", createdAt: 20 });

  // Exactly one → default.
  expect(resolveSession([older]).id).toBe("sess-a");

  // Several → require --session or --latest.
  expect(() => resolveSession([older, newer])).toThrow(/pass --session/);
  expect(resolveSession([older, newer], { latest: true }).id).toBe("sess-b");
  expect(resolveSession([older, newer], { session: "sess-a" }).id).toBe("sess-a");

  // None → clear error.
  expect(() => resolveSession([])).toThrow(/no sessions/);

  // Unknown id → clear error.
  expect(() => resolveSession([older], { session: "zzz" })).toThrow(/unknown session/);
});

test("isAlive treats <= 0 as dead", () => {
  expect(isAlive(-1)).toBe(false);
  expect(isAlive(0)).toBe(false);
  expect(isAlive(999999999)).toBe(false);
});

test("probePort classifies our bridge, a foreign server, and a free port", async () => {
  const bridge = startBridge({ port: 0, token: "probe-token" });
  try {
    const ours = await probePort(bridge.port);
    expect(ours.state).toBe("our-bridge");

    // A foreign server returns a non-401 response.
    const foreign = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("hi"),
    });
    try {
      const f = await probePort(foreign.port as number);
      expect(f.state).toBe("foreign");
    } finally {
      foreign.stop(true);
    }

    // A free port (refused connection).
    const free = await probePort(65000);
    expect(free.state).toBe("free");
  } finally {
    bridge.stop();
  }
});

test("validateVizUrl accepts view URLs and rejects non-views / non-http", () => {
  expect(
    validateVizUrl("https://public.tableau.com/views/SOC/SecurityOps")
  ).toContain("/views/SOC/SecurityOps");
  expect(
    validateVizUrl("https://tableau.example.com/#/views/Superstore/Overview")
  ).toContain("/views/Superstore/Overview");
  expect(() => validateVizUrl("https://public.tableau.com/profile/x")).toThrow(
    /does not look like a Tableau view/
  );
  expect(() => validateVizUrl("ftp://public.tableau.com/views/X/Y")).toThrow(
    /http/
  );
  expect(() => validateVizUrl("not a url")).toThrow(/not a valid URL/);
});

test("validateVizUrl normalizes to the canonical embed form", () => {
  // Browser address-bar / web-UI route (#/site/<site>/views/...) -> /t/<site>/views/...
  expect(
    validateVizUrl(
      "https://10ay.online.tableau.com/#/site/getaction/views/Superstore/WhatIfForecast?:iid=1"
    )
  ).toBe(
    "https://10ay.online.tableau.com/t/getaction/views/Superstore/WhatIfForecast"
  );

  // Canonical path form passes through unchanged.
  expect(
    validateVizUrl("https://10ay.online.tableau.com/t/getaction/views/Superstore/Overview")
  ).toBe(
    "https://10ay.online.tableau.com/t/getaction/views/Superstore/Overview"
  );

  // Query string / fragment stripped from the path form.
  expect(
    validateVizUrl("https://10ay.online.tableau.com/t/getaction/views/Superstore/Overview?:iid=1")
  ).toBe(
    "https://10ay.online.tableau.com/t/getaction/views/Superstore/Overview"
  );

  // Public (no site) stays on /views/...
  expect(
    validateVizUrl("https://public.tableau.com/views/DashboardStartersOpportunityOverview/OpportunityOverview")
  ).toBe(
    "https://public.tableau.com/views/DashboardStartersOpportunityOverview/OpportunityOverview"
  );

  // The /views/... segment is preserved verbatim — display-name (space) slugs
  // are NOT rewritten (documented limitation: use the share-dialog slug).
  expect(
    validateVizUrl("https://10ay.online.tableau.com/t/getaction/views/Superstore/What%20If%20Forecast")
  ).toBe(
    "https://10ay.online.tableau.com/t/getaction/views/Superstore/What%20If%20Forecast"
  );
});

test("deriveLibUrl derives from origin and honors an override", () => {
  const url = "https://public.tableau.com/views/SOC/SecurityOps";
  expect(deriveLibUrl(url)).toBe(
    "https://public.tableau.com/javascripts/api/tableau.embedding.3.latest.min.js"
  );
  const serverUrl = "https://tableau.corp.com/views/SOC/Overview";
  expect(deriveLibUrl(serverUrl)).toBe(
    "https://tableau.corp.com/javascripts/api/tableau.embedding.3.latest.min.js"
  );
  expect(deriveLibUrl(url, "https://cdn.example.com/lib.js")).toBe(
    "https://cdn.example.com/lib.js"
  );
  expect(() => deriveLibUrl(url, "not a url")).toThrow(/not a valid URL/);
});

test("originOf extracts the origin", () => {
  expect(originOf("https://public.tableau.com/views/SOC/X")).toBe(
    "https://public.tableau.com"
  );
});

test("buildTabUrl carries session/url/token/script/viz-size params", () => {
  const tabUrl = buildTabUrl({
    port: 3000,
    session: "sess-9",
    url: "https://public.tableau.com/views/SOC/X",
    token: "t-1",
    script: "explore",
    vizWidth: "2560",
    vizHeight: "1440",
  });
  const url = new URL(tabUrl);
  expect(url.searchParams.get("session")).toBe("sess-9");
  expect(url.searchParams.get("token")).toBe("t-1");
  expect(url.searchParams.get("script")).toBe("explore");
  expect(url.searchParams.get("url")).toContain("/views/SOC/X");
  expect(url.searchParams.get("viz-width")).toBe("2560");
  expect(url.searchParams.get("viz-height")).toBe("1440");

  // Optional size params are omitted when absent.
  const bare = new URL(
    buildTabUrl({
      port: 3000,
      session: "sess-10",
      url: "https://public.tableau.com/views/SOC/Y",
      token: "t-2",
    })
  );
  expect(bare.searchParams.get("viz-width")).toBeNull();
  expect(bare.searchParams.get("viz-height")).toBeNull();
});