/** Shared wiring for the commands that deliver pins. */

import { join } from "node:path";
import { DEFAULT_INBOX_SOCKET_DIR } from "./constants.js";
import { DeliveryService } from "./delivery.js";
import { openSenderSocket, type SenderSocket } from "./socket.js";
import { defaultStateDir } from "./state.js";
import { claudeConfigDir } from "./transcript.js";

export interface DeliveryRuntime {
  delivery: DeliveryService;
  sender: SenderSocket;
  close(): Promise<void>;
}

export async function openDeliveryRuntime(
  stateDir: string = defaultStateDir(),
): Promise<DeliveryRuntime> {
  const sender = await openSenderSocket(join(stateDir, "run"));
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
