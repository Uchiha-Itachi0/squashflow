import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertLoopbackHost } from "../src/http/server.js";
import { fakeSession, tempDir } from "./helpers.js";
import { EXTENSION_ORIGIN, send, startTestHelper, TOKEN, type TestHelper } from "./http-helpers.js";

describe("request checks", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let helper: TestHelper;
  let port: number;

  beforeEach(async () => {
    dir = await tempDir();
    helper = await startTestHelper(dir.path, [fakeSession()]);
    port = helper.server.port;
  });
  afterEach(async () => {
    await helper.close();
    await dir.cleanup();
  });

  it("accepts a well-formed request from the paired extension", async () => {
    const reply = await send(port, { path: "/health", headers: helper.auth() });
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({ ok: true, paired: true });
    expect(reply.headers["access-control-allow-origin"]).toBe(EXTENSION_ORIGIN);
  });

  it.each(["localhost:PORT", "evil.example:PORT", "127.0.0.1", "127.0.0.1:1"])(
    "rejects Host %s",
    async (host) => {
      const reply = await send(port, {
        path: "/health",
        headers: helper.auth({ host: host.replace("PORT", String(port)) }),
      });
      expect(reply.status).toBe(403);
      expect(reply.json()).toEqual({ error: "Host not allowed" });
    },
  );

  it("rejects a web page origin, and never answers CORS with *", async () => {
    const reply = await send(port, {
      path: "/sessions",
      headers: helper.auth({ origin: "https://evil.example" }),
    });
    expect(reply.status).toBe(403);
    expect(reply.json()).toEqual({ error: "Origin not allowed" });
    expect(reply.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects a different extension origin", async () => {
    const reply = await send(port, {
      path: "/sessions",
      headers: helper.auth({ origin: `chrome-extension://${"b".repeat(32)}` }),
    });
    expect(reply.status).toBe(403);
  });

  it("rejects a state-changing request with no Origin", async () => {
    const reply = await send(port, {
      method: "POST",
      path: "/pins",
      headers: helper.auth({ origin: undefined }),
      body: "{}",
    });
    expect(reply.status).toBe(403);
    expect(reply.json()).toEqual({ error: "Origin required" });
  });

  it("rejects an oversize declared body before the token check", async () => {
    const reply = await send(port, {
      method: "POST",
      path: "/pins",
      headers: helper.auth({ authorization: undefined, "content-type": "application/json" }),
      body: "x".repeat(8192),
    });
    expect(reply.status).toBe(413);
  });

  it("rejects an oversize streamed body", async () => {
    const reply = await send(port, {
      method: "POST",
      path: "/pins",
      headers: helper.auth({ "transfer-encoding": "chunked" }),
      body: JSON.stringify({
        session: 1,
        pageUrl: "https://a.example/",
        pins: [{ comment: "x".repeat(7000) }, { comment: "y".repeat(7000) }],
      }),
    });
    expect(reply.status).toBe(413);
  });

  it("keeps the smaller cap for every endpoint but POST /pins", async () => {
    const reply = await send(port, {
      method: "POST",
      path: "/pair",
      headers: helper.auth({ authorization: undefined, "content-type": "application/json" }),
      body: "x".repeat(2048),
    });
    expect(reply.status).toBe(413);
  });

  it("rejects a missing body", async () => {
    const reply = await send(port, { method: "POST", path: "/pins", headers: helper.auth() });
    expect(reply.status).toBe(400);
    expect(reply.json()).toEqual({ error: "Body required" });
  });

  it.each([undefined, "Bearer wrong-token-000000000000", `Basic ${TOKEN}`, TOKEN])(
    "rejects authorization %s",
    async (authorization) => {
      const reply = await send(port, {
        path: "/sessions",
        headers: helper.auth({ authorization }),
      });
      expect(reply.status).toBe(401);
    },
  );

  it("rejects unknown fields, at the top level and nested", async () => {
    const base = { session: 4242, pageUrl: "https://a.example/", preview: true };
    for (const body of [
      { ...base, pins: [{ comment: "x" }], extra: 1 },
      { ...base, pins: [{ comment: "x", extra: 1 }] },
      { ...base, pins: [{ comment: "x", context: { selector: "#a", script: "alert(1)" } }] },
    ]) {
      const reply = await send(port, {
        method: "POST",
        path: "/pins",
        headers: helper.auth(),
        body: JSON.stringify(body),
      });
      expect(reply.status).toBe(400);
      expect(reply.json<{ error: string }>().error).toMatch(/Invalid body/);
    }
  });

  it("rejects invalid JSON and non-http page URLs", async () => {
    const bad = await send(port, {
      method: "POST",
      path: "/pins",
      headers: helper.auth(),
      body: "{",
    });
    expect(bad.status).toBe(400);
    const js = await send(port, {
      method: "POST",
      path: "/pins",
      headers: helper.auth(),
      body: JSON.stringify({
        session: 4242,
        pageUrl: "javascript:alert(1)",
        pins: [{ comment: "x" }],
        preview: true,
      }),
    });
    expect(js.status).toBe(400);
  });

  it("refuses to deliver without a preview", async () => {
    const reply = await send(port, {
      method: "POST",
      path: "/pins",
      headers: helper.auth(),
      body: JSON.stringify({
        session: 4242,
        pageUrl: "https://a.example/",
        pins: [{ comment: "x" }],
      }),
    });
    expect(reply.status).toBe(400);
  });

  it("answers preflight only for the paired origin", async () => {
    const ok = await send(port, {
      method: "OPTIONS",
      path: "/pins",
      headers: { host: `127.0.0.1:${port}`, origin: EXTENSION_ORIGIN },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe(EXTENSION_ORIGIN);
    const bad = await send(port, {
      method: "OPTIONS",
      path: "/pins",
      headers: { host: `127.0.0.1:${port}`, origin: "https://evil.example" },
    });
    expect(bad.status).toBe(403);
  });
});

describe("binding", () => {
  it.each(["0.0.0.0", "::", "localhost", "192.168.1.10"])("refuses to bind %s", (host) => {
    expect(() => assertLoopbackHost(host)).toThrow(/Refusing to bind/);
  });
});

describe("pairing endpoint", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let helper: TestHelper;

  beforeEach(async () => {
    dir = await tempDir();
    helper = await startTestHelper(dir.path, [], { paired: false });
  });
  afterEach(async () => {
    await helper.close();
    await dir.cleanup();
  });

  const pair = (code: string, origin: string | null = EXTENSION_ORIGIN) =>
    send(helper.server.port, {
      method: "POST",
      path: "/pair",
      headers: { host: `127.0.0.1:${helper.server.port}`, origin: origin ?? undefined },
      body: JSON.stringify({ code }),
    });

  it("requires pairing before anything else", async () => {
    const reply = await send(helper.server.port, { path: "/health", headers: helper.auth() });
    expect(reply.status).toBe(403);
  });

  it("exchanges a valid code for a token that then authenticates", async () => {
    const { code } = helper.pairing.issue();
    const reply = await pair(code);
    expect(reply.status).toBe(200);
    const { token } = reply.json<{ token: string }>();
    const health = await send(helper.server.port, {
      path: "/health",
      headers: helper.auth({ authorization: `Bearer ${token}` }),
    });
    expect(health.status).toBe(200);
    expect((await pair(code)).status).toBe(409);
  });

  it("rejects web origins and wrong codes, then locks", async () => {
    const { code } = helper.pairing.issue();
    expect((await pair(code, "https://evil.example")).status).toBe(403);
    expect((await pair(code, null)).status).toBe(403);
    for (let i = 0; i < 4; i += 1) expect((await pair("WRONG-CODE")).status).toBe(401);
    expect((await pair("WRONG-CODE")).status).toBe(429);
    expect((await pair(code)).status).toBe(409);
  });
});
