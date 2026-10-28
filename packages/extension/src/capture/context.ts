/**
 * Page context capture for a pin, at the Detailed level: selector, trimmed text,
 * attributes, computed styles, surrounding structure, position and viewport.
 *
 * Never captured: the value of any form field (typed or default), anything inside
 * password or hidden inputs, inline event handlers and nonces. Every field is capped.
 */

import type { ElementContext, PageContext, Rect, Viewport } from "@squashflow/shared";
import { MAX_EXTRA_ELEMENTS } from "@squashflow/shared";
import { HOST_TAG } from "../constants";
import {
  CAPTURED_STYLES,
  DEFAULT_STYLE_VALUES,
  MAX_ATTRIBUTES,
  MAX_ATTRIBUTE_VALUE_CHARS,
  MAX_SELECTED_TEXT_CHARS,
  MAX_STRUCTURE_ANCESTORS,
  MAX_STRUCTURE_CHARS,
  MAX_STRUCTURE_CHILDREN,
  MAX_STRUCTURE_SIBLINGS,
  MAX_TEXT_CHARS,
} from "./limits";
import { buildSelector, stableClasses } from "./selector";

/** Elements whose content is a value the user typed or the page keeps private. */
const FORM_FIELDS = new Set(["input", "textarea", "select", "option", "datalist"]);
/** Elements whose text is never page copy. */
const SKIPPED_TEXT = new Set(["script", "style", "noscript", "template", "svg", HOST_TAG]);
const DROPPED_ATTRIBUTES = new Set(["value", "nonce", "integrity", "srcdoc"]);

export type PinTarget =
  | { kind: "element"; element: Element }
  | { kind: "elements"; elements: readonly Element[] }
  | { kind: "text"; range: Range }
  | { kind: "area"; area: Rect; elements: readonly Element[]; container: Element };

export function capturePin(target: PinTarget): PageContext {
  const view = viewportOf(document);
  switch (target.kind) {
    case "element":
      return { kind: "element", ...captureElement(target.element), viewport: view };
    case "elements": {
      const [first, ...rest] = target.elements;
      if (first === undefined) throw new Error("A multi-element pin needs at least one element.");
      return {
        kind: "elements",
        ...captureElement(first),
        elements: rest.slice(0, MAX_EXTRA_ELEMENTS).map(captureElement),
        viewport: view,
      };
    }
    case "text": {
      const holder = elementOf(target.range.commonAncestorContainer);
      return {
        kind: "text",
        ...captureElement(holder),
        selectedText: rangeText(target.range),
        viewport: view,
      };
    }
    case "area":
      return {
        kind: "area",
        ...captureElement(target.container),
        area: roundRect(target.area),
        elements: target.elements.slice(0, MAX_EXTRA_ELEMENTS).map(captureElement),
        viewport: view,
      };
  }
}

export function captureElement(element: Element): ElementContext {
  const text = isFormField(element) ? "" : visibleText(element, MAX_TEXT_CHARS);
  const attributes = captureAttributes(element);
  const styles = captureStyles(element);
  return {
    selector: buildSelector(element),
    ...(text === "" ? {} : { text }),
    ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
    ...(Object.keys(styles).length === 0 ? {} : { styles }),
    structure: describeStructure(element),
    rect: pageRect(element),
  };
}

export function captureAttributes(element: Element): Record<string, string> {
  const kept = Array.from(element.attributes)
    .filter(({ name }) => !DROPPED_ATTRIBUTES.has(name) && !name.startsWith("on"))
    .slice(0, MAX_ATTRIBUTES)
    .map(({ name, value }) => [name, truncate(value, MAX_ATTRIBUTE_VALUE_CHARS)] as const);
  return Object.fromEntries(kept);
}

function captureStyles(element: Element): Record<string, string> {
  const view = element.ownerDocument.defaultView;
  if (view === null) return {};
  const computed = view.getComputedStyle(element);
  const kept = CAPTURED_STYLES.map(
    (name) => [name, computed.getPropertyValue(name).trim()] as const,
  )
    .filter(([, value]) => !DEFAULT_STYLE_VALUES.has(value))
    .map(([name, value]) => [name, truncate(value, MAX_ATTRIBUTE_VALUE_CHARS)] as const);
  return Object.fromEntries(kept);
}

/** Text the user can read in the element, without form values or script and style text. */
export function visibleText(element: Element, limit: number): string {
  const parts: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let length = 0;
  for (let node = walker.nextNode(); node !== null && length <= limit; node = walker.nextNode()) {
    if (isPrivateText(node, element)) continue;
    const value = node.nodeValue ?? "";
    parts.push(value);
    length += value.length;
  }
  return truncate(normaliseSpace(parts.join(" ")), limit);
}

/** The selected text, skipping anything inside form fields. */
export function rangeText(range: Range): string {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) {
    if (isPrivateText(root, null)) return "";
    const value = (root.nodeValue ?? "").slice(range.startOffset, range.endOffset);
    return truncate(normaliseSpace(value), MAX_SELECTED_TEXT_CHARS);
  }
  const parts: string[] = [];
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!range.intersectsNode(node) || isPrivateText(node, null)) continue;
    const value = node.nodeValue ?? "";
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : value.length;
    parts.push(value.slice(start, end));
  }
  return truncate(normaliseSpace(parts.join(" ")), MAX_SELECTED_TEXT_CHARS);
}

/** An indented outline of ancestors, siblings and children, with no page text. */
export function describeStructure(element: Element): string {
  const ancestors: Element[] = [];
  for (
    let parent = element.parentElement;
    parent !== null && ancestors.length < MAX_STRUCTURE_ANCESTORS;
    parent = parent.parentElement
  ) {
    ancestors.unshift(parent);
  }
  const lines = ancestors.map((ancestor, depth) => `${indent(depth)}${describe(ancestor)}`);
  const depth = ancestors.length;
  const siblings = element.parentElement
    ? Array.from(element.parentElement.children).filter((child) => child.localName !== HOST_TAG)
    : [element];
  const index = siblings.indexOf(element);
  const before = siblings.slice(Math.max(0, index - MAX_STRUCTURE_SIBLINGS), index);
  const after = siblings.slice(index + 1, index + 1 + MAX_STRUCTURE_SIBLINGS);
  if (index > before.length) lines.push(`${indent(depth)}…`);
  lines.push(...before.map((sibling) => `${indent(depth)}${describe(sibling)}`));
  lines.push(`${indent(depth)}${describe(element)}  <- pinned`);
  const children = Array.from(element.children);
  lines.push(
    ...children
      .slice(0, MAX_STRUCTURE_CHILDREN)
      .map((child) => `${indent(depth + 1)}${describe(child)}`),
  );
  if (children.length > MAX_STRUCTURE_CHILDREN) lines.push(`${indent(depth + 1)}…`);
  lines.push(...after.map((sibling) => `${indent(depth)}${describe(sibling)}`));
  if (index + 1 + MAX_STRUCTURE_SIBLINGS < siblings.length) lines.push(`${indent(depth)}…`);
  return truncate(lines.join("\n"), MAX_STRUCTURE_CHARS);
}

function describe(element: Element): string {
  const id = element.id === "" ? "" : `#${element.id}`;
  const classes = stableClasses(element)
    .slice(0, 3)
    .map((name) => `.${name}`)
    .join("");
  const role = element.getAttribute("role");
  return truncate(`${element.localName}${id}${classes}${role ? `[role=${role}]` : ""}`, 120);
}

export function viewportOf(document: Document): Viewport {
  const view = document.defaultView;
  return {
    width: view?.innerWidth ?? 0,
    height: view?.innerHeight ?? 0,
    scrollX: Math.round(view?.scrollX ?? 0),
    scrollY: Math.round(view?.scrollY ?? 0),
    devicePixelRatio: view?.devicePixelRatio || 1,
  };
}

/** The element's box in page coordinates. */
export function pageRect(element: Element): Rect {
  const box = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  return roundRect({
    x: box.left + (view?.scrollX ?? 0),
    y: box.top + (view?.scrollY ?? 0),
    width: box.width,
    height: box.height,
  });
}

function roundRect({ x, y, width, height }: Rect): Rect {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function isPrivateText(node: Node, within: Element | null): boolean {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    if (isFormField(parent) || SKIPPED_TEXT.has(parent.localName)) return true;
    if (parent === within) return false;
  }
  return false;
}

function isFormField(element: Element): boolean {
  return FORM_FIELDS.has(element.localName);
}

function elementOf(node: Node): Element {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (element === null) throw new Error("The selection is not inside an element.");
  return element;
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function normaliseSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
