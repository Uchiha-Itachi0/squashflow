/** Size caps for captured page context. Documented in docs/architecture.md. */

export const MAX_TEXT_CHARS = 300;
export const MAX_SELECTED_TEXT_CHARS = 1000;
export const MAX_ATTRIBUTES = 20;
export const MAX_ATTRIBUTE_VALUE_CHARS = 200;
export const MAX_STRUCTURE_CHARS = 1500;
export const MAX_STRUCTURE_ANCESTORS = 3;
export const MAX_STRUCTURE_SIBLINGS = 3;
export const MAX_STRUCTURE_CHILDREN = 6;

/** Computed style properties captured for the Detailed level. */
export const CAPTURED_STYLES: readonly string[] = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "z-index",
  "gap",
  "flex-direction",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "overflow",
  "visibility",
];

/** Computed values that say nothing beyond the browser default. */
export const DEFAULT_STYLE_VALUES: ReadonlySet<string> = new Set([
  "",
  "none",
  "normal",
  "auto",
  "0px",
  "static",
  "visible",
  "rgba(0, 0, 0, 0)",
]);
