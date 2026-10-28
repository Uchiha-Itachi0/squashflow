import type { PinRecord } from "@squashflow/shared";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/helper/client";
import { ConnectionStore, type SecretArea } from "../src/helper/connection";
import { StatusTracker } from "../src/helper/tracker";
import { PinStatusStore } from "../src/status/store";
import type { StorageAreaLike } from "../src/store/pins";

const TOKEN = "tok_0123456789abcdefghij";
const MESSAGE = "sf-0123456789ab";
const A = "sf-aaaaaaaaaaaa";
const B = "sf-bbbbbbbbbbbb";

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

const fixed = record({
  status: "fixed",
  statusLabel: "Fixed",
  following: false,
  revision: 2,
  pullRequestUrl: "https://github.com/acme/web/pull/7",
  thread: [
    {
      id: `${MESSAGE}-1`,
      from: "claude",
      text: "Done: https://github.com/acme/web/pull/7",
      truncated: false,
      at: "2026-10-28T00:05:00.000Z",
    },
  ],
});

/** A fake helper: `GET /pins/{id}` answers from `pins`, `/events` is a stream the test writes to. */
function fakeHelper(pins: Map<string, PinRecord | "unknown">) {
  const encoder = new TextEncoder();
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const calls: string[] = [];
  const fetch: FetchLike = (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    if (path === "/events") {
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          streams.push(controller);
        },
      });
      init.signal?.addEventListener("abort", () => {
        try {
          streams.find((stream) => stream === streams.at(-1))?.error(new Error("aborted"));
        } catch {
          // Already closed.
        }
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }
    const pin = pins.get(path.replace("/pins/", ""));
    if (pin === undefined || pin === "unknown") {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Unknown pin" }), { status: 404 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ pin }), { status: 200 }));
  };
  return {
    fetch,
    calls,
    streams,
    emit: (value: PinRecord) => {
      streams.at(-1)?.enqueue(encoder.encode(`event: pin\ndata: ${JSON.stringify(value)}\n\n`));
    },
  };
}

function memoryArea(): StorageAreaLike {
  const data: Record<string, unknown> = {};
  return {
    get: (key) => Promise.resolve(key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: (items) => {
      Object.assign(data, structuredClone(items));
      return Promise.resolve();
    },
    remove: (key) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete data[key];
      return Promise.resolve();
    },
  };
}

function memorySecrets(): SecretArea {
  const data = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => Promise.resolve(void data.set(key, value)),
    delete: (key) => Promise.resolve(void data.delete(key)),
  };
}

async function setup(pins: Map<string, PinRecord | "unknown">) {
  const helper = fakeHelper(pins);
  const connections = new ConnectionStore(memorySecrets());
  await connections.save({ port: 5123, token: TOKEN });
  const area = memoryArea();
  const store = new PinStatusStore(area);
  const tracker = new StatusTracker({
    fetch: helper.fetch,
    connections,
    store,
    reconnectMs: 60_000,
  });
  return { helper, area, store, tracker, connections };
}

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out");
}

describe("StatusTracker", () => {
  it("follows a sent batch over /events until Claude's reply makes it Fixed, then closes", async () => {
    const pins = new Map<string, PinRecord | "unknown">([[MESSAGE, record()]]);
    const { helper, store, tracker } = await setup(pins);
    await tracker.sent([A, B], record());
    await until(() => Promise.resolve(helper.streams.length === 1));

    helper.emit(record({ status: "seen", statusLabel: "Seen by Claude", revision: 1 }));
    await until(async () => (await store.list())[A]?.status === "seen");

    helper.emit(fixed);
    await until(async () => (await store.list())[B]?.status === "fixed");
    const statuses = await store.list();
    expect(statuses[A]?.thread[0]?.text).toBe("Done: https://github.com/acme/web/pull/7");
    expect(statuses[A]?.inFlight).toBe(false);
    tracker.close();
  });

  it("catches up after a worker restart by re-reading /pins/{id}", async () => {
    const pins = new Map<string, PinRecord | "unknown">([[MESSAGE, record()]]);
    const first = await setup(pins);
    await first.tracker.sent([A], record());
    first.tracker.close();

    // A fresh worker over the same storage: the reply arrived while it was stopped.
    pins.set(MESSAGE, fixed);
    const restarted = new StatusTracker({
      fetch: first.helper.fetch,
      connections: first.connections,
      store: new PinStatusStore(first.area),
      reconnectMs: 60_000,
    });
    const statuses = await restarted.sync();
    expect(statuses[A]?.status).toBe("fixed");
    expect(first.helper.calls).toContain(`/pins/${MESSAGE}`);
    // Nothing is in flight any more, so no new stream is opened.
    expect(first.helper.calls.filter((path) => path === "/events")).toHaveLength(1);
  });

  it("stops asking about a message the helper no longer knows", async () => {
    const pins = new Map<string, PinRecord | "unknown">([[MESSAGE, "unknown"]]);
    const { tracker, store } = await setup(pins);
    await tracker.sent([A], record());
    tracker.close();
    const statuses = await tracker.sync();
    expect(statuses[A]).toMatchObject({ status: "sent", inFlight: false });
    expect((await store.list())[A]?.inFlight).toBe(false);
    tracker.close();
  });

  it("marks pins Resolved, reopens and forgets them", async () => {
    const pins = new Map<string, PinRecord | "unknown">([[MESSAGE, fixed]]);
    const { tracker } = await setup(pins);
    await tracker.sent([A], fixed);
    expect((await tracker.mark(A, "resolve"))[A]?.resolved).toBe(true);
    expect((await tracker.mark(A, "reopen"))[A]?.resolved).toBe(false);
    expect((await tracker.mark(A, "forget"))[A]).toBeUndefined();
    tracker.close();
  });
});
