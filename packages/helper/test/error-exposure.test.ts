import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeSession, tempDir } from "./helpers.js";
import { send, startTestHelper, type TestHelper } from "./http-helpers.js";

/**
 * Caught error text (file paths, command output, stack traces) must never
 * reach an HTTP response; unexpected failures get one fixed message and the
 * detail goes to the helper's own terminal log.
 */
describe("error responses do not expose internal error text", () => {
  const secret = "/Users/someone/.secret/path at Object.<anonymous> (internal.js:1:1)";
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let helper: TestHelper;
  let warnings: string[];

  beforeEach(async () => {
    dir = await tempDir();
    helper = await startTestHelper(dir.path, [fakeSession({ name: "web" })]);
    warnings = [];
    helper.context.log = { ...helper.context.log, warn: (text) => warnings.push(text) };
  });
  afterEach(async () => {
    await helper.close();
    await dir.cleanup();
  });

  const postPins = (session: string | number) =>
    send(helper.server.port, {
      method: "POST",
      path: "/pins",
      headers: helper.auth(),
      body: JSON.stringify({
        session,
        pageUrl: "https://example.com/",
        pins: [{ comment: "x" }],
        preview: true,
      }),
    });

  it("returns a generic 502 for an unexpected failure and logs the detail locally", async () => {
    helper.context.discover = () => Promise.reject(new Error(secret));
    const reply = await postPins("web");
    expect(reply.status).toBe(502);
    expect(reply.json()).toEqual({
      error: "The helper could not complete the request; see its terminal for details",
    });
    expect(reply.body).not.toContain(".secret");
    expect(warnings.some((line) => line.includes(secret))).toBe(true);
  });

  it("does not echo the requested session selector back", async () => {
    const reply = await postPins("<script>unknown</script>");
    expect(reply.status).toBe(404);
    expect(reply.json()).toEqual({ error: "No running Claude Code session matches that session" });
  });

  it("returns a generic 500 when an unguarded route throws", async () => {
    helper.context.discover = () => Promise.reject(new Error(secret));
    const reply = await send(helper.server.port, { path: "/sessions", headers: helper.auth() });
    expect(reply.status).toBe(500);
    expect(reply.body).not.toContain(".secret");
  });
});
