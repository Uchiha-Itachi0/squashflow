import { describe, expect, it } from "vitest";
import {
  buildMessage,
  CONTEXT_CLOSE,
  CONTEXT_OPEN,
  contextForLevel,
  includesPageUrl,
  pageContextSchema,
  type PageContext,
} from "../src/index.js";

const context: PageContext = {
  kind: "area",
  selector: "#hero",
  text: "Welcome",
  attributes: { id: "hero", "data-track": "x", "aria-label": "Hero" },
  styles: { display: "flex" },
  structure: "body\n  section#hero  <- pinned",
  rect: { x: 0, y: 0, width: 10, height: 10 },
  area: { x: 1, y: 2, width: 3, height: 4 },
  elements: [{ selector: "#title", text: "Hi", attributes: { class: "big", style: "x" } }],
  viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
};

describe("contextForLevel", () => {
  it("compact keeps selectors only", () => {
    expect(contextForLevel(context, "compact")).toEqual({
      selector: "#hero",
      elements: [{ selector: "#title" }],
    });
  });

  it("standard adds text and key attributes", () => {
    expect(contextForLevel(context, "standard")).toEqual({
      selector: "#hero",
      text: "Welcome",
      attributes: { id: "hero", "aria-label": "Hero" },
      elements: [{ selector: "#title", text: "Hi", attributes: { class: "big" } }],
    });
  });

  it("detailed adds styles, structure, positions and viewport, still only key attributes", () => {
    const detailed = contextForLevel(context, "detailed");
    expect(detailed).toMatchObject({
      kind: "area",
      styles: { display: "flex" },
      area: context.area,
    });
    expect(detailed.attributes).toEqual({ id: "hero", "aria-label": "Hero" });
    expect(detailed.viewport).toEqual(context.viewport);
  });

  it("forensic keeps everything", () => {
    expect(contextForLevel(context, "forensic")).toBe(context);
  });

  it("every level stays a valid page context", () => {
    for (const level of ["compact", "standard", "detailed", "forensic"] as const) {
      expect(pageContextSchema.safeParse(contextForLevel(context, level)).success).toBe(true);
    }
    expect(includesPageUrl("compact")).toBe(false);
    expect(includesPageUrl("standard")).toBe(true);
  });
});

describe("buildMessage", () => {
  it("uses the context exactly as given when no level is set, as delivery does", () => {
    const message = buildMessage({
      pinId: "sf-0123456789ab",
      source: "browser",
      pageUrl: "https://example.com/",
      pins: [{ comment: "Fix", context }],
    });
    const json = message.slice(
      message.indexOf(CONTEXT_OPEN) + CONTEXT_OPEN.length,
      message.indexOf(CONTEXT_CLOSE),
    );
    expect(JSON.parse(json)).toEqual({ pin: 1, ...context });
  });

  it("states clipboard provenance and omits the page URL at the compact level", () => {
    const message = buildMessage({
      pinId: "sf-0123456789ab",
      source: "clipboard",
      pageUrl: "https://example.com/",
      pins: [{ comment: "Fix", context }],
      detail: "compact",
    });
    expect(message).toMatch(/^Squashflow pin \[sf-0123456789ab\] copied from the user's browser/);
    expect(message).not.toContain("example.com");
  });
});
