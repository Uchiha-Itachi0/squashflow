import { pageContextSchema } from "@squashflow/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureAttributes,
  captureElement,
  capturePin,
  describeStructure,
  rangeText,
} from "../src/capture/context";
import {
  MAX_ATTRIBUTES,
  MAX_ATTRIBUTE_VALUE_CHARS,
  MAX_STRUCTURE_CHARS,
  MAX_TEXT_CHARS,
} from "../src/capture/limits";

const SECRET = "hunter2-secret";

function only<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  const element = document.querySelector(tag);
  if (element === null) throw new Error(`no ${tag}`);
  return element;
}

describe("captureElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("captures selector, trimmed text, attributes, styles, structure and position", () => {
    document.body.innerHTML = `<main id="app"><button id="buy" class="btn" style="color: rgb(255, 0, 0)">
      Buy   now
    </button></main>`;
    const context = captureElement(only("button"));
    expect(context.selector).toBe("#buy");
    expect(context.text).toBe("Buy now");
    expect(context.attributes).toMatchObject({ id: "buy", class: "btn" });
    expect(context.styles).toMatchObject({ color: "rgb(255, 0, 0)" });
    expect(context.structure).toContain("button#buy.btn  <- pinned");
    expect(context.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(pageContextSchema.safeParse(context).success).toBe(true);
  });

  it("never captures form field values, typed or default", () => {
    document.body.innerHTML = `<form id="f">
      <input name="user" value="${SECRET}">
      <input type="password" name="pass" value="${SECRET}">
      <input type="hidden" name="csrf" value="${SECRET}">
      <textarea name="note">${SECRET}</textarea>
      <select name="plan"><option value="${SECRET}">${SECRET}</option></select>
      <span>Visible</span>
    </form>`;
    for (const input of document.querySelectorAll("input")) input.value = `${SECRET}-typed`;
    only("textarea").value = `${SECRET}-typed`;

    const form = only("form");
    const captured = [
      captureElement(form),
      ...Array.from(form.querySelectorAll("input, textarea, select, option"), captureElement),
    ];
    const serialised = JSON.stringify(captured);
    expect(serialised).not.toContain(SECRET);
    expect(captureElement(form).text).toBe("Visible");
    expect(captureElement(only("textarea")).attributes).toEqual({ name: "note" });
  });

  it("drops inline event handlers and nonces", () => {
    document.body.innerHTML = `<a href="/x" onclick="steal()" nonce="abc">Link</a>`;
    expect(captureAttributes(only("a"))).toEqual({ href: "/x" });
  });

  it("skips script and style text", () => {
    document.body.innerHTML = `<div><style>.x{}</style><script>var s = 1;</script>Hello</div>`;
    expect(captureElement(only("div")).text).toBe("Hello");
  });

  it("caps text, attribute count and attribute length", () => {
    const many = Array.from({ length: MAX_ATTRIBUTES + 10 }, (_, i) => `data-a${i}="v"`).join(" ");
    const long = "x".repeat(MAX_ATTRIBUTE_VALUE_CHARS * 2);
    document.body.innerHTML = `<p title="${long}" ${many}>${"word ".repeat(500)}</p>`;
    const context = captureElement(only("p"));
    expect(context.text?.length).toBe(MAX_TEXT_CHARS);
    expect(Object.keys(context.attributes ?? {})).toHaveLength(MAX_ATTRIBUTES);
    expect(context.attributes?.title?.length).toBe(MAX_ATTRIBUTE_VALUE_CHARS);
  });
});

describe("describeStructure", () => {
  it("outlines ancestors, nearby siblings and children without page text", () => {
    document.body.innerHTML = `<main id="app"><ul class="menu">
      ${Array.from({ length: 10 }, (_, i) => `<li class="item">Item ${i}</li>`).join("")}
    </ul></main>`;
    const fifth = document.querySelectorAll("li")[5];
    if (fifth === undefined) throw new Error("missing");
    const outline = describeStructure(fifth);
    expect(outline).toContain("main#app");
    expect(outline).toContain("ul.menu");
    expect(outline).toContain("li.item  <- pinned");
    expect(outline).toContain("…");
    expect(outline).not.toContain("Item");
    expect(outline.length).toBeLessThanOrEqual(MAX_STRUCTURE_CHARS);
  });
});

describe("capturePin", () => {
  it("captures a text selection without text inside form fields", () => {
    document.body.innerHTML = `<p id="intro">Hello <b>bold</b> world</p><textarea>${SECRET}</textarea><p>after</p>`;
    const range = document.createRange();
    range.setStart(only("p").firstChild ?? document.body, 0);
    const after = document.querySelectorAll("p")[1]?.firstChild;
    if (after === null || after === undefined) throw new Error("missing");
    range.setEnd(after, 5);
    const context = capturePin({ kind: "text", range });
    expect(context.kind).toBe("text");
    expect(context.selectedText).toBe("Hello bold world after");
    expect(JSON.stringify(context)).not.toContain(SECRET);
  });

  it("captures part of a single text node", () => {
    document.body.innerHTML = `<p>Hello world</p>`;
    const range = document.createRange();
    const text = only("p").firstChild;
    if (text === null) throw new Error("missing");
    range.setStart(text, 6);
    range.setEnd(text, 11);
    expect(rangeText(range)).toBe("world");
  });

  it("captures several elements, the first at the top level", () => {
    document.body.innerHTML = `<a id="one">1</a><a id="two">2</a><a id="three">3</a>`;
    const context = capturePin({
      kind: "elements",
      elements: Array.from(document.querySelectorAll("a")),
    });
    expect(context.kind).toBe("elements");
    expect(context.selector).toBe("#one");
    expect(context.elements?.map((element) => element.selector)).toEqual(["#two", "#three"]);
    expect(context.viewport?.devicePixelRatio).toBeGreaterThan(0);
    expect(pageContextSchema.safeParse(context).success).toBe(true);
  });

  it("captures a dragged area with its container and elements", () => {
    document.body.innerHTML = `<div id="hero"><h1 id="title">Hi</h1></div>`;
    const area = { x: 10.4, y: 20.6, width: 100, height: 50 };
    const context = capturePin({
      kind: "area",
      area,
      elements: [only("h1")],
      container: only("div"),
    });
    expect(context.kind).toBe("area");
    expect(context.selector).toBe("#hero");
    expect(context.area).toEqual({ x: 10, y: 21, width: 100, height: 50 });
    expect(context.elements?.[0]?.selector).toBe("#title");
  });
});
