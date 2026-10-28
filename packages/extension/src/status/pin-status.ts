/**
 * Each sent pin's status and thread, as the extension keeps them. The helper reports
 * one record per delivered message; a batch is one message, so every pin in it shares
 * that record's status and thread. Resolved is the user's own mark on top: it hides
 * the helper's status until the pin is reopened. These functions are pure; the store
 * persists their results.
 */

import {
  MAX_THREAD_MESSAGES,
  PIN_STATUSES,
  pinIdSchema,
  pullRequestUrlSchema,
  threadMessageSchema,
  type PinRecord,
  type PinStatus,
} from "@squashflow/shared";
// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";
import type { SquishMood } from "../ui/squish";

/** Most pins whose status is kept; the least recently updated go first. */
export const MAX_TRACKED_PINS = 500;

export const pinTrackingSchema = z.strictObject({
  /** The helper's id for the message that carried this pin. */
  messageId: pinIdSchema,
  sessionName: z.string().max(200),
  status: z.enum(PIN_STATUSES),
  statusLabel: z.string().max(200),
  pullRequestUrl: pullRequestUrlSchema.nullable(),
  thread: z.array(threadMessageSchema).max(MAX_THREAD_MESSAGES),
  resolved: z.boolean(),
  /** Whether the helper is still following the message (no reply yet, not Blocked). */
  inFlight: z.boolean(),
  /** The helper record's revision; an older record never replaces a newer one. */
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type PinTracking = z.infer<typeof pinTrackingSchema>;

/** Statuses by the extension's own pin id. */
export type PinStatuses = Readonly<Record<string, PinTracking>>;

export type ShownStatus = PinStatus | "resolved";

export const STATUS_LABELS: Record<ShownStatus, string> = {
  sent: "Sent",
  "approve-in-terminal": "Approve in terminal",
  seen: "Seen by Claude",
  fixed: "Fixed",
  blocked: "Blocked",
  resolved: "Resolved",
};

export function shownStatus(tracking: PinTracking): ShownStatus {
  return tracking.resolved ? "resolved" : tracking.status;
}

export function shownLabel(tracking: PinTracking): string {
  return tracking.resolved ? STATUS_LABELS.resolved : tracking.statusLabel;
}

/** Start tracking the pins just delivered in one message. */
export function trackSent(
  statuses: PinStatuses,
  localPinIds: readonly string[],
  record: PinRecord,
  now: number,
): PinStatuses {
  const next: Record<string, PinTracking> = { ...statuses };
  for (const id of localPinIds) next[id] = fromRecord(record, false, now);
  return prune(next);
}

/** Apply a record from the helper to every pin delivered in that message. */
export function applyRecord(statuses: PinStatuses, record: PinRecord, now: number): PinStatuses {
  let changed = false;
  const next: Record<string, PinTracking> = {};
  for (const [id, tracking] of Object.entries(statuses)) {
    if (tracking.messageId === record.id && record.revision >= tracking.revision) {
      next[id] = fromRecord(record, tracking.resolved, now);
      changed = true;
    } else {
      next[id] = tracking;
    }
  }
  return changed ? next : statuses;
}

/** The helper no longer knows the message (it restarted): stop following, keep what we have. */
export function stopFollowing(statuses: PinStatuses, messageId: string): PinStatuses {
  return mapMessage(statuses, messageId, (tracking) => ({ ...tracking, inFlight: false }));
}

export function setResolved(
  statuses: PinStatuses,
  pinId: string,
  resolved: boolean,
  now: number,
): PinStatuses {
  const tracking = statuses[pinId];
  if (tracking === undefined || tracking.resolved === resolved) return statuses;
  return { ...statuses, [pinId]: { ...tracking, resolved, updatedAt: now } };
}

export function forgetPin(statuses: PinStatuses, pinId: string): PinStatuses {
  if (statuses[pinId] === undefined) return statuses;
  return Object.fromEntries(Object.entries(statuses).filter(([id]) => id !== pinId));
}

/** Message ids the helper is still following. */
export function inFlightMessages(statuses: PinStatuses): string[] {
  const ids = Object.values(statuses)
    .filter((tracking) => tracking.inFlight)
    .map((tracking) => tracking.messageId);
  return [...new Set(ids)];
}

const MOOD_ORDER: readonly [SquishMood, (status: ShownStatus) => boolean][] = [
  ["blocked", (status) => status === "blocked" || status === "approve-in-terminal"],
  ["working", (status) => status === "seen"],
  ["waiting", (status) => status === "sent"],
  ["squashed", (status) => status === "fixed"],
];

/**
 * Squish's mood for the pins on the page: blocked when one needs the user (Blocked,
 * Approve in terminal), working while Claude has one, waiting while one is only Sent,
 * squashed when what is left is Fixed. Resolved pins no longer count.
 */
export function moodFor(statuses: readonly ShownStatus[]): SquishMood | null {
  for (const [mood, matches] of MOOD_ORDER) {
    if (statuses.some(matches)) return mood;
  }
  return null;
}

export function moodForStatus(status: ShownStatus): SquishMood {
  return moodFor([status]) ?? "squashed";
}

function fromRecord(record: PinRecord, resolved: boolean, now: number): PinTracking {
  return {
    messageId: record.id,
    sessionName: record.sessionName,
    status: record.status,
    statusLabel: record.statusLabel,
    pullRequestUrl: record.pullRequestUrl,
    thread: record.thread,
    resolved,
    inFlight: record.following,
    revision: record.revision,
    updatedAt: now,
  };
}

function mapMessage(
  statuses: PinStatuses,
  messageId: string,
  change: (tracking: PinTracking) => PinTracking,
): PinStatuses {
  const entries = Object.entries(statuses);
  if (!entries.some(([, tracking]) => tracking.messageId === messageId)) return statuses;
  return Object.fromEntries(
    entries.map(([id, tracking]) => [
      id,
      tracking.messageId === messageId ? change(tracking) : tracking,
    ]),
  );
}

function prune(statuses: Record<string, PinTracking>): PinStatuses {
  const entries = Object.entries(statuses);
  if (entries.length <= MAX_TRACKED_PINS) return statuses;
  const kept = entries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, MAX_TRACKED_PINS);
  return Object.fromEntries(kept);
}
