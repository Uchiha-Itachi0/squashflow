/**
 * The helper's HTTP API: request bodies the helper validates, and the responses the
 * extension reads back. Requests are strict (unknown fields rejected); responses are
 * parsed leniently, so a newer helper may add fields without breaking an older extension.
 */

// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";
import { pageUrlSchema, pinSchema } from "./schemas.js";

/** The default port the helper listens on, on 127.0.0.1. */
export const DEFAULT_HELPER_PORT = 47821;

/** Most pins delivered in one message. */
export const MAX_PINS_PER_MESSAGE = 50;

/** A pin or message id: `sf-` and 12 hex digits. */
export const PIN_ID_PATTERN = /^sf-[0-9a-f]{12}$/;

export const pinIdSchema = z.string().regex(PIN_ID_PATTERN);
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const pairRequestSchema = z.strictObject({
  code: z.string().min(1).max(32),
});

export const pinsRequestSchema = z.strictObject({
  /** The session's pid, or its exact name. */
  session: z.union([z.number().int().positive(), z.string().min(1).max(200)]),
  pageUrl: pageUrlSchema,
  pins: z.array(pinSchema).min(1).max(MAX_PINS_PER_MESSAGE),
  /** Build and return the exact message without delivering it. */
  preview: z.boolean().optional(),
  /** From the preview response; required to deliver. */
  pinId: pinIdSchema.optional(),
  digest: digestSchema.optional(),
});

export const pairResponseSchema = z.object({ token: z.string().min(16).max(128) });

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  paired: z.boolean(),
  version: z.string(),
});

/** A running Claude Code session as `GET /sessions` reports it. */
export const publicSessionSchema = z.object({
  pid: z.number().int().positive(),
  name: z.string(),
  /** `idle` or `busy` from Claude Code; `unknown` when it did not say. */
  status: z.string(),
  cwd: z.string(),
  /** `owner/repo` (or `host/owner/repo` off GitHub), or null when the folder has none. */
  repo: z.string().nullable(),
});

export const sessionsResponseSchema = z.object({ sessions: z.array(publicSessionSchema) });

export const previewResponseSchema = z.object({
  pinId: pinIdSchema,
  digest: digestSchema,
  message: z.string(),
});

/**
 * A delivered pin's status as the helper reports it: Sent, Approve in terminal, Seen by
 * Claude, Fixed (Claude replied with a pull request link) or Blocked (never picked up).
 * Resolved is the user's own mark and lives only in the extension.
 */
export const PIN_STATUSES = ["sent", "approve-in-terminal", "seen", "fixed", "blocked"] as const;

/** Longest reply kept from the transcript; longer replies are cut and marked as cut. */
export const MAX_REPLY_CHARS = 8000;
/** Most messages kept on one pin's thread. */
export const MAX_THREAD_MESSAGES = 20;

/**
 * A GitHub pull request link, the only kind of link the extension renders. Anything else
 * in a reply stays plain text.
 */
export const PULL_REQUEST_URL_PATTERN =
  /https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}\/pull\/[0-9]{1,10}(?![0-9])/;

export const pullRequestUrlSchema = z
  .string()
  .max(300)
  .refine(
    (value) => new RegExp(`^${PULL_REQUEST_URL_PATTERN.source}$`).test(value),
    "must be a GitHub pull request link",
  );

/** Claude's reply to a pin, picked out of the session transcript. Untrusted plain text. */
export const threadMessageSchema = z.object({
  id: z.string().min(1).max(64),
  from: z.literal("claude"),
  text: z.string().max(MAX_REPLY_CHARS + 1),
  /** Whether the reply was longer than `MAX_REPLY_CHARS` and was cut. */
  truncated: z.boolean(),
  at: z.string().max(40),
});

export const pinRecordSchema = z.object({
  id: pinIdSchema,
  number: z.number().int().positive(),
  sessionPid: z.number().int().positive(),
  sessionName: z.string(),
  status: z.enum(PIN_STATUSES),
  statusLabel: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Claude's replies; a batch shares one record, so every pin in it shares the thread. */
  thread: z.array(threadMessageSchema).max(MAX_THREAD_MESSAGES).default([]),
  /** The pull request link from Claude's reply, once the pin is Fixed. */
  pullRequestUrl: pullRequestUrlSchema.nullable().default(null),
  /** Whether the helper is still following the transcript for this pin. */
  following: z.boolean().default(false),
  /** Goes up with every change, so a client can tell a stale read from a newer event. */
  revision: z.number().int().nonnegative().default(0),
});

export const deliveredResponseSchema = z.object({ pin: pinRecordSchema });

export const errorResponseSchema = z.object({ error: z.string() });

export type PairRequest = z.infer<typeof pairRequestSchema>;
export type PinsRequest = z.infer<typeof pinsRequestSchema>;
export type PairResponse = z.infer<typeof pairResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type PublicSession = z.infer<typeof publicSessionSchema>;
export type PreviewResponse = z.infer<typeof previewResponseSchema>;
export type PinStatus = (typeof PIN_STATUSES)[number];
export type PinRecord = z.infer<typeof pinRecordSchema>;
export type ThreadMessage = z.infer<typeof threadMessageSchema>;
