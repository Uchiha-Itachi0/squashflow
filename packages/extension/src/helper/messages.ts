/**
 * Messages between the pin mode script and the service worker. The pin mode script
 * never calls the helper or sees the pairing token: it asks the service worker, which
 * validates every request before acting on it.
 */

import {
  digestSchema,
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
  z.strictObject({ type: z.literal("sessions"), pageUrl: pageUrlSchema }),
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
}

export type WorkerReply<K extends WorkerRequest["type"]> = HelperResult<WorkerReplies[K]>;

const WORKER_FAILED: HelperFailure = {
  kind: "rejected",
  message: "Squashflow's background worker did not answer. Reload the page and try again.",
};

/** Ask the service worker, from the pin mode script. */
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
