import { describe, expect, it } from "vitest";
import { renderInline, renderMarkdown } from "../src/ui/markdown";

function html(text: string): string {
  const box = document.createElement("div");
  box.append(...renderMarkdown(text));
  return box.innerHTML;
}

describe("renderMarkdown", () => {
  it("renders the captain's reply without raw markdown symbols", () => {
    const reply = [
      "Captain, a Squashflow pin from your browser landed in **this VMA session by mistake**.",
      "",
      "- **Page:** pollenflow.com/feature/selective-saving",
      '- **Your comment:** "active button color is not visible"',
    ].join("\n");
    expect(html(reply)).toBe(
      "<p>Captain, a Squashflow pin from your browser landed in <strong>this VMA session by mistake</strong>.</p>" +
        "<ul><li><strong>Page:</strong> pollenflow.com/feature/selective-saving</li>" +
        '<li><strong>Your comment:</strong> "active button color is not visible"</li></ul>',
    );
  });

  it("renders italics, inline code, numbered lists, headings and code blocks", () => {
    expect(html("_really_ *now* use `a**b**` in snake_case_name")).toBe(
      "<p><em>really</em> <em>now</em> use <code>a**b**</code> in snake_case_name</p>",
    );
    expect(html("## Done\n3. one\n4. two")).toBe(
      '<p><strong>Done</strong></p><ol start="3"><li>one</li><li>two</li></ol>',
    );
    expect(html("Diff:\n```diff\n- **old**\n+ <b>new</b>\n```\nafter")).toBe(
      "<p>Diff:</p><pre><code>- **old**\n+ &lt;b&gt;new&lt;/b&gt;</code></pre><p>after</p>",
    );
    expect(html("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });

  it("never injects markup from the reply", () => {
    const box = document.createElement("div");
    box.append(
      ...renderMarkdown(
        "<img src=x onerror=alert(1)> **<script>alert(1)</script>** [x](javascript:alert(1))",
      ),
    );
    expect(box.querySelector("img, script")).toBeNull();
    expect(box.querySelector("a")).toBeNull();
    expect(box.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(box.textContent).toContain("[x](javascript:alert(1))");
  });

  it("links only plain https addresses, showing the address itself", () => {
    const box = document.createElement("div");
    box.append(
      ...renderInline(
        "See [the PR](https://github.com/acme/demo/pull/7), https://example.com/a. and http://plain.test or [x](https://u:p@evil.test/)",
      ),
    );
    const links = [...box.querySelectorAll("a")];
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["https://github.com/acme/demo/pull/7", "https://github.com/acme/demo/pull/7"],
      ["https://example.com/a", "https://example.com/a"],
    ]);
    expect(links.every((link) => link.rel === "noopener noreferrer")).toBe(true);
    expect(box.textContent).toContain("the PR https://github.com/acme/demo/pull/7, ");
    expect(box.textContent).toContain("http://plain.test");
    expect(box.textContent).toContain("[x](https://u:p@evil.test/)");
  });
});
