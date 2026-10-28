/** Shared wiring for the commands that deliver pins. */

import { join } from "node:path";
import { SCREENSHOT_MAX_AGE_MS } from "./constants.js";
import { DeliveryService } from "./delivery.js";
import { pruneScreenshots } from "./screenshots.js";
import { defaultStateDir } from "./state.js";
import { inboxSocketDir, openSenderSocket, type SenderSocket } from "./socket.js";
import { claudeConfigDir } from "./transcript.js";

export interface DeliveryRuntime {
  delivery: DeliveryService;
  sender: SenderSocket;
  close(): Promise<void>;
}

/**
 * A short per-user directory without spaces: the path is quoted in the
 * `from="uds:..."` attribute and Unix socket paths are length-limited.
 */
export function senderSocketDir(uid: number | undefined = process.getuid?.()): string {
  return join("/tmp", `squashflow-${uid ?? "user"}`);
}

/** Where delivered messages' region screenshots are written, under the helper's state. */
export function screenshotDir(): string {
  return join(defaultStateDir(), "screenshots");
}

export async function openDeliveryRuntime(): Promise<DeliveryRuntime> {
  const screenshots = screenshotDir();
  await pruneScreenshots(screenshots, SCREENSHOT_MAX_AGE_MS, Date.now());
  const sender = await openSenderSocket(senderSocketDir());
  const delivery = new DeliveryService({
    socketDir: inboxSocketDir(),
    claudeConfigDir: claudeConfigDir(),
    senderSocketPath: sender.path,
    screenshotDir: screenshots,
  });
  return {
    delivery,
    sender,
    close: async () => {
      delivery.close();
      await sender.close();
    },
  };
}
