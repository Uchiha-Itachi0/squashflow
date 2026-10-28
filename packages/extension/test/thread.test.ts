import type { PinRecord } from "@squashflow/shared";
import { describe, expect, it } from "vitest";
import { buildThread, moodForPin, pinLine, pinState, replyForDisplay } from "../src/panel/thread";
import { applyRecord, setResolved, trackSent, type PinTracking } from "../src/status/pin-status";
import type { StoredPin } from "../src/store/pins";

const PIN = "sf-aaaaaaaaaaaa";
const MESSAGE = "sf-0123456789ab";
const T0 = Date.parse("2026-10-28T10:00:00.000Z");

const pin: StoredPin = {
  id: PIN,
  comment: "Make the Buy button violet",
  context: { selector: "#buy" },
  pageUrl: "https://shop.example.com/",
  createdAt: T0,
  updatedAt: T0,
};

function record(patch: Partial<PinRecord>): PinRecord {
  return {
    id: MESSAGE,
    number: 1,
    sessionPid: 7,
    sessionName: "web",
    status: "sent",
    statusLabel: "Sent",
    createdAt: "2026-10-28T10:01:00.000Z",
    updatedAt: "2026-10-28T10:01:00.000Z",
    thread: [],
    pullRequestUrl: null,
    blocked: null,
    following: true,
    revision: 0,
    ...patch,
  };
}

const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

function fixedTracking(): PinTracking {
  const sent = trackSent({}, [PIN], record({}), T0 + 60_000);
  const seen = applyRecord(
    sent,
    record({ status: "seen", statusLabel: "Seen by Claude", revision: 1, updatedAt: at(2) }),
    0,
  );
  const reply = {
    id: `${MESSAGE}-1`,
    from: "claude" as const,
    text: `Made it **violet**.\nSQUASHFLOW-FIXED [${MESSAGE}] https://github.com/acme/web/pull/5`,
    truncated: false,
    at: at(5),
  };
  const fixed = applyRecord(
    seen,
    record({
      status: "fixed",
      statusLabel: "Fixed",
      thread: [reply],
      pullRequestUrl: "https://github.com/acme/web/pull/5",
      following: false,
      revision: 2,
      // The reply and the status change arrive together, at the same moment.
      updatedAt: at(5),
    }),
    0,
  );
  const tracking = fixed[PIN];
  if (tracking === undefined) throw new Error("not tracked");
  return tracking;
}

describe("a pin's thread", () => {
  it("is only the comment while the pin is a draft", () => {
    expect(buildThread(pin, undefined)).toEqual([{ kind: "comment", text: pin.comment, at: T0 }]);
    expect(pinState(undefined)).toBe("draft");
    expect(moodForPin(undefined)).toBe("waiting");
  });

  it("reads Sent, Seen, Claude's reply, then Fixed with the pull request", () => {
    const items = buildThread(pin, fixedTracking());
    expect(items.map((item) => (item.kind === "event" ? item.label : item.kind))).toEqual([
      "comment",
      "Sent to web",
      "Seen by Claude",
      "reply",
      "Fixed",
    ]);
    expect(items[3]).toMatchObject({ kind: "reply", text: "Made it **violet**." });
    expect(items[4]).toMatchObject({
      tone: "ok",
      pullRequestUrl: "https://github.com/acme/web/pull/5",
    });
    expect(moodForPin(fixedTracking())).toBe("squashed");
  });

  it("puts the user's follow-up and the next message after the earlier reply", () => {
    const statuses = trackSent(
      { [PIN]: fixedTracking() },
      [PIN],
      record({ id: "sf-ffffffffffff" }),
      T0 + 10 * 60_000,
      "Darker please",
    );
    const resolved = setResolved(statuses, PIN, true, T0 + 11 * 60_000);
    const tracking = resolved[PIN];
    if (tracking === undefined) throw new Error("not tracked");
    const kinds = buildThread(pin, tracking).map((item) =>
      item.kind === "event" ? item.label : item.kind,
    );
    expect(kinds).toEqual([
      "comment",
      "Sent to web",
      "Seen by Claude",
      "reply",
      "Fixed",
      "you",
      "Sent to web",
      "Resolved",
    ]);
    expect(pinState(tracking)).toBe("resolved");
  });

  it("shows a pin tracked before history was kept as its current status", () => {
    const tracking = { ...fixedTracking(), events: [] };
    const items = buildThread(pin, tracking);
    expect(items.filter((item) => item.kind === "event")).toHaveLength(1);
  });

  it("keeps Squashflow's status lines out of the reply bubble", () => {
    expect(
      replyForDisplay("Done.\nSQUASHFLOW-BLOCKED [sf-0123456789ab] github-access: no push\nThanks"),
    ).toBe("Done.\nThanks");
    expect(replyForDisplay("Quoting SQUASHFLOW-FIXED [sf-0123456789ab] inline")).toBe(
      "Quoting SQUASHFLOW-FIXED [sf-0123456789ab] inline",
    );
  });

  it("has Squish say what the pin waits for", () => {
    expect(pinLine("draft", null)).toMatch(/Press Go/);
    expect(pinLine("approve-in-terminal", "web")).toContain("claude@web's terminal");
    expect(pinLine("seen", "web")).toBe("claude@web is on it.");
  });
});
