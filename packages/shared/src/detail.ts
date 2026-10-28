/**
 * Copy detail levels. Each level keeps a subset of the captured page context;
 * forensic keeps everything, and is the only level that includes region screenshots.
 */

import type { ElementContext, PageContext } from "./schemas.js";

export const DETAIL_LEVELS = ["compact", "standard", "detailed", "forensic"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/** Attributes that identify an element; standard and detailed keep only these. */
export const KEY_ATTRIBUTES: readonly string[] = [
  "id",
  "class",
  "name",
  "role",
  "type",
  "href",
  "src",
  "alt",
  "title",
  "placeholder",
  "for",
  "aria-label",
  "aria-labelledby",
  "data-testid",
  "data-test",
  "data-cy",
];

/** Whether a level includes region screenshots. */
export function includesScreenshots(level: DetailLevel): boolean {
  return level === "forensic";
}

/** Whether a level includes the page URL in the message header. */
export function includesPageUrl(level: DetailLevel): boolean {
  return level !== "compact";
}

/** The part of a pin's context that a detail level keeps. */
export function contextForLevel(context: PageContext, level: DetailLevel): PageContext {
  if (level === "forensic") return context;
  const { kind, selectedText, area, elements, viewport, ...element } = context;
  const extra = elements?.map((item) => elementForLevel(item, level));
  return dropUndefined({
    ...elementForLevel(element, level),
    kind: level === "detailed" ? kind : undefined,
    selectedText: level === "compact" ? undefined : selectedText,
    area: level === "detailed" ? area : undefined,
    elements: extra,
    viewport: level === "detailed" ? viewport : undefined,
  });
}

function elementForLevel(element: ElementContext, level: DetailLevel): ElementContext {
  const { selector, text, attributes, styles, structure, rect, source } = element;
  if (level === "compact") return dropUndefined({ selector });
  const standard = { selector, text, attributes: keyAttributes(attributes) };
  if (level === "standard") return dropUndefined(standard);
  return dropUndefined({ ...standard, styles, structure, rect, source });
}

function keyAttributes(
  attributes: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (attributes === undefined) return undefined;
  const kept = Object.entries(attributes).filter(([name]) => KEY_ATTRIBUTES.includes(name));
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}

/** Copy without undefined fields, so optional properties stay absent rather than undefined. */
function dropUndefined<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}
