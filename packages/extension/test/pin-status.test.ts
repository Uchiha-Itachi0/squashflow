import type { PinRecord } from "@squashflow/shared";
import { describe, expect, it } from "vitest";
import { PinEventParser } from "../src/helper/events";
import {
  applyRecord,
  forgetPin,
  inFlightMessages,
  MAX_TRACKED_PINS,
  moodFor,
  setResolved,
  shownLabel,
  shownStatus,
  stopFollowing,
  trackSent,
  type PinStatuses,
  type PinTracking,
} from "../src/status/pin-status";
import { PIN_STATUS_KEY, PinStatusStore } from "../src/status/store";
import type { StorageAreaLike } from "../src/store/pins";

const MESSAGE = "sf-0123456789ab";
const A = "sf-aaaaaaaaaaaa";
const B = "sf-bbbbbbbbbbbb";
const C = "sf-cccccccccccc";

function record(patch: Partial<PinRecord> = {}): PinRecord {
  return {
    id: MESSAGE,
    number: 1,
    sessionPid: 42,
    sessionName: "web",
    status: "sent",
    statusLabel: "Sent",
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    thread: [],
    pullRequestUrl: null,
    following: true,
    revision: 0,
    ...patch,
  };
}

const reply = {
  id: `${MESSAGE}-1`,
  from: "claude" as const,
  text: "Fixed in https://github.com/acme/web/pull/7",
  truncated: false,
  at: "2026-10-28T00:05:00.000Z",
};
const fixed = record({
  status: "fixed",
  statusLabel: "Fixed",
  thread: [reply],
  pullRequestUrl: "https://github.com/acme/web/pull/7",
  following: false,
  revision: 2,
});

function at(statuses: PinStatuses, id: string): PinTracking {
  const tracking = statuses[id];
  if (tracking === undefined) throw new Error(`No status for ${id}`);
  return tracking;
}

describe("pin status reducer", () => {
  it("tracks every pin of a batch under the message id", () => {
    const statuses = trackSent({}, [A, B], record(), 10);
    expect(Object.keys(statuses)).toEqual([A, B]);
    expect(statuses[A]).toMatchObject({ messageId: MESSAGE, status: "sent", inFlight: true });
    expect(inFlightMessages(statuses)).toEqual([MESSAGE]);
  });

  it("applies a reply with a pull request link to every pin in the batch", () => {
    const sent = trackSent({}, [A, B], record(), 10);
    const other = trackSent(sent, [C], record({ id: "sf-ffffffffffff" }), 10);
    const next = applyRecord(other, fixed, 20);
    for (const id of [A, B]) {
      expect(next[id]).toMatchObject({
        status: "fixed",
        thread: [reply],
        pullRequestUrl: "https://github.com/acme/web/pull/7",
        inFlight: false,
        updatedAt: 20,
      });
    }
    expect(next[C]?.status).toBe("sent");
    expect(inFlightMessages(next)).toEqual(["sf-ffffffffffff"]);
  });

  it("never lets an older record replace a newer one", () => {
    const sent = trackSent({}, [A], record(), 10);
    const latest = applyRecord(sent, fixed, 20);
    const stale = record({ status: "seen", statusLabel: "Seen by Claude", revision: 1 });
    expect(applyRecord(latest, stale, 30)).toBe(latest);
  });

  it("leaves the statuses untouched for a message it does not track", () => {
    const sent = trackSent({}, [A], record(), 10);
    expect(applyRecord(sent, record({ id: "sf-ffffffffffff" }), 20)).toBe(sent);
  });

  it("lets the user resolve and reopen a pin, keeping Resolved across updates", () => {
    const sent = trackSent({}, [A, B], record(), 10);
    const resolved = setResolved(sent, A, true, 11);
    expect(shownStatus(at(resolved, A))).toBe("resolved");
    expect(shownLabel(at(resolved, A))).toBe("Resolved");
    expect(shownStatus(at(resolved, B))).toBe("sent");

    const updated = applyRecord(resolved, fixed, 12);
    expect(shownStatus(at(updated, A))).toBe("resolved");
    expect(updated[A]?.thread).toEqual([reply]);

    const reopened = setResolved(updated, A, false, 13);
    expect(shownStatus(at(reopened, A))).toBe("fixed");
    expect(setResolved(reopened, A, false, 14)).toBe(reopened);
    expect(setResolved(reopened, "sf-999999999999", true, 14)).toBe(reopened);
  });

  it("stops following a message the helper forgot, and forgets deleted pins", () => {
    const sent = trackSent({}, [A, B], record(), 10);
    expect(inFlightMessages(stopFollowing(sent, MESSAGE))).toEqual([]);
    expect(Object.keys(forgetPin(sent, A))).toEqual([B]);
  });

  it("keeps at most the most recently updated pins", () => {
    let statuses: PinStatuses = {};
    for (let index = 0; index <= MAX_TRACKED_PINS; index += 1) {
      const id = `sf-${index.toString(16).padStart(12, "0")}`;
      statuses = trackSent(statuses, [id], record(), index);
    }
    expect(Object.keys(statuses)).toHaveLength(MAX_TRACKED_PINS);
    expect(statuses["sf-000000000000"]).toBeUndefined();
  });

  it("picks Squish's mood from the pins on the page", () => {
    expect(moodFor([])).toBeNull();
    expect(moodFor(["resolved"])).toBeNull();
    expect(moodFor(["fixed", "resolved"])).toBe("squashed");
    expect(moodFor(["fixed", "sent"])).toBe("waiting");
    expect(moodFor(["sent", "seen"])).toBe("working");
    expect(moodFor(["seen", "approve-in-terminal"])).toBe("blocked");
    expect(moodFor(["fixed", "blocked"])).toBe("blocked");
  });
});

function memoryArea(): StorageAreaLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: (key) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
    set: (items) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: (key) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete data[key];
      return Promise.resolve();
    },
  };
}

describe("PinStatusStore", () => {
  it("stores statuses and runs changes one after another", async () => {
    const area = memoryArea();
    const store = new PinStatusStore(area);
    await Promise.all([
      store.update((statuses) => trackSent(statuses, [A], record(), 1)),
      store.update((statuses) => trackSent(statuses, [B], record({ id: "sf-ffffffffffff" }), 2)),
    ]);
    expect(Object.keys(await store.list()).sort()).toEqual([A, B]);
    await store.update((statuses) => forgetPin(forgetPin(statuses, A), B));
    expect(area.data[PIN_STATUS_KEY]).toBeUndefined();
  });

  it("drops malformed entries, including links that are not GitHub pull requests", async () => {
    const area = memoryArea();
    const good = trackSent({}, [A], fixed, 1)[A];
    area.data[PIN_STATUS_KEY] = {
      [A]: good,
      [B]: { ...good, pullRequestUrl: "javascript:alert(1)" },
      "not-an-id": good,
      [C]: "garbage",
    };
    expect(Object.keys(await new PinStatusStore(area).list())).toEqual([A]);
  });

  it("keeps working after a failed change", async () => {
    const store = new PinStatusStore(memoryArea());
    await expect(
      store.update(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await store.update((statuses) => trackSent(statuses, [A], record(), 1));
    expect(Object.keys(await store.list())).toEqual([A]);
  });
});

describe("PinEventParser", () => {
  it("reads pin events split across chunks and skips comments, other events and bad data", () => {
    const seen: PinRecord[] = [];
    const parser = new PinEventParser((value) => seen.push(value));
    const event = `event: pin\ndata: ${JSON.stringify(fixed)}\n\n`;
    parser.push(": squashflow events\n\n");
    parser.push(event.slice(0, 30));
    parser.push(event.slice(30));
    parser.push('event: other\ndata: {"id":"x"}\n\n');
    parser.push("event: pin\ndata: {not json\n\n");
    parser.push(
      `event: pin\ndata: ${JSON.stringify({ ...fixed, pullRequestUrl: "https://evil.test/pull/1" })}\r\n\r\n`,
    );
    expect(seen).toEqual([fixed]);
  });
});
