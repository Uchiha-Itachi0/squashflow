/**
 * Copy-and-paste mode: pins as a message the user pastes into any session.
 * Built by the same shared builder as delivered messages, so the structure,
 * untrusted-data fencing and escaping are identical.
 */

import { buildMessage, type DetailLevel } from "@squashflow/shared";
import { newPinId, type StoredPin } from "../store/pins";

export interface CopyRequest {
  pins: readonly StoredPin[];
  level: DetailLevel;
  /** The page the pins are on; used when the level includes the page URL. */
  pageUrl: string;
  /** Message id. Defaults to the pin's own id for one pin and a fresh id for several. */
  pinId?: string;
}

export function buildCopyText({ pins, level, pageUrl, pinId }: CopyRequest): string {
  const [first] = pins;
  if (first === undefined) throw new Error("There are no pins to copy.");
  return buildMessage({
    pinId: pinId ?? (pins.length === 1 ? first.id : newPinId()),
    source: "clipboard",
    pageUrl,
    pins: pins.map(({ comment, context }) => ({ comment, context })),
    detail: level,
  });
}

/**
 * Write text to the clipboard from a user gesture. Pages served over plain http
 * have no async clipboard API, so fall back to a selected textarea and execCommand.
 */
export async function writeClipboard(text: string, scratch: ParentNode): Promise<void> {
  if (window.isSecureContext && "clipboard" in navigator) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission denied or the document lost focus: try the fallback below.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  scratch.append(area);
  area.select();
  // execCommand is deprecated but is the only clipboard write available on http pages.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("The browser blocked the clipboard. Try again.");
}
