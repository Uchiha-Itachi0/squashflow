import { blockedLine, type PinRecord, type ThreadMessage } from "@squashflow/shared";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/helper/client";
import { ConnectionStore, type SecretArea } from "../src/helper/connection";
import type { AskWorker, WorkerRequest } from "../src/helper/messages";
import { HelperService } from "../src/helper/service";
import { SiteRepoStore } from "../src/helper/sites";
import { StatusTracker } from "../src/helper/tracker";
import { buildOwnerMessage, changeSummary, extractPatch } from "../src/github/blocked";
import { GitHubActions } from "../src/panel/github-actions";
import { SendFlow } from "../src/panel/send-flow";
import { trackSent, type PinTracking } from "../src/status/pin-status";
import { PinStatusStore } from "../src/status/store";
import type { StorageAreaLike, StoredPin } from "../src/store/pins";

const MESSAGE = "sf-0123456789ab";
const LOCAL = "sf-aaaaaaaaaaaa";
const PAGE = "https://shop.example.com/cart";
const DIGEST = "d".repeat(64);
const TOKEN = "tok_0123456789abcdefghij";

const PATCH = [
  "diff --git a/src/buy.css b/src/buy.css",
  "--- a/src/buy.css",
  "+++ b/src/buy.css",
  "@@ -1 +1 @@",
  "-.buy { color: blue; }",
  "+.buy { color: violet; }",
  "",
].join("\n");

const message = (text: string, truncated = false): ThreadMessage => ({
  id: `${MESSAGE}-1`,
  from: "claude",
  text,
  truncated,
  at: "2026-10-28T00:00:00.000Z",
});

const blockedReply = [
  "Made the Buy button violet and committed it on squashflow/violet-buy.",
  "The push was refused.",
  blockedLine(MESSAGE, "no push permission to acme/web"),
].join("\n");

function blockedRecord(thread: ThreadMessage[] = [message(blockedReply)]): PinRecord {
  return {
    id: MESSAGE,
    number: 1,
    sessionPid: 42,
    sessionName: "web",
    status: "blocked",
    statusLabel: "Blocked: GitHub access",
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    thread,
    pullRequestUrl: null,
    blocked: { kind: "github-access", reason: "no push permission to acme/web" },
    following: false,
    revision: 3,
  };
}

const tracking = (record = blockedRecord()): PinTracking => {
  const tracked = trackSent({}, [LOCAL], record, 1)[LOCAL];
  if (tracked === undefined) throw new Error("not tracked");
  return tracked;
};

describe("extractPatch", () => {
  it("takes the last diff block that reads as a unified diff", () => {
    const text = ["Here it is:", "```diff", PATCH.trimEnd(), "```", "Done."].join("\n");
    expect(extractPatch(message(text))).toBe(PATCH);
    expect(extractPatch(message(text.replace("```diff", "~~~patch").replace(/```$/m, "~~~")))).toBe(
      PATCH,
    );
  });

  it("finds nothing in a cut reply, an untagged block, or a block that is not a diff", () => {
    const fenced = ["```diff", PATCH.trimEnd(), "```"].join("\n");
    expect(extractPatch(message(fenced, true))).toBeNull();
    expect(extractPatch(message(fenced.replace("```diff", "```")))).toBeNull();
    expect(extractPatch(message("```diff\nrm -rf /\n```"))).toBeNull();
    expect(extractPatch(message(PATCH))).toBeNull();
    expect(extractPatch(message("```diff\n" + PATCH))).toBeNull();
  });
});

describe("owner message", () => {
  it("summarises the blocked reply without the blocked line or code", () => {
    const thread = [
      message(`${blockedReply}\n\`\`\`diff\n${PATCH}\`\`\``),
      message("```diff\n" + PATCH + "```"),
    ];
    expect(changeSummary(thread)).toBe(
      "Made the Buy button violet and committed it on squashflow/violet-buy.\nThe push was refused.",
    );
    expect(changeSummary([])).toBe("");
  });

  it("builds a ready-made message from the pin, its comment and the summary", () => {
    const text = buildOwnerMessage({
      pageUrl: PAGE,
      comment: "Make the Buy button violet\nlike the logo",
      summary: "Changed .buy to violet.",
      hasPatch: true,
    });
    expect(text).toBe(
      [
        `Hi! While reviewing ${PAGE} I'd like this changed:`,
        "",
        "> Make the Buy button violet",
        "> like the logo",
        "",
        "The change I prepared:",
        "",
        "> Changed .buy to violet.",
        "",
        "I don't have access to push a branch or open a pull request on this repository.",
        "Could you make this change, or give me access? I can send you the patch.",
      ].join("\n"),
    );
    const bare = buildOwnerMessage({ pageUrl: PAGE, comment: "x", summary: "", hasPatch: false });
    expect(bare).not.toContain("The change I prepared");
    expect(bare).not.toContain("patch");
  });
});

type Answer =
  { ok: true; value: unknown } | { ok: false; failure: { kind: "rejected"; message: string } };

function fakeWorker(answers: Partial<Record<WorkerRequest["type"], () => Answer>>) {
  const requests: WorkerRequest[] = [];
  const ask = ((request: WorkerRequest) => {
    requests.push(request);
    const answer = answers[request.type];
    return Promise.resolve(answer ? answer() : { ok: true, value: null });
  }) as AskWorker;
  return { ask, requests };
}

const storedPin: StoredPin = {
  id: LOCAL,
  comment: "Make the Buy button violet",
  context: { selector: "#buy" },
  pageUrl: PAGE,
  createdAt: 1,
  updatedAt: 1,
};

function actions(worker: ReturnType<typeof fakeWorker>) {
  const copied: string[] = [];
  const reports: string[] = [];
  const send = new SendFlow({
    ask: worker.ask,
    pageUrl: () => PAGE,
    onChange: () => undefined,
    report: (text) => reports.push(text),
  });
  const github = new GitHubActions({
    send,
    copy: (text) => {
      copied.push(text);
      return Promise.resolve();
    },
    report: (text) => reports.push(text),
    onChange: () => undefined,
  });
  return { send, github, copied, reports };
}

describe("GitHubActions", () => {
  it("offers the options only while the pin is Blocked: GitHub access", () => {
    const { github } = actions(fakeWorker({}));
    expect(github.view(LOCAL, tracking())).toEqual({
      reason: "no push permission to acme/web",
      loginOpen: false,
    });
    const notPickedUp = {
      ...tracking(),
      blocked: { kind: "not-picked-up" as const, reason: null },
    };
    expect(github.view(LOCAL, notPickedUp)).toBeNull();
    expect(github.view(LOCAL, { ...tracking(), status: "sent", blocked: null })).toBeNull();
  });

  it("shows the login instruction, then previews a retry and sends it only on confirm", async () => {
    const preview = { pinId: MESSAGE, digest: DIGEST, message: "follow-up text" };
    const worker = fakeWorker({
      "follow-up-preview": () => ({ ok: true, value: preview }),
      "follow-up-send": () => ({ ok: true, value: { ...blockedRecord(), status: "sent" } }),
    });
    const { github, send, reports } = actions(worker);
    await github.choose("login", storedPin, 1, tracking());
    expect(github.view(LOCAL, tracking())?.loginOpen).toBe(true);
    expect(worker.requests).toEqual([]);

    await github.choose("retry", storedPin, 1, tracking());
    expect(github.view(LOCAL, tracking())?.loginOpen).toBe(false);
    expect(worker.requests).toEqual([{ type: "follow-up-preview", pinId: LOCAL, action: "retry" }]);
    expect(send.state.preview).toEqual({
      kind: "follow-up",
      localPinId: LOCAL,
      action: "retry",
      sessionName: "web",
      ...preview,
    });

    await send.confirm();
    expect(worker.requests[1]).toEqual({
      type: "follow-up-send",
      pinId: LOCAL,
      action: "retry",
      digest: DIGEST,
    });
    expect(send.state.preview).toBeNull();
    expect(reports).toContain('Sent "Retry after logging in" to web.');
  });

  it("previews a fork follow-up, and sends nothing when cancelled", async () => {
    const worker = fakeWorker({
      "follow-up-preview": () => ({
        ok: true,
        value: { pinId: MESSAGE, digest: DIGEST, message: "fork" },
      }),
    });
    const { github, send } = actions(worker);
    await github.choose("fork", storedPin, 1, tracking());
    expect(send.state.preview?.kind).toBe("follow-up");
    send.cancelPreview();
    expect(worker.requests.map((request) => request.type)).toEqual(["follow-up-preview"]);
  });

  it("copies the patch from a reply, or asks the session for it first", async () => {
    const worker = fakeWorker({
      "follow-up-preview": () => ({
        ok: true,
        value: { pinId: MESSAGE, digest: DIGEST, message: "patch" },
      }),
    });
    const { github, send, copied } = actions(worker);
    await github.choose("patch", storedPin, 1, tracking());
    expect(copied).toEqual([]);
    expect(send.state.preview).toMatchObject({ kind: "follow-up", action: "patch" });

    const withPatch = tracking(
      blockedRecord([message(blockedReply), message(`Here:\n\`\`\`diff\n${PATCH}\`\`\``)]),
    );
    await github.choose("patch", storedPin, 1, withPatch);
    expect(copied).toEqual([PATCH]);
    expect(worker.requests).toHaveLength(1);
  });

  it("copies a ready-made message for the owner", async () => {
    const { github, copied, reports } = actions(fakeWorker({}));
    await github.choose("owner", storedPin, 2, tracking());
    expect(copied[0]).toContain("> Make the Buy button violet");
    expect(copied[0]).toContain("> Made the Buy button violet and committed it");
    expect(copied[0]).not.toContain("SQUASHFLOW-BLOCKED");
    expect(reports).toContain("Copied a message for the repository owner about pin 2.");
  });
});

function memoryArea(): StorageAreaLike {
  const data: Record<string, unknown> = {};
  return {
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

function memorySecrets(): SecretArea {
  const data = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => Promise.resolve(void data.set(key, value)),
    delete: (key) => Promise.resolve(void data.delete(key)),
  };
}

describe("HelperService follow-ups", () => {
  it("sends follow-ups for the pin's message with the stored token, and tracks the result", async () => {
    const calls: { path: string; auth: string | null; body: unknown }[] = [];
    const fetch: FetchLike = (url, init) => {
      const path = new URL(url).pathname;
      const body: unknown = JSON.parse(init.body as string);
      calls.push({ path, auth: new Headers(init.headers).get("authorization"), body });
      const preview = (body as { preview?: boolean }).preview === true;
      const answer = preview
        ? { pinId: MESSAGE, digest: DIGEST, message: "follow-up" }
        : {
            pin: {
              ...blockedRecord(),
              status: "sent",
              blocked: null,
              following: true,
              revision: 4,
            },
          };
      return Promise.resolve(new Response(JSON.stringify(answer), { status: preview ? 200 : 202 }));
    };
    const connections = new ConnectionStore(memorySecrets());
    await connections.save({ port: 5123, token: TOKEN });
    const store = new PinStatusStore(memoryArea());
    await store.update((statuses) => trackSent(statuses, [LOCAL], blockedRecord(), 1));
    const tracker = new StatusTracker({ fetch, connections, store, reconnectMs: 60_000 });
    const service = new HelperService({
      fetch,
      connections,
      sites: new SiteRepoStore(memoryArea()),
      tracker,
    });

    expect(
      await service.handle({ type: "follow-up-preview", pinId: "sf-bbbbbbbbbbbb", action: "fork" }),
    ).toMatchObject({ ok: false });
    const preview = await service.handle({
      type: "follow-up-preview",
      pinId: LOCAL,
      action: "fork",
    });
    expect(preview).toEqual({
      ok: true,
      value: { pinId: MESSAGE, digest: DIGEST, message: "follow-up" },
    });
    const sent = await service.handle({
      type: "follow-up-send",
      pinId: LOCAL,
      action: "fork",
      digest: DIGEST,
    });
    tracker.close();
    expect(sent.ok).toBe(true);
    expect(calls.slice(0, 2)).toEqual([
      {
        path: `/pins/${MESSAGE}/follow-up`,
        auth: `Bearer ${TOKEN}`,
        body: { action: "fork", preview: true },
      },
      {
        path: `/pins/${MESSAGE}/follow-up`,
        auth: `Bearer ${TOKEN}`,
        body: { action: "fork", digest: DIGEST },
      },
    ]);
    expect((await store.list())[LOCAL]).toMatchObject({
      status: "sent",
      blocked: null,
      inFlight: true,
    });
    // The reply to the pin mode script carries the record, never the token.
    expect(JSON.stringify([preview, sent])).not.toContain(TOKEN);
  });

  it("refuses malformed follow-ups without calling the helper", async () => {
    const calls: string[] = [];
    const fetch: FetchLike = (url) => {
      calls.push(url);
      return Promise.reject(new TypeError("unexpected"));
    };
    const connections = new ConnectionStore(memorySecrets());
    const service = new HelperService({
      fetch,
      connections,
      sites: new SiteRepoStore(memoryArea()),
      tracker: new StatusTracker({ fetch, connections, store: new PinStatusStore(memoryArea()) }),
    });
    for (const request of [
      { type: "follow-up-preview", pinId: LOCAL, action: "push" },
      { type: "follow-up-send", pinId: LOCAL, action: "retry" },
      { type: "follow-up-send", pinId: LOCAL, action: "retry", digest: DIGEST, message: "x" },
      { type: "follow-up-preview", pinId: "../x", action: "retry" },
    ]) {
      expect((await service.handle(request)).ok).toBe(false);
    }
    expect(calls).toEqual([]);
  });
});
