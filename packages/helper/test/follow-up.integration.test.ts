import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blockedLine, buildFollowUp } from "@squashflow/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFolderName } from "../src/transcript.js";
import { fakeInbox, fakeSession, tempDir, type FakeInbox } from "./helpers.js";
import { send, startTestHelper, type TestHelper } from "./http-helpers.js";

const session = fakeSession();
const pinsBody = {
  session: session.name,
  pageUrl: "https://example.com/pricing",
  pins: [{ comment: "Make the Buy button blue" }],
};

interface PinView {
  status: string;
  statusLabel: string;
  blocked: { kind: string; reason: string | null } | null;
  pullRequestUrl: string | null;
  thread: { text: string }[];
  following: boolean;
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function peerRecord(body: string): string {
  return JSON.stringify({
    type: "user",
    isMeta: true,
    origin: { kind: "peer", from: "unknown", name: "squashflow", body },
    message: { role: "user", content: `Another Claude session sent a message:\n${body}` },
  });
}

function replyRecords(text: string): string {
  return [
    JSON.stringify({
      type: "assistant",
      message: {
        id: `msg_${String(Math.random())}`,
        role: "assistant",
        content: [{ type: "text", text }],
      },
    }),
    JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 900 }),
  ].join("\n");
}

describe("GitHub flow: blocked replies and follow-ups", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let helper: TestHelper;
  let inbox: FakeInbox;
  let transcript: string;

  beforeEach(async () => {
    dir = await tempDir();
    await mkdir(join(dir.path, "socks"), { recursive: true });
    inbox = await fakeInbox(join(dir.path, "socks", `${session.pid}.sock`));
    const folder = join(dir.path, "claude", "projects", projectFolderName(session.cwd));
    await mkdir(folder, { recursive: true });
    transcript = join(folder, `${session.sessionId ?? ""}.jsonl`);
    await writeFile(transcript, "");
    helper = await startTestHelper(dir.path, [session]);
  });
  afterEach(async () => {
    await helper.close();
    await inbox.close();
    await dir.cleanup();
  });

  const post = (path: string, body: unknown) =>
    send(helper.server.port, {
      method: "POST",
      path,
      headers: helper.auth(),
      body: JSON.stringify(body),
    });
  const read = async (id: string): Promise<PinView> =>
    (await send(helper.server.port, { path: `/pins/${id}`, headers: helper.auth() })).json<{
      pin: PinView;
    }>().pin;

  /** Deliver a pin and have the session reply with the blocked line. */
  async function blockedPin(): Promise<string> {
    const { pinId, digest, message } = (await post("/pins", { ...pinsBody, preview: true })).json<{
      pinId: string;
      digest: string;
      message: string;
    }>();
    expect((await post("/pins", { ...pinsBody, pinId, digest })).status).toBe(202);
    await appendFile(transcript, `${peerRecord(message)}\n`);
    const reply = [
      "Committed on squashflow/blue-buy; the push was refused. See https://github.com/acme/demo/pull/1 for a related PR.",
      blockedLine(pinId, "no push permission to acme/demo"),
    ].join("\n");
    await appendFile(transcript, `${replyRecords(reply)}\n`);
    const pin = await waitFor(
      () => read(pinId),
      (value) => value.status === "blocked",
    );
    expect(pin).toMatchObject({
      status: "blocked",
      statusLabel: "Blocked: GitHub access",
      blocked: { kind: "github-access", reason: "no push permission to acme/demo" },
      pullRequestUrl: null,
      following: false,
    });
    return pinId;
  }

  it("previews a follow-up and delivers it only with the preview's digest", async () => {
    const id = await blockedPin();
    const preview = await post(`/pins/${id}/follow-up`, { action: "retry", preview: true });
    expect(preview.status).toBe(200);
    const { digest, message } = preview.json<{ digest: string; message: string }>();
    expect(message).toBe(buildFollowUp(id, "retry"));
    expect(inbox.lines).toHaveLength(1);

    expect((await post(`/pins/${id}/follow-up`, { action: "retry" })).status).toBe(400);
    expect((await post(`/pins/${id}/follow-up`, { action: "fork", digest })).status).toBe(409);
    expect(
      (await post(`/pins/${id}/follow-up`, { action: "retry", digest: "0".repeat(64) })).status,
    ).toBe(409);
    expect(inbox.lines).toHaveLength(1);

    const sent = await post(`/pins/${id}/follow-up`, { action: "retry", digest });
    expect(sent.status).toBe(202);
    expect(sent.json()).toMatchObject({ pin: { status: "sent", blocked: null, following: true } });
    await waitFor(
      () => Promise.resolve(inbox.lines.length),
      (count) => count === 2,
    );
    const line = JSON.parse(inbox.lines[1] ?? "{}") as { message: { content: string } };
    expect(line.message.content).toContain(`\n${message}\n</cross-session-message>`);
    // In flight again: no second follow-up until it is answered.
    expect((await post(`/pins/${id}/follow-up`, { action: "retry", preview: true })).status).toBe(
      409,
    );

    await appendFile(transcript, `${peerRecord(message)}\n`);
    await appendFile(
      transcript,
      `${replyRecords("Pushed. https://github.com/acme/demo/pull/7")}\n`,
    );
    const fixed = await waitFor(
      () => read(id),
      (value) => value.status === "fixed",
    );
    expect(fixed).toMatchObject({
      status: "fixed",
      blocked: null,
      pullRequestUrl: "https://github.com/acme/demo/pull/7",
    });
    expect(fixed.thread).toHaveLength(2);
  });

  it("returns to Blocked: GitHub access after a patch reply", async () => {
    const id = await blockedPin();
    const { digest, message } = (
      await post(`/pins/${id}/follow-up`, { action: "patch", preview: true })
    ).json<{ digest: string; message: string }>();
    expect((await post(`/pins/${id}/follow-up`, { action: "patch", digest })).status).toBe(202);
    await appendFile(transcript, `${peerRecord(message)}\n`);
    const patch = "Blue button.\n```diff\n--- a/x.css\n+++ b/x.css\n@@ -1 +1 @@\n-a\n+b\n```";
    await appendFile(transcript, `${replyRecords(patch)}\n`);
    const pin = await waitFor(
      () => read(id),
      (value) => value.thread.length === 2,
    );
    expect(pin).toMatchObject({
      status: "blocked",
      statusLabel: "Blocked: GitHub access",
      blocked: { kind: "github-access", reason: "no push permission to acme/demo" },
    });
    expect(pin.thread[1]?.text).toBe(patch);
  });

  it("refuses follow-ups for unknown pins and pins not blocked on GitHub access", async () => {
    expect(
      (await post("/pins/sf-000000000000/follow-up", { action: "retry", preview: true })).status,
    ).toBe(404);
    const { pinId, digest } = (await post("/pins", { ...pinsBody, preview: true })).json<{
      pinId: string;
      digest: string;
    }>();
    await post("/pins", { ...pinsBody, pinId, digest });
    expect((await post(`/pins/${pinId}/follow-up`, { action: "fork", preview: true })).status).toBe(
      409,
    );
    expect(
      (await post(`/pins/${pinId}/follow-up`, { action: "push --force", preview: true })).status,
    ).toBe(400);
  });
});
