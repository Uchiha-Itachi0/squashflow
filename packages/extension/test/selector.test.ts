import { beforeEach, describe, expect, it } from "vitest";
import { buildSelector, cssEscape } from "../src/capture/selector";

function page(html: string): void {
  document.body.innerHTML = html;
}

function only(selector: string): Element {
  const matches = document.querySelectorAll(selector);
  expect(matches).toHaveLength(1);
  const [element] = matches;
  if (element === undefined) throw new Error("no match");
  return element;
}

function expectRoundTrip(element: Element): string {
  const selector = buildSelector(element);
  expect(document.querySelectorAll(selector)).toHaveLength(1);
  expect(document.querySelector(selector)).toBe(element);
  return selector;
}

describe("buildSelector", () => {
  beforeEach(() => page(""));

  it("uses a unique id", () => {
    page('<main><button id="buy">Buy</button></main>');
    expect(expectRoundTrip(only("button"))).toBe("#buy");
  });

  it("skips generated ids and uses a test id instead", () => {
    page('<div id=":r1:"><button id="radix-12345" data-testid="buy-button">Buy</button></div>');
    expect(expectRoundTrip(only("button"))).toBe('button[data-testid="buy-button"]');
  });

  it("uses name and aria-label when they are unique", () => {
    page('<form><input name="email"><button aria-label="Close dialog">x</button></form>');
    expect(expectRoundTrip(only("input"))).toBe('input[name="email"]');
    expect(expectRoundTrip(only("button"))).toBe('button[aria-label="Close dialog"]');
  });

  it("anchors a path on the nearest ancestor with an id", () => {
    page('<section id="pricing"><div class="card"><p>One</p><p>Two</p></div></section>');
    const second = document.querySelectorAll("p")[1];
    if (second === undefined) throw new Error("missing");
    expect(expectRoundTrip(second)).toBe("#pricing > div.card > p:nth-of-type(2)");
  });

  it("ignores CSS-in-JS and CSS module class names", () => {
    page('<nav><a class="css-1x2y3z sc-abcdef Nav_link__x7Yq2 primary">Home</a></nav>');
    expect(expectRoundTrip(only("a"))).toBe("a.primary");
  });

  it("falls back to a positional path when nothing else is unique", () => {
    page("<div><span></span><span></span></div><div><span></span><span></span></div>");
    const last = document.querySelectorAll("span")[3];
    if (last === undefined) throw new Error("missing");
    expectRoundTrip(last);
  });

  it("escapes awkward ids", () => {
    page('<div id="a.b#c"></div>');
    expect(expectRoundTrip(only("div"))).toBe("#a\\.b\\#c");
  });

  it("escapes quotes in attribute values", () => {
    page('<button aria-label="Say &quot;hi&quot;">x</button>');
    expectRoundTrip(only("button"));
  });
});

describe("cssEscape", () => {
  it("escapes a leading digit and punctuation", () => {
    expect(cssEscape("1a")).toBe("\\31 a");
    expect(cssEscape("a:b")).toBe("a\\:b");
    expect(cssEscape("plain-name_1")).toBe("plain-name_1");
  });
});
