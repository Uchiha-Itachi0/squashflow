/**
 * One pin as a conversation, oldest first: the user's comment, then what happened as
 * short system lines (Sent to <session>, Seen by Claude, Approve in terminal, Fixed with
 * its pull request, Blocked, Resolved), Claude's replies, and the user's follow-ups; and
 * which inbox group a pin sits in. Pure: the views render what this returns.
 */

import { BLOCKED_MARKER, FIXED_MARKER, type ThreadMessage } from "@squashflow/shared";
import {
  shownStatus,
  type PinEvent,
  type PinTracking,
  type ShownStatus,
} from "../status/pin-status";
import type { StoredPin } from "../store/pins";

export type EventTone = "neutral" | "accent" | "ok" | "warn" | "danger";

export type ThreadItem =
  | { kind: "comment"; text: string; at: number }
  | { kind: "you"; text: string; at: number }
  | { kind: "reply"; id: string; text: string; truncated: boolean; at: number }
  | { kind: "event"; label: string; tone: EventTone; at: number; pullRequestUrl: string | null };

/** A draft is a pin not sent yet; everything else follows the helper and the user. */
export type PinState = ShownStatus | "draft";

const TONES: Record<PinEvent["kind"], EventTone> = {
  sent: "accent",
  "approve-in-terminal": "warn",
  seen: "accent",
  fixed: "ok",
  blocked: "danger",
  resolved: "ok",
  reopened: "neutral",
  "follow-up": "neutral",
};

/** Order of items at the same moment: a reply comes before the status it caused. */
const ORDER: Record<ThreadItem["kind"], number> = { comment: 0, you: 1, reply: 2, event: 3 };

export function pinState(tracking: PinTracking | undefined): PinState {
  return tracking === undefined ? "draft" : shownStatus(tracking);
}

/** The inbox groups pins by who acts next, in this order. */
export type InboxGroup = "needs-you" | "working" | "ready" | "fixed";

export const INBOX_GROUPS: readonly [InboxGroup, string][] = [
  ["needs-you", "Needs you"],
  ["working", "Claude is on it"],
  ["ready", "Ready to send"],
  ["fixed", "Fixed"],
];

export function inboxGroup(state: PinState): InboxGroup {
  switch (state) {
    case "blocked":
    case "approve-in-terminal":
      return "needs-you";
    case "sent":
    case "seen":
      return "working";
    case "draft":
      return "ready";
    case "fixed":
    case "resolved":
      return "fixed";
  }
}

export function buildThread(pin: StoredPin, tracking: PinTracking | undefined): ThreadItem[] {
  const items: ThreadItem[] = [{ kind: "comment", text: pin.comment, at: pin.createdAt }];
  if (tracking === undefined) return items;
  const events = historyOf(tracking);
  const lastFixed = events.map((event) => event.kind).lastIndexOf("fixed");
  events.forEach((event, index) => {
    if (event.kind === "follow-up") {
      if (event.text !== null) items.push({ kind: "you", text: event.text, at: event.at });
      return;
    }
    items.push({
      kind: "event",
      label: event.label,
      tone: TONES[event.kind],
      at: event.at,
      pullRequestUrl: index === lastFixed ? tracking.pullRequestUrl : null,
    });
  });
  for (const message of [...tracking.earlier, ...tracking.thread]) items.push(replyItem(message));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.at !== b.item.at) return a.item.at - b.item.at;
      if (ORDER[a.item.kind] !== ORDER[b.item.kind]) return ORDER[a.item.kind] - ORDER[b.item.kind];
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/** Pins saved before history was kept show their current status as one line. */
function historyOf(tracking: PinTracking): readonly PinEvent[] {
  if (tracking.events.length > 0) return tracking.events;
  return [
    { kind: tracking.status, label: tracking.statusLabel, text: null, at: tracking.updatedAt },
  ];
}

/**
 * Squashflow's own status lines (fixed, blocked) are for the helper; the thread shows
 * them as system lines instead, so the bubble leaves them out.
 */
export function replyForDisplay(text: string): string {
  const marker = new RegExp(`^(?:${FIXED_MARKER}|${BLOCKED_MARKER}) \\[sf-[0-9a-f]{12}\\]`);
  return text
    .split("\n")
    .filter((line) => !marker.test(line))
    .join("\n")
    .trim();
}

function replyItem(message: ThreadMessage): ThreadItem {
  const at = Date.parse(message.at);
  return {
    kind: "reply",
    id: message.id,
    text: replyForDisplay(message.text),
    truncated: message.truncated,
    at: Number.isNaN(at) ? 0 : at,
  };
}
