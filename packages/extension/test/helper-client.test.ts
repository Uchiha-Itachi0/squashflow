import { describe, expect, it } from "vitest";
import { HelperClient, type FetchLike } from "../src/helper/client";
import { apiFailure, pairingFailure } from "../src/helper/errors";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: unknown): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return Object.assign(fetch, { calls });
}

const TOKEN = "tok_0123456789abcdefghij";
const session = { pid: 42, name: "web", status: "idle", cwd: "/w/web", repo: "acme/web" };
const outgoing = {
  session: 42,
  pageUrl: "https://example.com/",
  pins: [{ comment: "Fix it", context: { selector: "#buy" } }],
};

describe("HelperClient", () => {
  it("pairs without a token and returns the helper's token", async () => {
    const fetch = fakeFetch(200, { token: TOKEN });
    const result = await new HelperClient(fetch, 47821, null).pair("ABCD-EFGH");
    expect(result).toEqual({ ok: true, value: TOKEN });
    const [call] = fetch.calls;
    expect(call?.url).toBe("http://127.0.0.1:47821/pair");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toEqual({ "Content-Type": "application/json" });
    expect(call?.init.credentials).toBe("omit");
    expect(call?.init.redirect).toBe("error");
    expect(JSON.parse(call?.init.body as string)).toEqual({ code: "ABCD-EFGH" });
  });

  it("sends the token only in the Authorization header", async () => {
    const fetch = fakeFetch(200, { sessions: [session] });
    const result = await new HelperClient(fetch, 5000, TOKEN).sessions();
    // An older helper sends no session detail; it reads as unknown.
    const detail = {
      title: null,
      branch: null,
      startedAt: null,
      lastActiveAt: null,
      account: null,
      terminal: null,
    };
    expect(result).toEqual({ ok: true, value: [{ ...session, ...detail }] });
    expect(fetch.calls[0]?.url).toBe("http://127.0.0.1:5000/sessions");
    expect(fetch.calls[0]?.init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it("previews with preview: true, then sends the pin id and digest instead", async () => {
    const digest = "a".repeat(64);
    const previewFetch = fakeFetch(200, { pinId: "sf-0123456789ab", digest, message: "hello" });
    const preview = await new HelperClient(previewFetch, 1, TOKEN).preview(outgoing);
    expect(preview).toEqual({
      ok: true,
      value: { pinId: "sf-0123456789ab", digest, message: "hello" },
    });
    expect(JSON.parse(previewFetch.calls[0]?.init.body as string)).toEqual({
      ...outgoing,
      preview: true,
    });

    const pin = {
      id: "sf-0123456789ab",
      number: 1,
      sessionPid: 42,
      sessionName: "web",
      status: "sent",
      statusLabel: "Sent",
      createdAt: "2026-10-28T00:00:00.000Z",
      updatedAt: "2026-10-28T00:00:00.000Z",
    };
    const sendFetch = fakeFetch(202, { pin });
    const sent = await new HelperClient(sendFetch, 1, TOKEN).send(
      outgoing,
      "sf-0123456789ab",
      digest,
    );
    // A record without thread fields (an older helper) reads with empty defaults.
    expect(sent).toEqual({
      ok: true,
      value: {
        ...pin,
        thread: [],
        pullRequestUrl: null,
        blocked: null,
        following: false,
        revision: 0,
      },
    });
    expect(JSON.parse(sendFetch.calls[0]?.init.body as string)).toEqual({
      ...outgoing,
      pinId: "sf-0123456789ab",
      digest,
    });
  });

  it("does not call the helper without a token", async () => {
    const fetch = fakeFetch(200, {});
    const result = await new HelperClient(fetch, 1, null).sessions();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe("unpaired");
    expect(fetch.calls).toHaveLength(0);
  });

  it("reports a refused connection as the helper not running", async () => {
    const fetch: FetchLike = () => Promise.reject(new TypeError("Failed to fetch"));
    const result = await new HelperClient(fetch, 1, TOKEN).health();
    expect(!result.ok && result.failure.kind).toBe("unreachable");
    expect(!result.ok && result.failure.message).toMatch(/npx squashflow/);
  });

  it("maps a rejected token to pairing again", async () => {
    const result = await new HelperClient(
      fakeFetch(401, { error: "Invalid token" }),
      1,
      TOKEN,
    ).health();
    expect(!result.ok && result.failure.kind).toBe("unpaired");
  });

  it("refuses a response that does not match the shared schema", async () => {
    const result = await new HelperClient(
      fakeFetch(200, { sessions: "nope" }),
      1,
      TOKEN,
    ).sessions();
    expect(!result.ok && result.failure.message).toMatch(/does not understand/);
  });
});

describe("helper error mapping", () => {
  it("explains pairing failures by status", () => {
    expect(pairingFailure(401, "Wrong pairing code").message).toMatch(/code is wrong/);
    expect(pairingFailure(410, "Pairing code expired").message).toMatch(/expired/);
    expect(pairingFailure(429, "Too many attempts").message).toMatch(/Too many wrong codes/);
    expect(pairingFailure(409, "No pairing code is active").message).toMatch(/no pairing code/);
    expect(pairingFailure(403, "Origin not allowed").kind).toBe("unpaired");
  });

  it("turns preview conflicts into preview again", () => {
    for (const error of [
      "No preview with that pin id; preview the message again",
      "The message changed since it was previewed; preview again",
      "The session changed since the preview; preview again",
    ]) {
      expect(apiFailure(409, error)).toEqual({
        kind: "expired",
        message: "The preview expired or no longer matches. Preview the message again.",
      });
    }
  });

  it("names a vanished session, oversized pins, and passes other helper words through", () => {
    expect(apiFailure(404, "No running Claude Code session matches that session").kind).toBe(
      "gone",
    );
    expect(apiFailure(413, "Body too large").message).toMatch(/too large/);
    expect(apiFailure(409, "The session's inbox socket was refused").message).toBe(
      "The session's inbox socket was refused.",
    );
    expect(apiFailure(500, undefined).message).toMatch(/status 500/);
    expect(apiFailure(403, "Origin not allowed").kind).toBe("unpaired");
  });
});
