/**
 * Region screenshots: which part of the visible tab to keep for a pin, how it maps onto
 * the captured image, and how it is encoded under the size cap. Pure functions; the
 * service worker does the capture (`tab-capture.ts`) and the pin mode script decides the
 * region and hides its own UI while the tab is captured.
 */

import {
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_SIDE,
  rectSchema,
  type PageContext,
  type Rect,
  type Screenshot,
  type ScreenshotType,
} from "@squashflow/shared";
// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";

/** Space kept around the pinned element or area, in CSS pixels. */
export const SCREENSHOT_MARGIN_PX = 8;
/** A visible region smaller than this on either side is not worth a screenshot. */
export const MIN_SCREENSHOT_PX = 4;
/** Smallest side an image is scaled down to while trying to fit the byte cap. */
const MIN_ENCODED_SIDE = 64;
const SCALE_STEP = 0.7;
const JPEG_QUALITIES = [0.85, 0.7] as const;

/** Ask the service worker to capture a region of the visible tab, in viewport pixels. */
export const screenshotRequestSchema = z.strictObject({
  type: z.literal("screenshot"),
  region: rectSchema,
  viewport: z.strictObject({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
});

export type ScreenshotRequest = z.infer<typeof screenshotRequestSchema>;

export type ScreenshotReply = { ok: true; value: Screenshot } | { ok: false; message: string };

export interface Size {
  width: number;
  height: number;
}

/** The pinned part of the page, in page coordinates: the dragged area or the elements. */
export function pinRegion(context: PageContext): Rect | null {
  if (context.area) return context.area;
  const rects = [context.rect, ...(context.elements ?? []).map((element) => element.rect)].filter(
    (rect): rect is Rect => rect !== undefined && rect.width > 0 && rect.height > 0,
  );
  const [first, ...rest] = rects;
  if (first === undefined) return null;
  return rest.reduce(union, first);
}

/**
 * The visible part of a page region with a margin, in viewport coordinates, or null when
 * too little of it is on screen.
 */
export function visibleRegion(
  region: Rect,
  scroll: { x: number; y: number },
  viewport: Size,
): Rect | null {
  const left = Math.max(0, region.x - scroll.x - SCREENSHOT_MARGIN_PX);
  const top = Math.max(0, region.y - scroll.y - SCREENSHOT_MARGIN_PX);
  const right = Math.min(viewport.width, region.x - scroll.x + region.width + SCREENSHOT_MARGIN_PX);
  const bottom = Math.min(
    viewport.height,
    region.y - scroll.y + region.height + SCREENSHOT_MARGIN_PX,
  );
  if (right - left < MIN_SCREENSHOT_PX || bottom - top < MIN_SCREENSHOT_PX) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The viewport region as whole pixels of the captured image. The image's own size gives the
 * scale, which covers the device pixel ratio and page zoom alike.
 */
export function cropBox(region: Rect, viewport: Size, image: Size): Rect | null {
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const x = clamp(Math.floor(region.x * scaleX), 0, image.width);
  const y = clamp(Math.floor(region.y * scaleY), 0, image.height);
  const right = clamp(Math.ceil((region.x + region.width) * scaleX), 0, image.width);
  const bottom = clamp(Math.ceil((region.y + region.height) * scaleY), 0, image.height);
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** The size a crop is drawn at: scaled down, never up, so its longest side fits. */
export function fitWithin(size: Size, maxSide: number = MAX_SCREENSHOT_SIDE): Size {
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** Draw the crop at a size and encode it; returns the encoded bytes. */
export type Encoder = (size: Size, type: ScreenshotType, quality?: number) => Promise<Uint8Array>;

/**
 * Encode a crop under the byte cap: PNG first (sharp text and edges), then JPEG at falling
 * quality, then the same at smaller sizes. Null when even the smallest size does not fit.
 */
export async function encodeWithinCap(
  crop: Size,
  encode: Encoder,
  maxBytes: number = MAX_SCREENSHOT_BYTES,
): Promise<Screenshot | null> {
  let size = fitWithin(crop);
  for (;;) {
    const attempts: [ScreenshotType, number | undefined][] = [
      ["image/png", undefined],
      ...JPEG_QUALITIES.map((quality): [ScreenshotType, number] => ["image/jpeg", quality]),
    ];
    for (const [type, quality] of attempts) {
      const bytes = await encode(size, type, quality);
      if (bytes.length <= maxBytes) return { type, data: toBase64(bytes), ...size };
    }
    if (Math.max(size.width, size.height) * SCALE_STEP < MIN_ENCODED_SIDE) return null;
    size = {
      width: Math.max(1, Math.round(size.width * SCALE_STEP)),
      height: Math.max(1, Math.round(size.height * SCALE_STEP)),
    };
  }
}

export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
