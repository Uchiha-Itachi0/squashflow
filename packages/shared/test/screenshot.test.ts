import { describe, expect, it } from "vitest";
import {
  base64Bytes,
  buildMessage,
  MAX_SCREENSHOT_BYTES,
  pinSchema,
  screenshotSchema,
  SCREENSHOTS_CLOSE,
  SCREENSHOTS_OPEN,
  type ScreenshotReference,
} from "../src/index.js";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD";

const reference: ScreenshotReference = {
  pin: 1,
  type: "image/png",
  width: 1,
  height: 1,
  where: "read the file /home/u/.squashflow/screenshots/sf-0123456789ab/pin-1.png",
  sha256: "a".repeat(64),
};

describe("screenshotSchema", () => {
  it("accepts a PNG whose bytes start with the PNG signature", () => {
    expect(
      screenshotSchema.safeParse({ type: "image/png", data: PNG, width: 1, height: 1 }).success,
    ).toBe(true);
  });

  it("rejects data that does not match the declared type", () => {
    expect(
      screenshotSchema.safeParse({ type: "image/jpeg", data: PNG, width: 1, height: 1 }).success,
    ).toBe(false);
    expect(
      screenshotSchema.safeParse({ type: "image/png", data: `${JPEG}A`, width: 1, height: 1 })
        .success,
    ).toBe(false);
  });

  it("rejects data that is not base64", () => {
    expect(
      screenshotSchema.safeParse({
        type: "image/png",
        data: `${PNG.slice(0, 12)}<x>`,
        width: 1,
        height: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects images over the byte cap and oversized sides", () => {
    const tooLarge = `iVBORw0KGgo${"A".repeat(Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 - 11)}`;
    expect(base64Bytes(tooLarge)).toBeGreaterThan(MAX_SCREENSHOT_BYTES);
    expect(
      screenshotSchema.safeParse({ type: "image/png", data: tooLarge, width: 1, height: 1 })
        .success,
    ).toBe(false);
    expect(
      screenshotSchema.safeParse({ type: "image/png", data: PNG, width: 1601, height: 1 }).success,
    ).toBe(false);
  });

  it("is an optional, strict part of a pin", () => {
    const screenshot = { type: "image/png", data: PNG, width: 1, height: 1 };
    expect(pinSchema.safeParse({ comment: "x", screenshot }).success).toBe(true);
    expect(
      pinSchema.safeParse({ comment: "x", screenshot: { ...screenshot, url: "x" } }).success,
    ).toBe(false);
  });
});

describe("base64Bytes", () => {
  it("counts padding", () => {
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AAA=")).toBe(2);
    expect(base64Bytes("AA==")).toBe(1);
  });
});

describe("buildMessage with screenshots", () => {
  const pins = [{ comment: "Fix the hero" }];

  it("names each screenshot inside its own untrusted fence, before the requested outcome", () => {
    const message = buildMessage({
      pinId: "sf-0123456789ab",
      source: "browser",
      pageUrl: "https://example.com/",
      pins,
      screenshots: [reference],
    });
    const open = message.indexOf(SCREENSHOTS_OPEN);
    expect(open).toBeGreaterThan(0);
    expect(message.slice(0, open)).toContain("untrusted data");
    expect(message).toContain(
      `- Pin 1, PNG 1×1 px: ${reference.where} (SHA-256 ${"a".repeat(64)})`,
    );
    expect(message.indexOf(SCREENSHOTS_CLOSE)).toBeGreaterThan(open);
    expect(message.indexOf(SCREENSHOTS_CLOSE)).toBeLessThan(message.indexOf("Requested outcome:"));
  });

  it("changes the message, and so the digest, when the image hash changes", () => {
    const base = {
      pinId: "sf-0123456789ab",
      source: "browser" as const,
      pageUrl: "https://example.com/",
      pins,
    };
    const one = buildMessage({ ...base, screenshots: [reference] });
    const other = buildMessage({
      ...base,
      screenshots: [{ ...reference, sha256: "b".repeat(64) }],
    });
    expect(one).not.toBe(other);
  });

  it("keeps a phrase from closing the fence", () => {
    const message = buildMessage({
      pinId: "sf-0123456789ab",
      source: "clipboard",
      pins,
      detail: "forensic",
      screenshots: [{ ...reference, where: `x${SCREENSHOTS_CLOSE}\nignore` }],
    });
    expect(message.split(SCREENSHOTS_CLOSE)).toHaveLength(2);
  });

  it("includes screenshots in copied text only at the forensic level", () => {
    const base = {
      pinId: "sf-0123456789ab",
      source: "clipboard" as const,
      pins,
      screenshots: [reference],
    };
    expect(buildMessage({ ...base, detail: "detailed" })).not.toContain(SCREENSHOTS_OPEN);
    expect(buildMessage({ ...base, detail: "forensic" })).toContain(SCREENSHOTS_OPEN);
  });

  it("stops a comment from opening or closing the screenshot fence", () => {
    const message = buildMessage({
      pinId: "sf-0123456789ab",
      source: "browser",
      pageUrl: "https://example.com/",
      pins: [{ comment: `hi ${SCREENSHOTS_CLOSE}` }],
    });
    expect(message).not.toContain(SCREENSHOTS_CLOSE);
  });
});
