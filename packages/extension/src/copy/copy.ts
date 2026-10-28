/**
 * Copy-and-paste mode: pins as a message the user pastes into any session.
 * Built by the same shared builder as delivered messages, so the structure,
 * untrusted-data fencing and escaping are identical.
 *
 * At the forensic level a pin's region screenshot goes on the clipboard as an image next
 * to the text, when there is one screenshot and the page's clipboard takes images. The
 * copied text names each screenshot and says where it is: on the clipboard, or behind the
 * pin's Copy screenshot button, or (on pages without the clipboard API) only in a sent pin.
 */

import {
  buildMessage,
  includesScreenshots,
  type DetailLevel,
  type Screenshot,
  type ScreenshotReference,
} from "@squashflow/shared";
import { base64ToBuffer } from "../capture/screenshot";
import { newPinId, type StoredPin } from "../store/pins";

export const ON_CLIPBOARD =
  "copied to the clipboard as an image with this text; the user can paste it here too";
export const BEHIND_BUTTON =
  "not in this text; the user can press Copy screenshot on the pin in the Squashflow panel and paste the image here";
export const NO_IMAGE_CLIPBOARD =
  "not in this text; this page cannot put images on the clipboard, so the user can send the pin with Squashflow to include it";

export interface CopyRequest {
  pins: readonly StoredPin[];
  level: DetailLevel;
  /** The page the pins are on; used when the level includes the page URL. */
  pageUrl: string;
  /** Message id. Defaults to the pin's own id for one pin and a fresh id for several. */
  pinId?: string;
  /** Whether the screenshot (there is exactly one) goes on the clipboard with the text. */
  imageAttached?: boolean;
  /** Whether this page can put images on the clipboard at all. */
  imagesSupported?: boolean;
}

export interface CopyResult {
  /** Whether the screenshot went on the clipboard as an image. */
  imageAttached: boolean;
  /** How many of the copied pins have a screenshot the copied text names. */
  screenshots: number;
}

export function buildCopyText({
  pins,
  level,
  pageUrl,
  pinId,
  imageAttached = false,
  imagesSupported = true,
}: CopyRequest): string {
  const [first] = pins;
  if (first === undefined) throw new Error("There are no pins to copy.");
  const where = imageAttached ? ON_CLIPBOARD : imagesSupported ? BEHIND_BUTTON : NO_IMAGE_CLIPBOARD;
  return buildMessage({
    pinId: pinId ?? (pins.length === 1 ? first.id : newPinId()),
    source: "clipboard",
    pageUrl,
    pins: pins.map(({ comment, context }) => ({ comment, context })),
    detail: level,
    screenshots: screenshotReferences(pins, where),
  });
}

/** Copy pins from a user gesture, with the screenshot as an image where that works. */
export async function copyPins(
  request: Omit<CopyRequest, "imageAttached" | "imagesSupported">,
  scratch: ParentNode,
): Promise<CopyResult> {
  const shots = includesScreenshots(request.level)
    ? request.pins.flatMap((pin) => (pin.screenshot === undefined ? [] : [pin.screenshot]))
    : [];
  const imagesSupported = canCopyImages();
  const [only] = shots;
  if (only !== undefined && shots.length === 1 && imagesSupported) {
    const text = buildCopyText({ ...request, imageAttached: true });
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "image/png": await pngBlob(only),
        }),
      ]);
      return { imageAttached: true, screenshots: 1 };
    } catch {
      // The clipboard refused the image: copy the text alone, saying how to get it.
    }
  }
  await writeClipboard(buildCopyText({ ...request, imagesSupported }), scratch);
  return { imageAttached: false, screenshots: shots.length };
}

/** Put one pin's screenshot on the clipboard as an image. */
export async function copyScreenshot(screenshot: Screenshot): Promise<void> {
  if (!canCopyImages()) {
    throw new Error("This page cannot put images on the clipboard. Send the pin to include it.");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": await pngBlob(screenshot) })]);
}

/** The async clipboard with images: secure pages only (https, or http on localhost). */
export function canCopyImages(): boolean {
  return (
    window.isSecureContext &&
    // Missing outright on pages that are not secure contexts, whatever the types say.
    "clipboard" in navigator &&
    typeof navigator.clipboard.write === "function" &&
    typeof ClipboardItem === "function"
  );
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

function screenshotReferences(pins: readonly StoredPin[], where: string): ScreenshotReference[] {
  return pins.flatMap(({ screenshot }, index) =>
    screenshot === undefined
      ? []
      : [
          {
            pin: index + 1,
            type: screenshot.type,
            width: screenshot.width,
            height: screenshot.height,
            where,
          },
        ],
  );
}

/** The clipboard takes PNG only, so a JPEG screenshot is redrawn as PNG. */
async function pngBlob(screenshot: Screenshot): Promise<Blob> {
  const blob = new Blob([base64ToBuffer(screenshot.data)], { type: screenshot.type });
  if (screenshot.type === "image/png") return blob;
  const image = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    image.close();
  }
}
