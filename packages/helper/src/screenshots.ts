/**
 * Region screenshots in a delivered message. Each image is written to its own file,
 * readable only by the user, at `<screenshot dir>/<message id>/pin-<n>.<png|jpg>`, and the
 * message names that file with the image's SHA-256. The path depends only on the message
 * id and the pin's number, so the previewed message names the file that delivery writes,
 * and the hash in it pins down the image: what the user confirmed is what is delivered.
 */

import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { screenshotExtension, type ScreenshotReference } from "@squashflow/shared";
import type { PinInput } from "./schemas.js";

const SCREENSHOT_DIR_MODE = 0o700;
const SCREENSHOT_FILE_MODE = 0o600;
const MESSAGE_DIR = /^sf-[0-9a-f]{12}$/;

export interface ScreenshotFile {
  path: string;
  bytes: Buffer;
  reference: ScreenshotReference;
}

/** Characters a screenshot path must not contain, so the message can name it verbatim. */
export function assertScreenshotDir(dir: string): void {
  if (/[<>\r\n]/.test(dir)) {
    throw new Error("The screenshot folder must not contain angle brackets or line breaks.");
  }
}

/** The file each pin's screenshot goes to, and how the message names it. */
export function screenshotFiles(
  dir: string,
  pinId: string,
  pins: readonly PinInput[],
): ScreenshotFile[] {
  assertScreenshotDir(dir);
  return pins.flatMap((pin, index) => {
    const shot = pin.screenshot;
    if (shot === undefined) return [];
    const number = index + 1;
    const path = join(dir, pinId, `pin-${number}.${screenshotExtension(shot.type)}`);
    const bytes = Buffer.from(shot.data, "base64");
    return [
      {
        path,
        bytes,
        reference: {
          pin: number,
          type: shot.type,
          width: shot.width,
          height: shot.height,
          where: `read the image file ${path}`,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      },
    ];
  });
}

/** Write a message's screenshots, readable and writable only by the user. */
export async function writeScreenshotFiles(
  dir: string,
  pinId: string,
  files: readonly ScreenshotFile[],
): Promise<void> {
  if (files.length === 0) return;
  const messageDir = join(dir, pinId);
  await makePrivateDir(dir);
  await makePrivateDir(messageDir);
  for (const file of files) {
    await writeFile(file.path, file.bytes, { mode: SCREENSHOT_FILE_MODE });
    await chmod(file.path, SCREENSHOT_FILE_MODE);
  }
}

/** Remove the screenshot folders of messages delivered longer ago than `maxAgeMs`. */
export async function pruneScreenshots(dir: string, maxAgeMs: number, now: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  for (const name of names.filter((entry) => MESSAGE_DIR.test(entry))) {
    const path = join(dir, name);
    const info = await lstat(path);
    if (info.isDirectory() && now - info.mtimeMs > maxAgeMs) {
      await rm(path, { recursive: true, force: true });
    }
  }
}

/** A folder only the user can use; a symlink in its place is refused, not followed. */
async function makePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: SCREENSHOT_DIR_MODE });
  const info = await lstat(dir);
  if (!info.isDirectory()) throw new Error(`${dir} is not a folder.`);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error(`${dir} is not owned by the current user.`);
  }
  await chmod(dir, SCREENSHOT_DIR_MODE);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
