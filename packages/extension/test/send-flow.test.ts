import type { PublicSession } from "@squashflow/shared";
import { describe, expect, it } from "vitest";
import type { HelperFailure } from "../src/helper/errors";
import type { AskWorker, WorkerReplies, WorkerRequest } from "../src/helper/messages";
import { followUpComment, SendFlow } from "../src/panel/send-flow";
import type { PinTracking } from "../src/status/pin-status";
import { sessionTimes } from "../src/panel/format";
import type { StoredPin } from "../src/store/pins";

const PAGE = "https://shop.example.com/cart";
const DIGEST = "c".repeat(64);
const detail = { title: null, branch: null, startedAt: null, lastActiveAt: null };
const web: PublicSession = {
  pid: 1,
  name: "web",
  status: "idle",
  cwd: "/w/web",
  repo: "acme/web",
  ...detail,
};
const api: PublicSession = {
  pid: 2,
  name: "api",
  status: "busy",
  cwd: "/w/api",
  repo: "acme/api",
  ...detail,
};

const pin = (id: string, comment: string): StoredPin => ({
  id,
  comment,
  context: { selector: "#buy" },
  pageUrl: PAGE,
  createdAt: 1,
  updatedAt: 1,
});

type Answer = { ok: true; value: unknown } | { ok: false; failure: HelperFailure };

/** A fake service worker: answers per request type, and records every request. */
function fakeWorker(
  answers: Partial<Record<WorkerRequest["type"], (request: WorkerRequest) => Answer>>,
) {
  const requests: WorkerRequest[] = [];
  const ask = ((request: WorkerRequest) => {
    requests.push(request);
    const answer = answers[request.type];
    return Promise.resolve(answer ? answer(request) : { ok: true, value: null });
  }) as AskWorker;
  return { ask, requests };
}

const paired = (): Answer => ({
  ok: true,
  value: { state: "paired", port: 5123, version: "0.1.0" },
});
const sessionsOf = (sessions: PublicSession[], repo: string | null) => (): Answer => ({
  ok: true,
  value: { sessions, repo } satisfies WorkerReplies["sessions"],
});

function flow(worker: ReturnType<typeof fakeWorker>) {
  const reports: [string, string][] = [];
  const send = new SendFlow({
    ask: worker.ask,
    pageUrl: () => PAGE,
    onChange: () => undefined,
    report: (text, outcome) => reports.push([text, outcome]),
  });
  return { send, reports };
}

describe("SendFlow pairing", () => {
  it("starts unpaired without asking for sessions, then pairs and loads them", async () => {
    let isPaired = false;
    const worker = fakeWorker({
      status: () => (isPaired ? paired() : { ok: true, value: { state: "unpaired", port: 47821 } }),
      pair: () => {
        isPaired = true;
        return paired();
      },
      sessions: sessionsOf([web], null),
    });
    const { send, reports } = flow(worker);
    await send.start();
    expect(send.state.connection.state).toBe("unpaired");
    expect(worker.requests.map((request) => request.type)).toEqual(["status"]);

    send.openPairing();
    await send.pair("ABCD-EFGH", 5123);
    expect(send.state.connection).toEqual({ state: "paired", port: 5123, version: "0.1.0" });
    expect(send.state.pairingOpen).toBe(false);
    expect(send.state.sessions).toEqual([web]);
    expect(reports).toContainEqual(["Paired with the helper.", "ok"]);
  });

  it("keeps the pairing form open and explains a wrong code", async () => {
    const failure: HelperFailure = { kind: "rejected", message: "That pairing code is wrong." };
    const worker = fakeWorker({
      status: () => ({ ok: true, value: { state: "unpaired", port: 47821 } }),
      pair: () => ({ ok: false, failure }),
    });
    const { send, reports } = flow(worker);
    await send.start();
    send.openPairing();
    await send.pair("NOPE", 47821);
    expect(send.state.pairingOpen).toBe(true);
    expect(reports).toEqual([["That pairing code is wrong.", "error"]]);
  });
});

describe("SendFlow without a service worker answer", () => {
  it("shows the failure instead of checking forever", async () => {
    const failure: HelperFailure = { kind: "rejected", message: "No answer." };
    const { send } = flow(fakeWorker({ status: () => ({ ok: false, failure }) }));
    await send.start();
    expect(send.state.connection).toEqual({
      state: "unreachable",
      port: 47821,
      message: "No answer.",
    });
    expect(send.state.note).toBe("No answer.");
  });
});

describe("SendFlow session picker", () => {
  it("preselects the only session on the site's remembered repository", async () => {
    const { send } = flow(
      fakeWorker({ status: paired, sessions: sessionsOf([web, api], "acme/api") }),
    );
    await send.start();
    expect(send.state.matchingPids).toEqual([2]);
    expect(send.target).toEqual(api);
    expect(send.state.note).toBeNull();
  });

  it("asks the user to pick when nothing is known, and explains no match", async () => {
    const unknown = flow(fakeWorker({ status: paired, sessions: sessionsOf([web, api], null) }));
    await unknown.send.start();
    expect(unknown.send.target).toBeNull();
    expect(unknown.send.state.note).toMatch(/Pick the session/);

    const none = flow(fakeWorker({ status: paired, sessions: sessionsOf([web], "acme/shop") }));
    await none.send.start();
    expect(none.send.target).toBeNull();
    expect(none.send.state.note).toMatch(/No session is working on acme\/shop.*copy/);

    const empty = flow(fakeWorker({ status: paired, sessions: sessionsOf([], null) }));
    await empty.send.start();
    expect(empty.send.state.note).toMatch(/No Claude Code session is running.*copy/);
  });

  it("preselects nothing unless exactly one session is on the site's repository", async () => {
    // The captain's case: the first session listed was on another repository and
    // nothing was known for the site; it must not be chosen for the user.
    const firstmate = { ...web, pid: 3, name: "firstmate-e1", repo: "kunchenguid/firstmate" };
    const vma86 = { ...api, pid: 4, name: "vma-86", repo: "ideon-labs/vma" };
    const vma85 = { ...api, pid: 5, name: "vma-85", repo: "ideon-labs/vma" };
    for (const repo of [null, "acme/pollenflow", "ideon-labs/vma"]) {
      const { send } = flow(
        fakeWorker({ status: paired, sessions: sessionsOf([firstmate, vma86, vma85], repo) }),
      );
      await send.start();
      expect(send.state.selectedPid).toBeNull();
      expect(send.target).toBeNull();
    }
  });

  it("keeps the user's own pick across refreshes, and drops a preselection that no longer fits", async () => {
    let repo: string | null = "acme/api";
    const worker = fakeWorker({
      status: paired,
      sessions: () => ({ ok: true, value: { sessions: [web, api], repo } }),
    });
    const { send } = flow(worker);
    await send.start();
    expect(send.target).toEqual(api);
    repo = null;
    await send.refresh();
    expect(send.target).toBeNull();

    send.select(1);
    await send.refresh();
    expect(send.target).toEqual(web);
  });

  it("remembers the chosen session's repository for the site and rematches", async () => {
    const worker = fakeWorker({ status: paired, sessions: sessionsOf([web, api], null) });
    const { send } = flow(worker);
    await send.start();
    send.select(1);
    await send.rememberSite(true);
    expect(worker.requests.at(-1)).toEqual({
      type: "remember-site",
      pageUrl: PAGE,
      repo: "acme/web",
    });
    expect(send.state.repo).toBe("acme/web");
    expect(send.state.matchingPids).toEqual([1]);

    await send.rememberSite(false);
    expect(worker.requests.at(-1)).toEqual({ type: "remember-site", pageUrl: PAGE, repo: null });
    expect(send.state.repo).toBeNull();
    expect(send.target).toEqual(web);
  });

  it("falls back to copy when the helper stops", async () => {
    let running = true;
    const worker = fakeWorker({
      status: paired,
      sessions: () =>
        running
          ? sessionsOf([web], "acme/web")()
          : { ok: false, failure: { kind: "unreachable", message: "The helper is not running." } },
    });
    const { send, reports } = flow(worker);
    await send.start();
    expect(send.target).toEqual(web);
    running = false;
    await send.refresh();
    expect(send.state.connection.state).toBe("unreachable");
    expect(send.target).toBeNull();
    expect(send.state.sessions).toEqual([]);
    expect(reports.at(-1)).toEqual(["The helper is not running.", "error"]);
  });
});

describe("SendFlow preview then send", () => {
  it("sends only after confirm, with the previewed pin id, digest and the same pins", async () => {
    const worker = fakeWorker({
      status: paired,
      sessions: sessionsOf([web], "acme/web"),
      preview: () => ({
        ok: true,
        value: { pinId: "sf-0123456789ab", digest: DIGEST, message: "exact" },
      }),
      send: () => ({
        ok: true,
        value: {
          id: "sf-0123456789ab",
          number: 1,
          sessionPid: 1,
          sessionName: "web",
          status: "sent",
          statusLabel: "Sent",
          createdAt: "x",
          updatedAt: "x",
          thread: [],
          pullRequestUrl: null,
          following: true,
          revision: 0,
        },
      }),
    });
    const { send, reports } = flow(worker);
    await send.start();
    await send.preview([pin("sf-aaaaaaaaaaaa", "One"), pin("sf-bbbbbbbbbbbb", "Two")]);

    const outgoing = {
      session: 1,
      pageUrl: PAGE,
      pins: [
        { comment: "One", context: { selector: "#buy" } },
        { comment: "Two", context: { selector: "#buy" } },
      ],
    };
    expect(worker.requests.at(-1)).toEqual({ type: "preview", outgoing });
    expect(send.state.preview?.message).toBe("exact");
    expect(worker.requests.some((request) => request.type === "send")).toBe(false);

    await send.confirm();
    expect(worker.requests.at(-1)).toEqual({
      type: "send",
      outgoing,
      pinId: "sf-0123456789ab",
      digest: DIGEST,
      localPinIds: ["sf-aaaaaaaaaaaa", "sf-bbbbbbbbbbbb"],
    });
    expect(send.state.preview).toBeNull();
    expect(reports.at(-1)).toEqual(["Sent 2 pins to claude@web.", "ok"]);
  });

  it("drops the preview and says so when the helper reports it expired", async () => {
    const expired: HelperFailure = {
      kind: "expired",
      message: "The preview expired or no longer matches. Preview the message again.",
    };
    const worker = fakeWorker({
      status: paired,
      sessions: sessionsOf([web], "acme/web"),
      preview: () => ({
        ok: true,
        value: { pinId: "sf-0123456789ab", digest: DIGEST, message: "m" },
      }),
      send: () => ({ ok: false, failure: expired }),
    });
    const { send, reports } = flow(worker);
    await send.start();
    await send.preview([pin("sf-aaaaaaaaaaaa", "One")]);
    await send.confirm();
    expect(send.state.preview).toBeNull();
    expect(send.state.connection.state).toBe("paired");
    expect(reports.at(-1)).toEqual([expired.message, "error"]);
  });

  it("cancelling a preview sends nothing", async () => {
    const worker = fakeWorker({
      status: paired,
      sessions: sessionsOf([web], "acme/web"),
      preview: () => ({
        ok: true,
        value: { pinId: "sf-0123456789ab", digest: DIGEST, message: "m" },
      }),
    });
    const { send } = flow(worker);
    await send.start();
    await send.preview([pin("sf-aaaaaaaaaaaa", "One")]);
    send.cancelPreview();
    await send.confirm();
    expect(worker.requests.some((request) => request.type === "send")).toBe(false);
  });

  it("forgets the chosen session when it is gone, and needs pairing again when unpaired", async () => {
    const worker = fakeWorker({
      status: paired,
      sessions: sessionsOf([web], "acme/web"),
      preview: () => ({ ok: false, failure: { kind: "gone", message: "Session gone." } }),
    });
    const { send } = flow(worker);
    await send.start();
    await send.preview([pin("sf-aaaaaaaaaaaa", "One")]);
    expect(send.target).toBeNull();

    const unpaired = flow(
      fakeWorker({
        status: paired,
        sessions: sessionsOf([web], "acme/web"),
        preview: () => ({ ok: false, failure: { kind: "unpaired", message: "Pair again." } }),
      }),
    );
    await unpaired.send.start();
    await unpaired.send.preview([pin("sf-aaaaaaaaaaaa", "One")]);
    expect(unpaired.send.state.connection.state).toBe("unpaired");
    expect(unpaired.send.target).toBeNull();
  });
});

describe("SendFlow follow-up from a pin's thread", () => {
  const tracking: PinTracking = {
    messageId: "sf-0123456789ab",
    sessionName: "api",
    sessionPid: 2,
    status: "fixed",
    statusLabel: "Fixed",
    pullRequestUrl: null,
    thread: [],
    earlier: [],
    events: [],
    blocked: null,
    resolved: false,
    inFlight: false,
    revision: 3,
    updatedAt: 1,
  };
  const delivered = {
    id: "sf-0123456789cd",
    number: 2,
    sessionPid: 2,
    sessionName: "api",
    status: "sent",
    statusLabel: "Sent",
    createdAt: "x",
    updatedAt: "x",
    thread: [],
    pullRequestUrl: null,
    following: true,
    revision: 0,
  };

  it("previews a reply to the pin's own session, and sends it only on confirm", async () => {
    const worker = fakeWorker({
      status: paired,
      sessions: sessionsOf([web, api], "acme/web"),
      preview: () => ({
        ok: true,
        value: { pinId: "sf-0123456789cd", digest: DIGEST, message: "m" },
      }),
      send: () => ({ ok: true, value: delivered }),
    });
    const { send, reports } = flow(worker);
    await send.start();
    // The page's chosen session is web; the pin went to api, so the reply goes there.
    expect(send.target?.name).toBe("web");
    await send.previewReply(pin("sf-aaaaaaaaaaaa", "Make it violet"), tracking, "  Darker please ");

    const comment = followUpComment("sf-0123456789ab", "Make it violet", "Darker please");
    const outgoing = {
      session: 2,
      pageUrl: PAGE,
      pins: [{ comment, context: { selector: "#buy" } }],
    };
    expect(worker.requests.at(-1)).toEqual({ type: "preview", outgoing });
    expect(send.state.preview).toMatchObject({ sessionName: "api", followUp: "Darker please" });

    await send.confirm();
    expect(worker.requests.at(-1)).toEqual({
      type: "send",
      outgoing,
      pinId: "sf-0123456789cd",
      digest: DIGEST,
      localPinIds: ["sf-aaaaaaaaaaaa"],
      followUp: "Darker please",
    });
    expect(reports.at(-1)).toEqual(["Sent your reply to claude@api.", "ok"]);
  });

  it("says so when the pin's session is no longer running", async () => {
    const worker = fakeWorker({ status: paired, sessions: sessionsOf([web], null) });
    const { send, reports } = flow(worker);
    await send.start();
    await send.previewReply(pin("sf-aaaaaaaaaaaa", "x"), tracking, "Again");
    expect(worker.requests.some((request) => request.type === "preview")).toBe(false);
    expect(reports.at(-1)?.[0]).toMatch(/claude@api is not running any more/);
  });

  it("names the earlier message and quotes a long comment only in part", () => {
    const comment = followUpComment("sf-0123456789ab", "y".repeat(500), "Shorter");
    expect(comment).toMatch(/^Follow-up to Squashflow pin \[sf-0123456789ab\] on the same element/);
    expect(comment).toContain(`"${"y".repeat(300)}…"`);
    expect(comment.endsWith("\n\nShorter")).toBe(true);
  });
});

describe("sessionTimes", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  it("says when a session started and was last active", () => {
    expect(
      sessionTimes(
        { ...web, startedAt: "2026-10-28T09:00:00.000Z", lastActiveAt: "2026-10-28T11:58:00.000Z" },
        now,
      ),
    ).toBe("started 3h ago · active 2m ago");
    expect(sessionTimes({ ...web, startedAt: "2026-10-25T12:00:00.000Z" }, now)).toBe(
      "started 3d ago",
    );
    expect(sessionTimes({ ...web, lastActiveAt: "2026-10-28T11:59:30.000Z" }, now)).toBe(
      "active just now",
    );
    expect(sessionTimes({ ...web, startedAt: "not a date" }, now)).toBe("");
  });
});
