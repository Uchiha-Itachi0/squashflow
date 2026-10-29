import { describe, expect, it } from "vitest";
import { classifyTranscriptLine, projectFolderName } from "../src/transcript.js";

const pin = "sf-abcdefabcdef";

describe("classifyTranscriptLine", () => {
  it("sees a peer user record carrying the marker", () => {
    const line = JSON.stringify({
      type: "user",
      origin: { kind: "peer", body: `Squashflow pin [${pin}] ...` },
    });
    expect(classifyTranscriptLine(line, pin)).toBe("seen");
  });

  it("sees a peer message a busy session took in mid-turn", () => {
    // Shaped like Claude Code 2.1's record when the message arrives during a turn.
    const absorbed = (origin: unknown): string =>
      JSON.stringify({
        type: "attachment",
        attachment: {
          type: "queued_command",
          prompt: `<cross-session-message from-name="squashflow">Squashflow pin [${pin}]`,
          commandMode: "prompt",
          origin,
          isMeta: true,
        },
      });
    expect(classifyTranscriptLine(absorbed({ kind: "peer", name: "squashflow" }), pin)).toBe(
      "seen",
    );
    expect(classifyTranscriptLine(absorbed({ kind: "human" }), pin)).toBeNull();
    expect(classifyTranscriptLine(absorbed(undefined), pin)).toBeNull();
  });

  it("does not treat a user-typed record as seen", () => {
    const line = JSON.stringify({ type: "user", message: { role: "user", content: `[${pin}]` } });
    expect(classifyTranscriptLine(line, pin)).toBeNull();
  });

  it("detects a held notice", () => {
    const line = JSON.stringify({
      type: "system",
      content: `Held peer message — preview: «Squashflow pin [${pin}]»`,
    });
    expect(classifyTranscriptLine(line, pin)).toBe("held");
  });

  it("detects a held notice whose preview stripped the brackets", () => {
    const line = JSON.stringify({
      type: "system",
      content: `Held peer message — preview: «Squashflow pin ${pin} sent by the user» — not delivered`,
    });
    expect(classifyTranscriptLine(line, pin)).toBe("held");
  });

  it("ignores other pins, queue records and garbage", () => {
    expect(
      classifyTranscriptLine(
        JSON.stringify({ type: "user", origin: { kind: "peer", body: "[sf-000000000000]" } }),
        pin,
      ),
    ).toBeNull();
    expect(
      classifyTranscriptLine(JSON.stringify({ type: "queue-operation", content: `[${pin}]` }), pin),
    ).toBeNull();
    expect(classifyTranscriptLine(`not json [${pin}]`, pin)).toBeNull();
  });
});

describe("projectFolderName", () => {
  it("replaces every non-alphanumeric character with a dash", () => {
    expect(projectFolderName("/Users/me/.treehouse/app-1/x_y")).toBe(
      "-Users-me--treehouse-app-1-x-y",
    );
  });
});
