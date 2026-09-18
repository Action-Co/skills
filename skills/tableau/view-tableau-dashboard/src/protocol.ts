/**
 * protocol.ts — the WebSocket wire contract for the session-bridge.
 *
 * Every message is a JSON envelope discriminated by `type`, validated with Zod
 * on receipt at BOTH ends (bridge, and CLI). The browser page consumes the
 * same shapes but is delivered as bundled JS, so it relies on the bridge's
 * validation rather than importing Zod itself.
 *
 * Channels:
 *   page <-> bridge  : hello / state / metadata / result / command / ping/pong
 *   cli  <-> bridge  : command / status / wait / list / drop / state / metadata
 *                      / result / list (reply)
 *
 * See docs/PROTOCOL.md for the human-readable version.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/** The viz lifecycle state machine. `disconnected` is derived server-side. */
export const SessionStateSchema = z.enum([
  "connecting",
  "loading",
  "interactive",
  "error",
  "disconnected",
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const MetadataStatusSchema = z.enum(["loading", "loaded", "partial"]);
export type MetadataStatus = z.infer<typeof MetadataStatusSchema>;

export const MetadataProgressSchema = z.object({
  completedCalls: z.number(),
  totalCalls: z.number(),
  completedWorksheets: z.number(),
  totalWorksheets: z.number(),
  elapsedMs: z.number(),
});
export type MetadataProgress = z.infer<typeof MetadataProgressSchema>;

// ---------------------------------------------------------------------------
// Browser -> Bridge
// ---------------------------------------------------------------------------

/** Register the tab for a session. Sent once on WS open (and after reconnect). */
export const HelloSchema = z.object({
  type: z.literal("hello"),
  session: z.string().min(1),
  ts: z.number(),
  url: z.string().optional(),
  script: z.string().optional(),
});
export type Hello = z.infer<typeof HelloSchema>;

/** Viz lifecycle transition pushed by the page. Carries the instant snapshot. */
export const StateMessageSchema = z.object({
  type: z.literal("state"),
  session: z.string().min(1),
  state: SessionStateSchema,
  snapshot: z.unknown().optional(),
  error: z.string().optional(),
  scriptResult: z.unknown().optional(),
});
export type StateMessage = z.infer<typeof StateMessageSchema>;

/** Background metadata fill progress (debounced). */
export const MetadataMessageSchema = z.object({
  type: z.literal("metadata"),
  session: z.string().min(1),
  status: MetadataStatusSchema,
  progress: MetadataProgressSchema,
  errors: z.array(z.string()).default([]),
});
export type MetadataMessage = z.infer<typeof MetadataMessageSchema>;

/** Eval completion from the page, correlated to a `command` id. */
export const ResultSchema = z.discriminatedUnion("status", [
  z.object({
    type: z.literal("result"),
    id: z.string().min(1),
    status: z.literal("ok"),
    value: z.unknown(),
  }),
  z.object({
    type: z.literal("result"),
    id: z.string().min(1),
    status: z.literal("error"),
    error: z.string(),
  }),
]);
export type ResultMessage = z.infer<typeof ResultSchema>;

// ---------------------------------------------------------------------------
// Bridge -> Browser
// ---------------------------------------------------------------------------

/** An eval to run in the page. Execution is serialized per tab. */
export const CommandMessageSchema = z.object({
  type: z.literal("command"),
  id: z.string().min(1),
  js: z.string().min(1),
});
export type CommandMessage = z.infer<typeof CommandMessageSchema>;

/** Heartbeat: bridge pings the page; the page answers `pong`. */
export const PingSchema = z.object({
  type: z.literal("ping"),
  ts: z.number(),
});
export const PongSchema = z.object({
  type: z.literal("pong"),
  ts: z.number(),
});

/** Ask the page to close its tab (best-effort). */
export const CloseSchema = z.object({
  type: z.literal("close"),
});
export type CloseMessage = z.infer<typeof CloseSchema>;

// ---------------------------------------------------------------------------
// Agent CLI -> Bridge
// ---------------------------------------------------------------------------

/** Route an eval to a tab. `command` with no live tab fails fast. */
export const CliCommandSchema = z.object({
  type: z.literal("command"),
  session: z.string().min(1),
  id: z.string().min(1),
  js: z.string().min(1),
});
export type CliCommand = z.infer<typeof CliCommandSchema>;

/** One-shot status snapshot from the bridge store. */
export const StatusRequestSchema = z.object({
  type: z.literal("status"),
  session: z.string().min(1),
});
export type StatusRequest = z.infer<typeof StatusRequestSchema>;

/** Subscribe to a session's state/metadata stream (until the CLI closes). */
export const WaitRequestSchema = z.object({
  type: z.literal("wait"),
  session: z.string().min(1),
});
export type WaitRequest = z.infer<typeof WaitRequestSchema>;

/** List every known session + live state from the bridge store. */
export const ListRequestSchema = z.object({
  type: z.literal("list"),
});
export type ListRequest = z.infer<typeof ListRequestSchema>;

/** Drop a session: forget its store entry and close its tab socket. */
export const DropRequestSchema = z.object({
  type: z.literal("drop"),
  session: z.string().min(1),
});
export type DropRequest = z.infer<typeof DropRequestSchema>;

// ---------------------------------------------------------------------------
// Bridge -> Agent CLI
// ---------------------------------------------------------------------------

/** The bridge's view of one session, for `status` / `ls`. */
export const StatusReplySchema = z.object({
  type: z.literal("status"),
  session: z.string().min(1),
  state: SessionStateSchema,
  snapshot: z.unknown().optional(),
  error: z.string().optional(),
  metadata: z
    .object({
      status: MetadataStatusSchema,
      progress: MetadataProgressSchema,
      errors: z.array(z.string()).default([]),
    })
    .optional(),
});
export type StatusReply = z.infer<typeof StatusReplySchema>;

export const ListReplySchema = z.object({
  type: z.literal("list"),
  sessions: z.array(
    z.object({
      session: z.string(),
      state: SessionStateSchema,
      metadataStatus: MetadataStatusSchema.optional(),
      script: z.string().optional(),
    })
  ),
});
export type ListReply = z.infer<typeof ListReplySchema>;

// ---------------------------------------------------------------------------
// Union + receive-side validation
// ---------------------------------------------------------------------------

/** Everything the bridge can receive (from page or CLI). */
export const BridgeInboundSchema = z.discriminatedUnion("type", [
  HelloSchema,
  StateMessageSchema,
  MetadataMessageSchema,
  ResultSchema,
  PongSchema,
  CliCommandSchema,
  StatusRequestSchema,
  WaitRequestSchema,
  ListRequestSchema,
  DropRequestSchema,
]);

/** Everything the bridge can send. */
export const BridgeOutboundSchema = z.discriminatedUnion("type", [
  CommandMessageSchema,
  PingSchema,
  CloseSchema,
  ResultSchema,
  StatusReplySchema,
  ListReplySchema,
  StateMessageSchema,
  MetadataMessageSchema,
]);

export type BridgeInbound = z.infer<typeof BridgeInboundSchema>;
export type BridgeOutbound = z.infer<typeof BridgeOutboundSchema>;