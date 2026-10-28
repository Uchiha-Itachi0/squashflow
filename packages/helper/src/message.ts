/**
 * Delivery-only parts of the message. The message itself is built by the shared
 * builder in @squashflow/shared, which the extension also uses for copy.
 */

import { createHash } from "node:crypto";
import { SENDER_NAME } from "./constants.js";

export {
  buildMessage,
  CONTEXT_CLOSE,
  CONTEXT_OPEN,
  escapeForFence,
  type MessageInput,
  type PinSource,
} from "@squashflow/shared";

/** Wrap a message as a cross-session message from the helper's own sender socket. */
export function wrapForInbox(message: string, senderSocketPath: string): string {
  if (/["<>\s]/.test(senderSocketPath)) {
    throw new Error("Sender socket path must not contain quotes, angle brackets or spaces.");
  }
  return [
    `<cross-session-message from="uds:${senderSocketPath}" from-name="${SENDER_NAME}">`,
    message,
    "</cross-session-message>",
  ].join("\n");
}

export function digestMessage(message: string): string {
  return createHash("sha256").update(message, "utf8").digest("hex");
}
