import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_SIDE, screenshotSchema } from "@squashflow/shared";
import { describe, expect, it } from "vitest";
import {
  cropBox,
  encodeWithinCap,
  fitWithin,
  fromBase64,
  pinRegion,
  SCREENSHOT_MARGIN_PX,
  toBase64,
  visibleRegion,
  type Encoder,
} from "../src/capture/screenshot";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_START = [0xff, 0xd8, 0xff, 0xe0];

/** A fake encoder: bytes start like the real format, and their size follows a formula. */
function fakeEncoder(bytesFor: (pixels: number, png: boolean, quality?: number) => number) {
  const calls: string[] = [];
  const encode: Encoder = (size, type, quality) => {
    calls.push(`${type}@${quality ?? "-"} ${size.width}x${size.height}`);
    const png = type === "image/png";
    const bytes = new Uint8Array(bytesFor(size.width * size.height, png, quality));
    bytes.set(png ? PNG_SIGNATURE : JPEG_START);
    return Promise.resolve(bytes);
  };
  return { encode, calls };
}

describe("pinRegion", () => {
  it("uses the dragged area when there is one", () => {
    expect(
      pinRegion({
        area: { x: 1, y: 2, width: 3, height: 4 },
        rect: { x: 0, y: 0, width: 99, height: 99 },
      }),
    ).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("covers every pinned element", () => {
    expect(
      pinRegion({
        rect: { x: 10, y: 10, width: 10, height: 10 },
        elements: [
          { rect: { x: 50, y: 0, width: 10, height: 5 } },
          { rect: { x: 0, y: 0, width: 0, height: 0 } },
        ],
      }),
    ).toEqual({ x: 10, y: 0, width: 50, height: 20 });
  });

  it("is null without a usable box", () => {
    expect(pinRegion({ selector: "#x" })).toBeNull();
  });
});

describe("visibleRegion", () => {
  const viewport = { width: 800, height: 600 };

  it("moves the region into viewport coordinates with a margin", () => {
    expect(
      visibleRegion({ x: 100, y: 1100, width: 50, height: 20 }, { x: 0, y: 1000 }, viewport),
    ).toEqual({
      x: 100 - SCREENSHOT_MARGIN_PX,
      y: 100 - SCREENSHOT_MARGIN_PX,
      width: 50 + 2 * SCREENSHOT_MARGIN_PX,
      height: 20 + 2 * SCREENSHOT_MARGIN_PX,
    });
  });

  it("clips to what is on screen", () => {
    expect(
      visibleRegion({ x: -50, y: 500, width: 100, height: 300 }, { x: 0, y: 0 }, viewport),
    ).toEqual({
      x: 0,
      y: 500 - SCREENSHOT_MARGIN_PX,
      width: 50 + SCREENSHOT_MARGIN_PX,
      height: 100 + SCREENSHOT_MARGIN_PX,
    });
  });

  it("is null for a region scrolled out of view", () => {
    expect(
      visibleRegion({ x: 0, y: 2000, width: 100, height: 100 }, { x: 0, y: 0 }, viewport),
    ).toBeNull();
  });
});

describe("cropBox", () => {
  it("scales viewport pixels to image pixels from the image's own size", () => {
    expect(
      cropBox(
        { x: 10.5, y: 20, width: 100, height: 50 },
        { width: 800, height: 600 },
        { width: 1600, height: 1200 },
      ),
    ).toEqual({ x: 21, y: 40, width: 200, height: 100 });
  });

  it("stays inside the image", () => {
    expect(
      cropBox(
        { x: 790, y: 590, width: 50, height: 50 },
        { width: 800, height: 600 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 790, y: 590, width: 10, height: 10 });
    expect(
      cropBox(
        { x: 900, y: 0, width: 50, height: 50 },
        { width: 800, height: 600 },
        { width: 800, height: 600 },
      ),
    ).toBeNull();
  });
});

describe("fitWithin", () => {
  it("scales the longest side down to the cap, keeping the aspect ratio", () => {
    expect(fitWithin({ width: 3200, height: 800 })).toEqual({
      width: MAX_SCREENSHOT_SIDE,
      height: 400,
    });
  });

  it("never scales up", () => {
    expect(fitWithin({ width: 300, height: 200 })).toEqual({ width: 300, height: 200 });
  });
});

describe("encodeWithinCap", () => {
  it("keeps a PNG that fits", async () => {
    const { encode, calls } = fakeEncoder(() => 1000);
    const shot = await encodeWithinCap({ width: 300, height: 200 }, encode);
    expect(shot).toMatchObject({ type: "image/png", width: 300, height: 200 });
    expect(calls).toEqual(["image/png@- 300x200"]);
    expect(screenshotSchema.safeParse(shot).success).toBe(true);
  });

  it("falls back to JPEG, then to smaller sizes, until it fits the byte cap", async () => {
    const { encode, calls } = fakeEncoder((pixels, png) => (png ? pixels * 4 : pixels));
    const shot = await encodeWithinCap({ width: 1000, height: 1000 }, encode);
    expect(shot?.type).toBe("image/jpeg");
    expect(fromBase64(shot?.data ?? "").length).toBeLessThanOrEqual(MAX_SCREENSHOT_BYTES);
    expect(calls.slice(0, 4)).toEqual([
      "image/png@- 1000x1000",
      "image/jpeg@0.85 1000x1000",
      "image/jpeg@0.7 1000x1000",
      "image/png@- 700x700",
    ]);
    expect(shot).toMatchObject({ width: 343, height: 343 });
    expect(screenshotSchema.safeParse(shot).success).toBe(true);
  });

  it("gives up rather than keep an image over the cap", async () => {
    const { encode } = fakeEncoder(() => MAX_SCREENSHOT_BYTES + 1);
    expect(await encodeWithinCap({ width: 1000, height: 1000 }, encode)).toBeNull();
  });
});

describe("base64", () => {
  it("round-trips bytes, including large buffers", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
