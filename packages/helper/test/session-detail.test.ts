import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_SESSION_TITLE_CHARS } from "@squashflow/shared";
import type { RunCommand } from "../src/exec.js";
import {
  cleanTitle,
  currentBranch,
  readTranscriptDetail,
  TITLE_SCAN_BYTES,
} from "../src/session-detail.js";
import { tempDir } from "./helpers.js";

const record = (value: object): string => `${JSON.stringify(value)}\n`;
const prompt = (content: unknown, extra: object = {}): string =>
  record({ type: "user", message: { role: "user", content }, ...extra });

async function withTranscript(
  lines: readonly string[],
  check: (path: string) => Promise<void>,
): Promise<void> {
  const dir = await tempDir();
  const path = join(dir.path, "s.jsonl");
  await writeFile(path, lines.join(""));
  try {
    await check(path);
  } finally {
    await dir.cleanup();
  }
}

describe("readTranscriptDetail", () => {
  it("prefers a rename over Claude Code's title over a summary, latest of each kind", async () => {
    await withTranscript(
      [
        record({ type: "summary", summary: "Old summary" }),
        record({ type: "ai-title", aiTitle: "First title" }),
        record({ type: "ai-title", aiTitle: "Checkout contrast fix" }),
      ],
      async (path) => {
        expect((await readTranscriptDetail(path)).title).toBe("Checkout contrast fix");
        await appendFile(path, record({ type: "custom-title", customTitle: "my rename" }));
        expect((await readTranscriptDetail(path)).title).toBe("my rename");
      },
    );
  });

  it("falls back to the first prompt the user typed", async () => {
    await withTranscript(
      [
        prompt("<command-name>/clear</command-name>"),
        prompt("Squashflow pin from the browser", { origin: { kind: "peer" } }),
        prompt("meta note", { isMeta: true }),
        prompt([{ type: "tool_result", content: "x" }]),
        prompt([{ type: "text", text: "  Make the\n\tbuy button\u0007 violet  " }]),
        prompt("Second prompt"),
      ],
      async (path) => {
        expect(await readTranscriptDetail(path)).toEqual({
          title: "Make the buy button violet",
          lastActiveAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
        });
      },
    );
  });

  it("reads only the head and tail of a long transcript", async () => {
    const filler = record({ type: "assistant", text: "x".repeat(TITLE_SCAN_BYTES) });
    await withTranscript([prompt("Start of the work"), filler, filler], async (path) => {
      expect((await readTranscriptDetail(path)).title).toBe("Start of the work");
      await appendFile(path, record({ type: "ai-title", aiTitle: "Late title" }));
      expect((await readTranscriptDetail(path)).title).toBe("Late title");
    });
  });

  it("is empty for a missing transcript or one without a title", async () => {
    expect(await readTranscriptDetail("/nonexistent/s.jsonl")).toEqual({
      title: null,
      lastActiveAt: null,
    });
    await withTranscript(
      ["not json\n", record({ type: "ai-title", aiTitle: " \n " })],
      async (p) => {
        expect((await readTranscriptDetail(p)).title).toBeNull();
      },
    );
  });
});

describe("cleanTitle", () => {
  it("keeps one line and caps it", () => {
    const long = cleanTitle("word ".repeat(100)) ?? "";
    expect(long.length).toBe(MAX_SESSION_TITLE_CHARS);
    expect(long.endsWith("…")).toBe(true);
    expect(cleanTitle("a\u2028b\u009bc")).toBe("a b c");
  });
});

describe("currentBranch", () => {
  const answering =
    (answer: Promise<string>): RunCommand =>
    () =>
      answer;
  it("reports the checked-out branch", async () => {
    expect(await currentBranch(answering(Promise.resolve("feat/x\n")), "/a")).toBe("feat/x");
  });
  it("is null when detached or the name is not a plain branch name", async () => {
    expect(await currentBranch(answering(Promise.reject(new Error("detached"))), "/a")).toBeNull();
    expect(await currentBranch(answering(Promise.resolve("a b\u001b[31m")), "/a")).toBeNull();
    expect(await currentBranch(answering(Promise.resolve("x".repeat(101))), "/a")).toBeNull();
  });
});
