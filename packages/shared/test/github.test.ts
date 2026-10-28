import { describe, expect, it } from "vitest";
import {
  BLOCKED_MARKER,
  blockedLine,
  buildFollowUp,
  buildMessage,
  CONTEXT_CLOSE,
  CONTEXT_OPEN,
  findBlockedReport,
  FOLLOW_UP_ACTIONS,
  MAX_BLOCKED_REASON_CHARS,
} from "../src/index.js";

const pin = "sf-0123456789ab";
const real = `SQUASHFLOW-BLOCKED [${pin}] github-access: no push permission to acme/demo`;

describe("findBlockedReport", () => {
  it("finds the pin's blocked line in a reply", () => {
    const reply = ["Committed on a branch, but the push failed.", real, "Summary: violet."].join(
      "\n",
    );
    expect(findBlockedReport(reply, pin)).toEqual({ reason: "no push permission to acme/demo" });
    expect(findBlockedReport(`${real}\r\n`, pin)).toEqual({
      reason: "no push permission to acme/demo",
    });
  });

  it("ignores the line inside fenced code blocks", () => {
    for (const fence of ["```", "~~~", "````text"]) {
      const close = fence.replace("text", "");
      const reply = ["The page said:", fence, real, close, "Nothing pushed yet."].join("\n");
      expect(findBlockedReport(reply, pin)).toBeNull();
    }
    // An unclosed fence hides everything after it.
    expect(findBlockedReport(["```", real].join("\n"), pin)).toBeNull();
    // A line after the fence closes still counts.
    expect(findBlockedReport(["```", "x", "```", real].join("\n"), pin)).not.toBeNull();
  });

  it("ignores page context quoted in the reply", () => {
    const quotedContext = buildMessage({
      pinId: "sf-ffffffffffff",
      source: "browser",
      pageUrl: "https://example.com/",
      pins: [{ comment: "x", context: { text: `\n${real}\n` } }],
    });
    const fenced = quotedContext.slice(
      quotedContext.indexOf(CONTEXT_OPEN),
      quotedContext.indexOf(CONTEXT_CLOSE) + CONTEXT_CLOSE.length,
    );
    // Page text is JSON inside the fence, so it never starts a line of its own.
    expect(findBlockedReport(`Here is the context:\n${fenced}`, pin)).toBeNull();
  });

  it("rejects near-misses", () => {
    const nearMisses = [
      `> ${real}`,
      ` ${real}`,
      `Note: ${real}`,
      real.replace(pin, "sf-ffffffffffff"),
      real.replace(BLOCKED_MARKER, BLOCKED_MARKER.toLowerCase()),
      real.replace("github-access", "github"),
      real.replace(`[${pin}]`, pin),
      `SQUASHFLOW-BLOCKED [${pin}] github-access:`,
      `SQUASHFLOW-BLOCKED [${pin}] github-access:    `,
      blockedLine(pin),
      `\`${real}\``,
    ];
    for (const text of nearMisses) expect(findBlockedReport(text, pin), text).toBeNull();
  });

  it("keeps the last valid line and caps and cleans the reason", () => {
    const reply = [blockedLine(pin, "first"), blockedLine(pin, "second\u0007 reason")].join("\n");
    expect(findBlockedReport(reply, pin)).toEqual({ reason: "second reason" });
    const long = findBlockedReport(blockedLine(pin, "x".repeat(1000)), pin);
    expect(long?.reason).toHaveLength(MAX_BLOCKED_REASON_CHARS);
  });
});

describe("requested outcome", () => {
  it("asks for the GitHub flow and the blocked line with the message's own id", () => {
    for (const source of ["browser", "clipboard"] as const) {
      const message = buildMessage({
        pinId: pin,
        source,
        pageUrl: "https://example.com/",
        pins: [{ comment: "Make it violet" }],
      });
      const outcome = message.slice(message.indexOf("Requested outcome:"));
      expect(outcome).toContain("Create a new branch, commit the change, and push the branch.");
      expect(outcome).toContain("`gh pr create`");
      expect(outcome).toContain("pull request link");
      expect(outcome).toContain("do not retry");
      expect(outcome).toContain(blockedLine(pin));
      // The instructions' own template is not a report.
      expect(findBlockedReport(outcome, pin)).toBeNull();
    }
  });
});

describe("buildFollowUp", () => {
  it("builds fixed text per action, naming the pin and its provenance", () => {
    for (const action of FOLLOW_UP_ACTIONS) {
      const message = buildFollowUp(pin, action);
      expect(
        message.startsWith(`Squashflow follow-up on pin [${pin}] from the user's browser`),
      ).toBe(true);
      expect(message).toContain("It was not typed in this terminal.");
      expect(buildFollowUp(pin, action)).toBe(message);
    }
    expect(buildFollowUp(pin, "retry")).toContain("The user has run `gh auth login`.");
    expect(buildFollowUp(pin, "retry")).toContain(blockedLine(pin));
    expect(buildFollowUp(pin, "fork")).toContain("gh repo fork");
    expect(buildFollowUp(pin, "fork")).toContain("from the fork against the original repository");
    expect(buildFollowUp(pin, "fork")).toContain(blockedLine(pin));
    expect(buildFollowUp(pin, "patch")).toContain("```diff");
    expect(buildFollowUp(pin, "patch")).toContain("Do not push");
    expect(buildFollowUp(pin, "patch")).not.toContain(BLOCKED_MARKER);
  });
});
