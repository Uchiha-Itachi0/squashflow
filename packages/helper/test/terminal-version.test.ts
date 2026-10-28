import { describe, expect, it } from "vitest";
import { checkClaudeVersion } from "../src/doctor.js";
import { createTerminal, shouldUseColor } from "../src/terminal.js";
import { meetsMinimum } from "../src/version.js";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("terminal", () => {
  it("honours NO_COLOR, --no-color and non-TTY output", () => {
    expect(shouldUseColor({ env: {}, isTTY: true })).toBe(true);
    expect(shouldUseColor({ env: { NO_COLOR: "1" }, isTTY: true })).toBe(false);
    expect(shouldUseColor({ noColorFlag: true, env: {}, isTTY: true })).toBe(false);
    expect(shouldUseColor({ env: {}, isTTY: false })).toBe(false);
  });

  it("prints Squish without colour codes or emoji when colour is off", () => {
    const term = createTerminal(false);
    const lines = [
      term.banner(),
      term.info("paired with Chrome"),
      term.arrow("claude@demo  pin 3"),
      term.squashed(),
    ];
    expect(lines).toEqual([
      "(｡•ᴗ•｡) Squish · squashflow helper",
      "squish › paired with Chrome",
      "squish → claude@demo  pin 3",
      "(｡>ᴗ<｡) squashed!",
    ]);
    for (const line of lines) {
      expect(line).not.toContain("\u001b");
      expect(line).not.toMatch(EMOJI);
    }
  });

  it("uses violet when colour is on", () => {
    expect(createTerminal(true).info("x")).toContain("\u001b[38;5;141m");
  });
});

describe("Claude Code version check", () => {
  it("compares dotted versions", () => {
    expect(meetsMinimum("2.1.224", "2.1.224")).toBe(true);
    expect(meetsMinimum("2.1.312", "2.1.224")).toBe(true);
    expect(meetsMinimum("2.2.0", "2.1.224")).toBe(true);
    expect(meetsMinimum("2.1.99", "2.1.224")).toBe(false);
    expect(meetsMinimum("garbage", "2.1.224")).toBe(false);
  });

  it("reads `claude --version` output", async () => {
    const ok = await checkClaudeVersion(() => Promise.resolve("2.1.312 (Claude Code)\n"));
    expect(ok.ok).toBe(true);
    const old = await checkClaudeVersion(() => Promise.resolve("2.1.100 (Claude Code)\n"));
    expect(old).toMatchObject({ ok: false });
    const missing = await checkClaudeVersion(() => Promise.reject(new Error("ENOENT")));
    expect(missing.ok).toBe(false);
  });
});
