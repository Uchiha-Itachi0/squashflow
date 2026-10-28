import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkInboxSocket, SocketRefusedError, writeToInbox } from "../src/socket.js";
import { fakeInbox, tempDir } from "./helpers.js";

describe("inbox socket checks", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => {
    dir = await tempDir();
  });
  afterEach(async () => {
    await dir.cleanup();
  });

  it("accepts an owner-only socket and writes one NDJSON user line", async () => {
    const inbox = await fakeInbox(join(dir.path, "1.sock"));
    await writeToInbox(inbox.path, "hello");
    expect(JSON.parse(await inbox.received)).toEqual({
      type: "user",
      message: { role: "user", content: "hello" },
    });
    await inbox.close();
  });

  it("refuses a socket that is not mode 0600", async () => {
    const inbox = await fakeInbox(join(dir.path, "2.sock"), 0o666);
    await expect(checkInboxSocket(inbox.path)).rejects.toThrow(/mode 666/);
    await expect(writeToInbox(inbox.path, "x")).rejects.toBeInstanceOf(SocketRefusedError);
    expect(inbox.lines).toHaveLength(0);
    await inbox.close();
  });

  it("refuses a socket owned by another user", async () => {
    const inbox = await fakeInbox(join(dir.path, "3.sock"));
    const otherUid = (process.getuid?.() ?? 0) + 1;
    await expect(checkInboxSocket(inbox.path, otherUid)).rejects.toThrow(/not owned/);
    await inbox.close();
  });

  it("refuses regular files, symlinks and missing paths", async () => {
    const file = join(dir.path, "file.sock");
    await writeFile(file, "", { mode: 0o600 });
    await expect(checkInboxSocket(file)).rejects.toThrow(/not a socket/);
    const inbox = await fakeInbox(join(dir.path, "4.sock"));
    const link = join(dir.path, "link.sock");
    await symlink(inbox.path, link);
    await expect(checkInboxSocket(link)).rejects.toThrow(/not a socket/);
    await expect(checkInboxSocket(join(dir.path, "missing.sock"))).rejects.toThrow(
      /No inbox socket/,
    );
    await inbox.close();
  });
});
