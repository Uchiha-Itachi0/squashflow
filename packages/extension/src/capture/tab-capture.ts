/**
 * Region screenshots in the service worker. The visible tab is captured with the activeTab
 * grant the user gave by turning pin mode on (no extra permission), cropped to the pin's
 * region and encoded under the size cap. The full capture never leaves the service worker;
 * only the crop goes back to the pin mode script.
 */

import type { ScreenshotType } from "@squashflow/shared";
import {
  cropBox,
  encodeWithinCap,
  base64ToBuffer,
  type ScreenshotReply,
  type ScreenshotRequest,
  type Size,
} from "./screenshot";

const DATA_URL_PREFIX = "data:image/png;base64,";

/** Capture the region of the tab the request came from, if that tab is the one showing. */
export async function captureRegion(
  tab: chrome.tabs.Tab | undefined,
  request: ScreenshotRequest,
): Promise<ScreenshotReply> {
  if (tab?.id === undefined || !tab.active) {
    return { ok: false, message: "The tab is not showing, so there is nothing to capture." };
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    if (!dataUrl.startsWith(DATA_URL_PREFIX)) throw new Error("unexpected capture format");
    const bytes = base64ToBuffer(dataUrl.slice(DATA_URL_PREFIX.length));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    try {
      return await cropAndEncode(image, request);
    } finally {
      image.close();
    }
  } catch {
    // No activeTab grant any more (the page navigated), or the capture rate limit.
    return { ok: false, message: "Chrome did not allow a screenshot of this tab." };
  }
}

async function cropAndEncode(
  image: ImageBitmap,
  request: ScreenshotRequest,
): Promise<ScreenshotReply> {
  const crop = cropBox(request.region, request.viewport, image);
  if (crop === null) return { ok: false, message: "The pinned region is not on screen." };
  const encode = async (size: Size, type: ScreenshotType, quality?: number) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      size.width,
      size.height,
    );
    const blob = await canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
    return new Uint8Array(await blob.arrayBuffer());
  };
  const screenshot = await encodeWithinCap(crop, encode);
  return screenshot === null
    ? { ok: false, message: "The screenshot was too large to keep." }
    : { ok: true, value: screenshot };
}
