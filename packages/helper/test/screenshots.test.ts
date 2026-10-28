import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertScreenshotDir, pruneScreenshots, screenshotFiles } from "../src/screenshots.js";
import { tempDir } from "./helpers.js";

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("screenshotFiles", () => {
  it("names one file per pin with a screenshot, by message id and pin number", () => {
    const files = screenshotFiles("/home/u/.squashflow/screenshots", "sf-0123456789ab", [
      { comment: "no screenshot" },
      { comment: "with", screenshot: { type: "image/jpeg", data: JPEG, width: 3, height: 2 } },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("/home/u/.squashflow/screenshots/sf-0123456789ab/pin-2.jpg");
    expect(files[0]?.reference).toMatchObject({ pin: 2, type: "image/jpeg", width: 3, height: 2 });
    expect(files[0]?.reference.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a folder the message could not name verbatim", () => {
    expect(() => assertScreenshotDir("/tmp/a<b")).toThrow();
    expect(() => assertScreenshotDir("/tmp/a\nb")).toThrow();
    expect(() => assertScreenshotDir("/tmp/with space")).not.toThrow();
  });
});

describe("pruneScreenshots", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => {
    dir = await tempDir();
  });
  afterEach(async () => {
    await dir.cleanup();
  });

  it("removes only message folders older than the limit", async () => {
    const now = Date.now();
    for (const [name, ageDays] of [
      ["sf-000000000001", 10],
      ["sf-000000000002", 1],
      ["keep-me", 10],
    ] as const) {
      const path = join(dir.path, name);
      await mkdir(path);
      await writeFile(join(path, "pin-1.png"), "x");
      const when = new Date(now - ageDays * DAY_MS);
      await utimes(path, when, when);
    }
    await pruneScreenshots(dir.path, 7 * DAY_MS, now);
    expect((await readdir(dir.path)).sort()).toEqual(["keep-me", "sf-000000000002"]);
  });

  it("does nothing when the folder does not exist", async () => {
    await expect(
      pruneScreenshots(join(dir.path, "missing"), DAY_MS, Date.now()),
    ).resolves.toBeUndefined();
  });
});
