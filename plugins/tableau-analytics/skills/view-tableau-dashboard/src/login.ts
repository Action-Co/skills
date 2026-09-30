/**
 * login.ts — automated sign-in for authenticated Tableau Cloud embeds.
 *
 * Background: Tableau (Cloud/Server) now sets its session cookie
 * (`workgroup_session_id`) with `SameSite=None; Secure; Partitioned`. A
 * Partitioned cookie is double-keyed by the TOP-LEVEL site, so a session
 * established by visiting the Tableau origin in a normal tab does NOT carry
 * into an embed whose top-level site is `127.0.0.1:3000` (the bridge). The
 * embed instead shows Tableau's in-frame auth helper (`embeddedAuth.html`)
 * with a "Sign in to Tableau Cloud" button.
 *
 * This module automates that flow ONCE in a dedicated Chrome profile:
 *   1. opens the embed page (top-level = 127.0.0.1),
 *   2. clicks the auth-helper sign-in button → Tableau opens an SSO popup,
 *   3. fills email + password from the skill's `.env`,
 *   4. waits for the viz to reach `interactive` (the partition-scoped session
 *      is established during the iframe's PKCE token exchange).
 *
 * Embed tabs opened afterward (via `start`, which reuses the same profile)
 * carry the session and load the viz autonomously.
 *
 * Credentials are read from `TABLEAU_USERNAME` / `TABLEAU_PASSWORD` in the
 * skill's `.env` (gitignored). Uses playwright-core against the SYSTEM Chrome
 * (`channel: "chrome"`) — no browser download, no cloud dependency.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Frame, type Page } from "playwright-core";
import { BROWSER_PROFILE_DIR } from "./session.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = join(HERE, "..");

const VIEW_RE = /\/views\//i;
const NAV_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// .env loading (explicit, so invocation CWD doesn't matter)
// ---------------------------------------------------------------------------

function loadDotEnv(): void {
  const file = join(SKILL_ROOT, ".env");
  if (!existsSync(file)) {
    return;
  }
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) {
      continue;
    }
    const [, key, value] = m;
    if (!(key in process.env)) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
}

// ---------------------------------------------------------------------------
// Bridge status poll (confirm the viz actually reaches interactive)
// ---------------------------------------------------------------------------

function sessionStatus(
  port: number,
  token: string,
  sessionId: string
): Promise<{ state: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}&client=cli`
    );
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timed out asking the bridge for session status"));
    }, 5000);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ type: "status", session: sessionId }))
    );
    ws.addEventListener("message", (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === "status" && msg.session === sessionId) {
        clearTimeout(timer);
        ws.close();
        resolve({ state: String(msg.state) });
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("cannot reach the bridge"));
    });
  });
}

async function waitForInteractive(
  port: number,
  token: string,
  sessionId: string
): Promise<void> {
  const deadline = Date.now() + NAV_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const s = await sessionStatus(port, token, sessionId);
      if (s.state === "interactive") {
        return;
      }
      if (s.state === "error") {
        throw new Error("the viz reported an error state (see 'tableau-viz status')");
      }
    } catch {
      // bridge may be mid-restart; keep polling
    }
    await Bun.sleep(500);
  }
  throw new Error("the viz did not become interactive after signing in");
}

// ---------------------------------------------------------------------------
// Frame / popup automation
// ---------------------------------------------------------------------------

/** The Tableau in-frame auth helper or a sign-in frame inside the embed. */
function authFrame(page: Page): Frame | null {
  for (const frame of page.frames()) {
    const url = frame.url();
    if (!url) {
      continue;
    }
    if (/embeddedAuth|signin|sign-in|login|log-in/i.test(url)) {
      return frame;
    }
  }
  return null;
}

function hasViewFrame(page: Page): boolean {
  return page.frames().some((frame) => VIEW_RE.test(frame.url()));
}

async function waitForAuthFrame(
  page: Page
): Promise<Frame | null> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const frame = authFrame(page);
    if (frame) {
      return frame;
    }
    if (hasViewFrame(page)) {
      // Already authenticated (profile carried the session) — nothing to do.
      return null;
    }
    await Bun.sleep(300);
  }
  return null;
}

const SSO_EMAIL_SELECTOR =
  'input[name="email"], input[type="email"], input[name="username"], input[name="identifier"]';
const SSO_PASSWORD_SELECTOR =
  'input[type="password"], input[name="password"], input[name="credentials.passcode"]';
const SIGNIN_BUTTON_SELECTOR =
  'button:has-text("Sign In"), button:has-text("Sign in"), button[type="submit"]';

/**
 * Drive the SSO popup: email first, then the password step (Tableau SSO
 * reveals the password field after the email step is submitted).
 */
async function fillSsoForm(
  popup: Page,
  username: string,
  password: string
): Promise<void> {
  process.stderr.write(`[login] SSO page: ${popup.url()}\n`);

  const email = popup.locator(SSO_EMAIL_SELECTOR).first();
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.fill(username);

  const signin = popup.locator(SIGNIN_BUTTON_SELECTOR).first();
  const passwordField = popup.locator(SSO_PASSWORD_SELECTOR).first();

  if (await passwordField.isVisible().catch(() => false)) {
    await passwordField.fill(password);
    await signin.click();
  } else {
    // Email step first; the password field appears after.
    await signin.click();
    try {
      await passwordField.waitFor({ state: "visible", timeout: 15_000 });
    } catch {
      throw new Error(
        "a password field never appeared after the email step — this SSO may be " +
          "passwordless/OTP. Complete the login in the opened popup manually, or " +
          "use a connected-app JWT (the token seam) for fully headless auth."
      );
    }
    await passwordField.fill(password);
    const submit = popup.locator(SIGNIN_BUTTON_SELECTOR).first();
    await submit.click();
  }
}

/** Fallback for servers that host the form directly in the embed iframe. */
async function fillInFrameForm(
  frame: Frame,
  username: string,
  password: string
): Promise<void> {
  const userField = frame
    .locator(
      'input[name="username"], input#username, input[name="email"], input[type="email"]'
    )
    .first();
  const passField = frame
    .locator('input[name="password"], input#password, input[type="password"]')
    .first();
  await userField.fill(username);
  await passField.fill(password);
  const submit = frame
    .locator(
      'button[type="submit"], button:has-text("Sign in"), button:has-text("Sign In"), input[type="submit"]'
    )
    .first();
  await submit.click();
}

async function completeLogin(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  const frame = await waitForAuthFrame(page);
  if (!frame) {
    if (hasViewFrame(page)) {
      process.stderr.write(
        "[login] no sign-in needed — the profile already carries a session.\n"
      );
      return;
    }
    throw new Error(
      "no Tableau auth frame appeared in the embed and no view loaded — check the URL and your network."
    );
  }

  process.stderr.write(`[login] auth frame: ${frame.url()}\n`);

  // Tableau Cloud: the auth helper shows a "Sign in to Tableau Cloud" button
  // that opens the SSO popup.
  const signinButton = frame.locator(SIGNIN_BUTTON_SELECTOR).first();
  if (await signinButton.isVisible().catch(() => false)) {
    const popupPromise = page
      .waitForEvent("popup", { timeout: 20_000 })
      .catch(() => null);
    await signinButton.click();
    const popup = await popupPromise;
    if (popup) {
      await fillSsoForm(popup, username, password);
      return;
    }
  }

  // Otherwise the frame itself hosts the form.
  await fillInFrameForm(frame, username, password);
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export interface LoginOptions {
  session: { id: string; port: number; token: string };
  tabUrl: string;
}

export async function runLogin(opts: LoginOptions): Promise<void> {
  loadDotEnv();

  const username = process.env.TABLEAU_USERNAME ?? process.env.TABLEAU_USER;
  const password = process.env.TABLEAU_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "missing credentials — set TABLEAU_USERNAME and TABLEAU_PASSWORD in the skill's .env (see .env.template)"
    );
  }

  process.stderr.write("[login] launching Chrome (dedicated profile)…\n");
  const ctx: BrowserContext = await chromium.launchPersistentContext(
    BROWSER_PROFILE_DIR,
    { channel: "chrome", headless: false }
  );

  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    process.stderr.write(`[login] opening embed tab: ${opts.tabUrl}\n`);
    await page.goto(opts.tabUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await completeLogin(page, username, password);

    process.stderr.write("[login] submitted credentials — waiting for the viz…\n");
    await waitForInteractive(
      opts.session.port,
      opts.session.token,
      opts.session.id
    );

    process.stderr.write(
      "[login] authenticated — the partition-scoped session is saved in the login profile; subsequent embed tabs reuse it.\n"
    );
  } finally {
    await ctx.close();
  }
}