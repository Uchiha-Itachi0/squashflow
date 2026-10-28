/**
 * The helper's HTTP API: request bodies the helper validates, and the responses the
 * extension reads back. Requests are strict (unknown fields rejected); responses are
 * parsed leniently, so a newer helper may add fields without breaking an older extension.
 */

// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";
import { FOLLOW_UP_ACTIONS, MAX_BLOCKED_REASON_CHARS } from "./github.js";
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

/**
 * A follow-up to a pin that is Blocked: GitHub access, sent to the session that has it.
 * Like a pin, it is previewed first and delivered only with the preview's digest.
 */
export const followUpRequestSchema = z.strictObject({
  action: z.enum(FOLLOW_UP_ACTIONS),
  preview: z.boolean().optional(),
  digest: digestSchema.optional(),
});

export const pairResponseSchema = z.object({ token: z.string().min(16).max(128) });

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  paired: z.boolean(),
  version: z.string(),
});

/** Longest session title the helper reports. */
export const MAX_SESSION_TITLE_CHARS = 80;
/** Longest branch name the helper reports. */
export const MAX_BRANCH_CHARS = 100;
/** Longest account label and email the helper reports. */
export const MAX_ACCOUNT_LABEL_CHARS = 60;
export const MAX_ACCOUNT_EMAIL_CHARS = 254;
/** Longest terminal label (a herdr workspace name) the helper reports. */
export const MAX_TERMINAL_LABEL_CHARS = 60;

/**
 * The Claude account a session runs under, from that account's own `.claude.json`: a
 * short label (its organisation, or else its email's domain) and its email. Nothing else
 * about the account leaves the helper.
 */
export const sessionAccountSchema = z.object({
  label: z.string().max(MAX_ACCOUNT_LABEL_CHARS),
  email: z.string().max(MAX_ACCOUNT_EMAIL_CHARS).nullable(),
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
  /**
   * What the session is about: Claude Code's own title for it, or else the start of its
   * first prompt. Untrusted plain text on one line, at most `MAX_SESSION_TITLE_CHARS`.
   */
  title: z.string().max(MAX_SESSION_TITLE_CHARS).nullable().default(null),
  /** The git branch checked out in the session's folder; null when detached or unknown. */
  branch: z.string().max(MAX_BRANCH_CHARS).nullable().default(null),
  /** When the session started, ISO 8601. */
  startedAt: z.string().max(40).nullable().default(null),
  /** When the session last wrote to its transcript, ISO 8601. */
  lastActiveAt: z.string().max(40).nullable().default(null),
  /** The Claude account the session runs under; null when it could not be read. */
  account: sessionAccountSchema.nullable().default(null),
  /**
   * The name of the terminal workspace the session runs in (a herdr workspace such as
   * `~vma`), when the helper could ask the terminal. Untrusted plain text on one line.
   */
  terminal: z.string().max(MAX_TERMINAL_LABEL_CHARS).nullable().default(null),
});

/**
 * The name a session goes by in the picker: its own title, else its terminal's label,
 * else its folder's name, and its raw `claude agents` name only as a last resort.
 */
export function sessionDisplayName(
  session: Pick<PublicSession, "name" | "title" | "terminal" | "cwd">,
): string {
  const folder =
    session.cwd
      .split(/[\\/]/)
      .filter((part) => part !== "")
      .at(-1) ?? "";
  return session.title ?? session.terminal ?? (folder === "" ? session.name : folder);
}

export const sessionsResponseSchema = z.object({ sessions: z.array(publicSessionSchema) });

export const previewResponseSchema = z.object({
  pinId: pinIdSchema,
  digest: digestSchema,
  message: z.string(),
});

/**
 * A delivered pin's status as the helper reports it: Sent, Approve in terminal, Seen by
 * Claude, Fixed (Claude replied with the pin's fixed line, see fixed.ts) or Blocked (never picked up, or
 * the session reported it lacks GitHub access).
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

/** Why a pin is Blocked: never picked up, or no GitHub access with the session's reason. */
export const pinBlockSchema = z.object({
  kind: z.enum(["not-picked-up", "github-access"]),
  /** The session's one-line reason; untrusted plain text. */
  reason: z.string().max(MAX_BLOCKED_REASON_CHARS).nullable(),
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
  /** The pull request link from Claude's fixed line, once the pin is Fixed. */
  pullRequestUrl: pullRequestUrlSchema.nullable().default(null),
  /** Why the pin is Blocked, while it is. */
  blocked: pinBlockSchema.nullable().default(null),
  /** Whether the helper is still following the transcript for this pin. */
  following: z.boolean().default(false),
  /** Goes up with every change, so a client can tell a stale read from a newer event. */
  revision: z.number().int().nonnegative().default(0),
});

export const deliveredResponseSchema = z.object({ pin: pinRecordSchema });

export const errorResponseSchema = z.object({ error: z.string() });

export type PairRequest = z.infer<typeof pairRequestSchema>;
export type PinsRequest = z.infer<typeof pinsRequestSchema>;
export type FollowUpRequest = z.infer<typeof followUpRequestSchema>;
export type PinBlock = z.infer<typeof pinBlockSchema>;
export type PairResponse = z.infer<typeof pairResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type PublicSession = z.infer<typeof publicSessionSchema>;
export type SessionAccount = z.infer<typeof sessionAccountSchema>;
export type PreviewResponse = z.infer<typeof previewResponseSchema>;
export type PinStatus = (typeof PIN_STATUSES)[number];
export type PinRecord = z.infer<typeof pinRecordSchema>;
export type ThreadMessage = z.infer<typeof threadMessageSchema>;
