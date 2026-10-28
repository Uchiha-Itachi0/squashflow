/**
 * Each sent pin's status and thread, as the extension keeps them. The helper reports
 * one record per delivered message; a batch is one message, so every pin in it shares
 * that record's status and thread. Resolved is the user's own mark on top: it hides
 * the helper's status until the pin is reopened. A follow-up is a new message for the
 * same pin: the pin then follows the new record, and keeps the earlier replies and its
 * history of events (sent, each status change, follow-ups, resolve and reopen) so the
 * side panel can show the whole conversation. These functions are pure; the store
 * persists their results.
 */

import {
  MAX_COMMENT_CHARS,
  MAX_THREAD_MESSAGES,
  PIN_STATUSES,
  pinBlockSchema,
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
/** Most events kept on one pin's history; the oldest go first. */
export const MAX_PIN_EVENTS = 60;

export const PIN_EVENT_KINDS = [...PIN_STATUSES, "resolved", "reopened", "follow-up"] as const;

/** One line of a pin's history: a status change, the user's mark, or a follow-up. */
export const pinEventSchema = z.strictObject({
  kind: z.enum(PIN_EVENT_KINDS),
  /** What the thread shows: the status label, or "Sent to <session>". */
  label: z.string().max(200),
  /** A follow-up's text, as the user typed it; null for every other kind. */
  text: z.string().max(MAX_COMMENT_CHARS).nullable(),
  /** Milliseconds since the epoch. */
  at: z.number().int().nonnegative(),
});

export type PinEvent = z.infer<typeof pinEventSchema>;

export const pinTrackingSchema = z.strictObject({
  /** The helper's id for the message that carried this pin. */
  messageId: pinIdSchema,
  sessionName: z.string().max(200),
  /** The session's pid, so a follow-up goes to the same session. */
  sessionPid: z.number().int().positive().nullable().default(null),
  status: z.enum(PIN_STATUSES),
  statusLabel: z.string().max(200),
  pullRequestUrl: pullRequestUrlSchema.nullable(),
  thread: z.array(threadMessageSchema).max(MAX_THREAD_MESSAGES),
  /** Claude's replies to the pin's earlier messages, before its latest follow-up. */
  earlier: z.array(threadMessageSchema).max(MAX_THREAD_MESSAGES).default([]),
  events: z.array(pinEventSchema).max(MAX_PIN_EVENTS).default([]),
  /** Why the pin is Blocked, while it is; GitHub access offers the four ways out. */
  blocked: pinBlockSchema.nullable().default(null),
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

/**
 * Start tracking the pins just delivered in one message. With `followUp`, the message
 * was the user's follow-up on a pin already sent: its text joins the pin's history and
 * the replies so far are kept as earlier replies.
 */
export function trackSent(
  statuses: PinStatuses,
  localPinIds: readonly string[],
  record: PinRecord,
  now: number,
  followUp: string | null = null,
): PinStatuses {
  const next: Record<string, PinTracking> = { ...statuses };
  for (const id of localPinIds) {
    const previous = statuses[id];
    const tracking = fromRecord(record, false, now);
    const sent: PinEvent = {
      kind: "sent",
      label: `Sent to ${record.sessionName}`,
      text: null,
      at: now,
    };
    const asked: PinEvent[] =
      followUp === null ? [] : [{ kind: "follow-up", label: "You", text: followUp, at: now }];
    next[id] = {
      ...tracking,
      earlier: [...(previous?.earlier ?? []), ...(previous?.thread ?? [])].slice(
        -MAX_THREAD_MESSAGES,
      ),
      events: capEvents([...(previous?.events ?? []), ...asked, sent]),
    };
  }
  return prune(next);
}

/** Apply a record from the helper to every pin delivered in that message. */
export function applyRecord(statuses: PinStatuses, record: PinRecord, now: number): PinStatuses {
  let changed = false;
  const next: Record<string, PinTracking> = {};
  for (const [id, tracking] of Object.entries(statuses)) {
    if (tracking.messageId === record.id && record.revision >= tracking.revision) {
      next[id] = {
        ...fromRecord(record, tracking.resolved, now),
        earlier: tracking.earlier,
        events: withStatusEvent(tracking, record, now),
      };
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
  const mark: PinEvent = {
    kind: resolved ? "resolved" : "reopened",
    label: resolved ? "Resolved" : "Reopened",
    text: null,
    at: now,
  };
  return {
    ...statuses,
    [pinId]: {
      ...tracking,
      resolved,
      events: capEvents([...tracking.events, mark]),
      updatedAt: now,
    },
  };
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

/** The history with a line for the record's status, when it differs from the last one. */
function withStatusEvent(tracking: PinTracking, record: PinRecord, now: number): PinEvent[] {
  if (record.status === tracking.status && record.statusLabel === tracking.statusLabel) {
    return tracking.events;
  }
  const at = Date.parse(record.updatedAt);
  const event: PinEvent = {
    kind: record.status,
    label: record.statusLabel,
    text: null,
    at: Number.isNaN(at) ? now : at,
  };
  return capEvents([...tracking.events, event]);
}

function capEvents(events: readonly PinEvent[]): PinEvent[] {
  return events.slice(-MAX_PIN_EVENTS);
}

function fromRecord(record: PinRecord, resolved: boolean, now: number): PinTracking {
  return {
    messageId: record.id,
    sessionName: record.sessionName,
    sessionPid: record.sessionPid,
    status: record.status,
    statusLabel: record.statusLabel,
    pullRequestUrl: record.pullRequestUrl,
    thread: record.thread,
    earlier: [],
    events: [],
    blocked: record.blocked,
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
