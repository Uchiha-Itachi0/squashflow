/** Shared wiring for the commands that deliver pins. */

import { join } from "node:path";
import { DEFAULT_INBOX_SOCKET_DIR } from "./constants.js";
import { DeliveryService } from "./delivery.js";
import { openSenderSocket, type SenderSocket } from "./socket.js";
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

export async function openDeliveryRuntime(): Promise<DeliveryRuntime> {
  const sender = await openSenderSocket(senderSocketDir());
  const delivery = new DeliveryService({
    socketDir: DEFAULT_INBOX_SOCKET_DIR,
    claudeConfigDir: claudeConfigDir(),
    senderSocketPath: sender.path,
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
