import { MAX_REPLY_CHARS } from "@squashflow/shared";
import { describe, expect, it } from "vitest";
import { findPullRequestUrl, ReplyTracker, type PinEvent } from "../src/reply.js";

const pin = "sf-abcdefabcdef";
const other = "sf-000000000000";

/** Fake transcript records, shaped like Claude Code's session JSONL. */
const peer = (pinId: string): string =>
  JSON.stringify({
    type: "user",
    isMeta: true,
    origin: { kind: "peer", name: "squashflow", body: `Squashflow pin [${pinId}] ...` },
    message: { role: "user", content: `Another Claude session sent a message: [${pinId}]` },
  });
const assistant = (id: string, content: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "assistant",
    message: { id, role: "assistant", content },
    ...extra,
  });
const text = (value: string): { type: string; text: string } => ({ type: "text", text: value });
const toolUse = { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } };
const toolResult = JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
  },
});
const turnEnd = JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 1200 });
const prompt = (value: string): string =>
  JSON.stringify({ type: "user", message: { role: "user", content: value } });

function run(lines: readonly string[], pinId = pin): PinEvent[] {
  const tracker = new ReplyTracker(pinId);
  return lines.flatMap((line) => {
    const event = tracker.feed(line);
    return event === null ? [] : [event];
  });
}

function replyOf(events: readonly PinEvent[]) {
  const found = events.find((event) => event.kind === "reply");
  return found?.kind === "reply" ? found.reply : undefined;
}

describe("ReplyTracker", () => {
  it("picks Claude's last message in the turn that handled the pin", () => {
    const events = run([
      peer(pin),
      assistant("msg_1", [{ type: "thinking", thinking: "hmm" }]),
      assistant("msg_1", [text("Let me look at the button."), toolUse]),
      toolResult,
      assistant("msg_2", [text("Done: the Buy button is violet now.")]),
      assistant("msg_2", [text("PR: https://github.com/acme/demo/pull/17")]),
      turnEnd,
    ]);
    expect(events.map((event) => event.kind)).toEqual(["seen", "reply"]);
    expect(replyOf(events)).toEqual({
      text: "Done: the Buy button is violet now.\n\nPR: https://github.com/acme/demo/pull/17",
      truncated: false,
      pullRequestUrl: "https://github.com/acme/demo/pull/17",
      blocked: null,
    });
  });

  it("reports a reply without a pull request link", () => {
    const reply = replyOf(run([peer(pin), assistant("m", [text("Which button?")]), turnEnd]));
    expect(reply).toEqual({
      text: "Which button?",
      truncated: false,
      pullRequestUrl: null,
      blocked: null,
    });
  });

  it("attributes a batch reply to the batch's single pin id", () => {
    // A batch is one message with one pin id; the extension fans the reply out to its pins.
    const reply = replyOf(
      run([
        peer(pin),
        assistant("m", [text("Fixed all 3 pins in https://github.com/acme/demo/pull/9.")]),
        turnEnd,
      ]),
    );
    expect(reply?.pullRequestUrl).toBe("https://github.com/acme/demo/pull/9");
  });

  it("follows a held message to Seen by Claude and then the reply", () => {
    const held = JSON.stringify({
      type: "system",
      content: `Held peer message — preview: «Squashflow pin ${pin}» — not delivered`,
    });
    const events = run([held, peer(pin), assistant("m", [text("On it.")]), turnEnd]);
    expect(events.map((event) => event.kind)).toEqual(["held", "seen", "reply"]);
  });

  it("ignores assistant lines before the pin was seen, from subagents, and after the turn", () => {
    const events = run([
      assistant("before", [text("Unrelated work https://github.com/acme/demo/pull/1")]),
      peer(other),
      assistant("other", [text("Reply to another pin")]),
      peer(pin),
      assistant("side", [text("Subagent notes")], { isSidechain: true }),
      assistant("mine", [text("Mine.")]),
      turnEnd,
      assistant("after", [text("Later answer https://github.com/acme/demo/pull/2")]),
    ]);
    expect(replyOf(events)).toEqual({
      text: "Mine.",
      truncated: false,
      pullRequestUrl: null,
      blocked: null,
    });
  });

  it("reports the pin's blocked line, and only this pin's", () => {
    const blockedText = [
      "Committed on squashflow/violet-buy, but the push failed.",
      `SQUASHFLOW-BLOCKED [${pin}] github-access: no push permission to acme/demo`,
    ].join("\n");
    const reply = replyOf(run([peer(pin), assistant("m", [text(blockedText)]), turnEnd]));
    expect(reply?.blocked).toEqual({ reason: "no push permission to acme/demo" });
    const another = replyOf(
      run([peer(pin), assistant("m", [text(blockedText.replace(pin, other))]), turnEnd]),
    );
    expect(another?.blocked).toBeNull();
  });

  it("ends the turn at the next prompt when there is no turn notice", () => {
    const reply = replyOf(
      run([peer(pin), assistant("m", [text("Done.")]), toolResult, prompt("next task")]),
    );
    expect(reply?.text).toBe("Done.");
  });

  it("keeps following when another peer message arrives mid-turn", () => {
    const reply = replyOf(
      run([
        peer(pin),
        assistant("a", [text("Working.")]),
        peer(other),
        assistant("b", [text("Both fixed.")]),
        turnEnd,
      ]),
    );
    expect(reply?.text).toBe("Both fixed.");
  });

  it("caps an oversize reply and marks it cut", () => {
    const long = "x".repeat(MAX_REPLY_CHARS + 500);
    const reply = replyOf(run([peer(pin), assistant("m", [text(long)]), turnEnd]));
    expect(reply?.truncated).toBe(true);
    expect(reply?.text).toHaveLength(MAX_REPLY_CHARS);
  });

  it("keeps only text: no images, tool calls or control characters, and no reply from those alone", () => {
    const image = { type: "image", source: { type: "base64", data: "AAAA" } };
    expect(replyOf(run([peer(pin), assistant("m", [image, toolUse]), turnEnd]))).toBeUndefined();
    const reply = replyOf(
      run([peer(pin), assistant("m", [image, text("Done\u0007 <b>bold</b>\u001b[31m")]), turnEnd]),
    );
    expect(reply?.text).toBe("Done <b>bold</b>[31m");
  });

  it("finishes after the reply and ignores garbage lines", () => {
    const tracker = new ReplyTracker(pin);
    expect(tracker.feed("not json")).toBeNull();
    tracker.feed(peer(pin));
    expect(tracker.feed("{broken")).toBeNull();
    tracker.feed(assistant("m", [text("Done.")]));
    expect(tracker.finished).toBe(false);
    tracker.feed(turnEnd);
    expect(tracker.finished).toBe(true);
    expect(tracker.feed(assistant("n", [text("More")]))).toBeNull();
  });
});

describe("findPullRequestUrl", () => {
  it("finds GitHub pull request links only", () => {
    expect(findPullRequestUrl("see https://github.com/acme/demo/pull/42/files")).toBe(
      "https://github.com/acme/demo/pull/42",
    );
    expect(findPullRequestUrl("(https://github.com/acme/my.repo/pull/7).")).toBe(
      "https://github.com/acme/my.repo/pull/7",
    );
    expect(findPullRequestUrl("https://github.com/acme/demo/issues/42")).toBeNull();
    expect(findPullRequestUrl("http://github.com/acme/demo/pull/42")).toBeNull();
    expect(findPullRequestUrl("https://github.com.evil.test/acme/demo/pull/42")).toBeNull();
    expect(findPullRequestUrl("https://gitlab.com/acme/demo/pull/42")).toBeNull();
  });
});
