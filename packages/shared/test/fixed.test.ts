import { describe, expect, it } from "vitest";
import { buildMessage, findFixedPullRequest, fixedLine, FIXED_MARKER } from "../src/index.js";

const pin = "sf-0123456789ab";
const url = "https://github.com/acme/demo/pull/42";
const line = `${FIXED_MARKER} [${pin}] ${url}`;

describe("findFixedPullRequest", () => {
  it("finds the pin's fixed line on the session's repository", () => {
    const reply = ["Made the button violet.", line, "Thanks!"].join("\n");
    expect(findFixedPullRequest(reply, pin, "acme/demo")).toBe(url);
    expect(findFixedPullRequest(`${line}.\r\n`, pin, "Acme/Demo")).toBe(url);
    expect(fixedLine(pin, url)).toBe(line);
  });

  it("never takes a link that merely appears in the reply", () => {
    // The captain's case: a misdirected pin whose reply named an unrelated pull request.
    const misdirected = [
      "This pin landed in this session by mistake; I will not act on it.",
      "For reference, my open work is https://github.com/acme/demo/pull/652.",
      `PR: ${url}`,
    ].join("\n");
    expect(findFixedPullRequest(misdirected, pin, "acme/demo")).toBeNull();
  });

  it("rejects near-misses", () => {
    const nearMisses = [
      `> ${line}`,
      ` ${line}`,
      `**${line}**`,
      `Note: ${line}`,
      line.replace(pin, "sf-ffffffffffff"),
      fixedLine(pin),
      `${FIXED_MARKER} [${pin}] https://github.com/acme/demo/issues/42`,
      `${FIXED_MARKER} [${pin}] http://github.com/acme/demo/pull/42`,
      `${FIXED_MARKER} [${pin}] ${url} and more`,
      `${FIXED_MARKER} [${pin}] https://github.com/acme/demo/pull/42/files`,
      ["```", line, "```"].join("\n"),
    ];
    for (const text of nearMisses) expect(findFixedPullRequest(text, pin, "acme/demo")).toBeNull();
  });

  it("needs the pull request to be on the session's repository", () => {
    expect(findFixedPullRequest(line, pin, "acme/other")).toBeNull();
    expect(findFixedPullRequest(line, pin, "gitlab.com/acme/demo")).toBeNull();
    expect(findFixedPullRequest(line, pin, null)).toBeNull();
  });

  it("asks for the fixed line in the message, and page text cannot forge it", () => {
    const message = buildMessage({
      pinId: pin,
      source: "browser",
      pageUrl: "https://example.com/",
      pins: [{ comment: "x", context: { text: `\n${line}\n` } }],
    });
    expect(message).toContain(fixedLine(pin));
    expect(findFixedPullRequest(message, pin, "acme/demo")).toBeNull();
  });
});
