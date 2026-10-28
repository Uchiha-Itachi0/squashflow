/**
 * Messages from the side panel to the service worker. Neither the side panel nor the pin
 * mode script calls the helper or sees the pairing token: they ask the service worker,
 * which validates every request before acting on it.
 */

import {
  digestSchema,
  FOLLOW_UP_ACTIONS,
  MAX_COMMENT_CHARS,
  MAX_PINS_PER_MESSAGE,
  pageUrlSchema,
  pinIdSchema,
  pinSchema,
  type PinRecord,
  type PreviewResponse,
  type PublicSession,
} from "@squashflow/shared";
// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";
import type { PinStatuses } from "../status/pin-status";
import { portSchema } from "./connection";
import type { HelperFailure, HelperResult } from "./errors";
import { repoNameSchema } from "./sites";

const outgoingSchema = z.strictObject({
  session: z.number().int().positive(),
  pageUrl: pageUrlSchema,
  pins: z.array(pinSchema).min(1).max(MAX_PINS_PER_MESSAGE),
});

export const workerRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("status") }),
  z.strictObject({
    type: z.literal("pair"),
    code: z.string().trim().min(1).max(32),
    port: portSchema,
  }),
  z.strictObject({ type: z.literal("forget") }),
  /** The page, when one is open, picks the repository remembered for its site. */
  z.strictObject({ type: z.literal("sessions"), pageUrl: pageUrlSchema.nullable() }),
  z.strictObject({
    type: z.literal("remember-site"),
    pageUrl: pageUrlSchema,
    repo: repoNameSchema.nullable(),
  }),
  z.strictObject({ type: z.literal("preview"), outgoing: outgoingSchema }),
  z.strictObject({
    type: z.literal("send"),
    outgoing: outgoingSchema,
    pinId: pinIdSchema,
    digest: digestSchema,
    /** The extension's own ids of the pins in the message, in order. */
    localPinIds: z.array(pinIdSchema).min(1).max(MAX_PINS_PER_MESSAGE),
    /**
     * Set when the message is the user's follow-up on one pin already sent: what they
     * typed, for the pin's thread.
     */
    followUp: z.string().trim().min(1).max(MAX_COMMENT_CHARS).optional(),
  }),
  /**
   * A follow-up to a sent pin blocked on GitHub access, by the extension's own pin id:
   * preview it, then send it with the preview's digest. The worker finds the message.
   */
  z.strictObject({
    type: z.literal("follow-up-preview"),
    pinId: pinIdSchema,
    action: z.enum(FOLLOW_UP_ACTIONS),
  }),
  z.strictObject({
    type: z.literal("follow-up-send"),
    pinId: pinIdSchema,
    action: z.enum(FOLLOW_UP_ACTIONS),
    digest: digestSchema,
  }),
  /** Re-read the pins in flight from the helper and keep following them. */
  z.strictObject({ type: z.literal("track") }),
  z.strictObject({
    type: z.literal("mark"),
    pinId: pinIdSchema,
    mark: z.enum(["resolve", "reopen", "forget"]),
  }),
]);

export type WorkerRequest = z.infer<typeof workerRequestSchema>;

export type ConnectionStatus =
  | { state: "paired"; port: number; version: string }
  | { state: "unpaired"; port: number; message?: string }
  | { state: "unreachable"; port: number; message: string };

export interface SessionsView {
  sessions: PublicSession[];
  /** The repository remembered for the page's site, if any. */
  repo: string | null;
}

/** What each request answers with. */
export interface WorkerReplies {
  status: ConnectionStatus;
  pair: ConnectionStatus;
  forget: ConnectionStatus;
  sessions: SessionsView;
  "remember-site": null;
  preview: PreviewResponse;
  send: PinRecord;
  "follow-up-preview": PreviewResponse;
  "follow-up-send": PinRecord;
  track: PinStatuses;
  mark: PinStatuses;
}

export type WorkerReply<K extends WorkerRequest["type"]> = HelperResult<WorkerReplies[K]>;

const WORKER_FAILED: HelperFailure = {
  kind: "rejected",
  message: "Squashflow's background worker did not answer. Reload the page and try again.",
};

/** Ask the service worker, from the side panel. */
export async function askWorker<R extends WorkerRequest>(
  request: R,
): Promise<WorkerReply<R["type"]>> {
  try {
    const reply: unknown = await chrome.runtime.sendMessage(request);
    return reply === undefined
      ? { ok: false, failure: WORKER_FAILED }
      : (reply as WorkerReply<R["type"]>);
  } catch {
    return { ok: false, failure: WORKER_FAILED };
  }
}

export type AskWorker = typeof askWorker;
