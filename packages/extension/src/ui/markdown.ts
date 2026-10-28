/**
 * Claude's reply as a small, safe subset of markdown: paragraphs, headings shown bold,
 * bullet and numbered lists, fenced code blocks, and inline bold, italics, code and links.
 *
 * The reply is untrusted text, so this builds DOM nodes with `h` and text nodes only; no
 * reply text is ever parsed as HTML. Links open only when they are `https:`, and show the
 * address itself, so a label cannot disguise where a link goes. Anything else stays text.
 */

import { h } from "./dom";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^ {0,3}(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;

/**
 * Inline spans, tried left to right: code, bold, italics, a markdown link, a bare https
 * address. Underscore emphasis needs a non-word edge, so snake_case names stay as they are.
 */
const INLINE =
  /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s](?:[^*]*?[^*\s])?)\*|(?<![\w])_([^_\s](?:[^_]*?[^_\s])?)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)|(https:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_])/g;

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "code"; text: string };

/** The reply as block elements, ready to append to the reply container. */
export function renderMarkdown(text: string): HTMLElement[] {
  return parseBlocks(text).map(renderBlock);
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const fence = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      const body: string[] = [];
      for (index++; index < lines.length; index++) {
        const inner = lines[index] ?? "";
        const closer = FENCE.exec(inner)?.[1];
        if (closer !== undefined && closer[0] === fence[0] && closer.length >= fence.length) break;
        body.push(inner);
      }
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (line.trim() === "") continue;
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1] ?? "" });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    const last = blocks.at(-1);
    if (item) {
      const ordered = item[2] !== undefined;
      const content = item[3] ?? "";
      if (last?.kind === "list" && last.ordered === ordered) {
        blocks[blocks.length - 1] = { ...last, items: [...last.items, content] };
      } else {
        blocks.push({ kind: "list", ordered, start: Number(item[2] ?? 1), items: [content] });
      }
      continue;
    }
    const previous = lines[index - 1] ?? "";
    if (last?.kind === "paragraph" && previous.trim() !== "" && !FENCE.test(previous)) {
      blocks[blocks.length - 1] = { ...last, lines: [...last.lines, line.trim()] };
    } else {
      blocks.push({ kind: "paragraph", lines: [line.trim()] });
    }
  }
  return blocks;
}

function renderBlock(block: Block): HTMLElement {
  switch (block.kind) {
    case "code":
      return h("pre", {}, [h("code", { text: block.text })]);
    case "heading":
      return h("p", {}, [h("strong", {}, renderInline(block.text))]);
    case "list": {
      const items = block.items.map((item) => h("li", {}, renderInline(item)));
      if (!block.ordered) return h("ul", {}, items);
      return h("ol", { attrs: block.start === 1 ? {} : { start: String(block.start) } }, items);
    }
    case "paragraph":
      return h(
        "p",
        {},
        block.lines.flatMap((line, index) => [
          ...(index === 0 ? [] : [h("br")]),
          ...renderInline(line),
        ]),
      );
  }
}

/** Inline markdown as nodes: text nodes for everything that is not a recognised span. */
export function renderInline(text: string): Node[] {
  const nodes: Node[] = [];
  let at = 0;
  const pattern = new RegExp(INLINE.source, "g");
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const { index } = match;
    if (index > at) nodes.push(document.createTextNode(text.slice(at, index)));
    nodes.push(...renderSpan(match));
    at = index + match[0].length;
  }
  if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));
  return nodes;
}

function renderSpan(match: RegExpExecArray): Node[] {
  const [whole, , code, bold, boldUnderscore, star, underscore, label, target, bare] = match;
  if (code !== undefined) return [h("code", { text: code })];
  if (bold !== undefined || boldUnderscore !== undefined) {
    return [h("strong", {}, renderInline(bold ?? boldUnderscore ?? ""))];
  }
  if (star !== undefined || underscore !== undefined) {
    return [h("em", {}, renderInline(star ?? underscore ?? ""))];
  }
  if (label !== undefined && target !== undefined) {
    const link = httpsLink(target);
    if (link === null) return [document.createTextNode(whole)];
    return link.textContent === label
      ? [link]
      : [...renderInline(label), document.createTextNode(" "), link];
  }
  if (bare !== undefined) return [httpsLink(bare) ?? document.createTextNode(bare)];
  return [document.createTextNode(whole)];
}

/** A link that shows its own address, or null when the address is not plain https. */
function httpsLink(raw: string): HTMLAnchorElement | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
  return h("a", {
    text: url.href,
    attrs: { href: url.href, target: "_blank", rel: "noopener noreferrer" },
  });
}
