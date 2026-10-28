import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunCommand } from "../src/exec.js";
import { findSession, listSessions } from "../src/sessions.js";
import { StateStore } from "../src/state.js";
import { fakeSession, tempDir } from "./helpers.js";

describe("StateStore", () => {
  it("saves state readable and writable only by the user", async () => {
    const dir = await tempDir();
    const store = new StateStore(join(dir.path, "home"));
    expect(await store.load()).toEqual({ version: 1, pairing: null });
    const pairing = { tokenHash: "a".repeat(64), origin: "chrome-extension://x", pairedAt: "now" };
    await store.save({ version: 1, pairing });
    expect((await stat(store.file)).mode & 0o777).toBe(0o600);
    expect((await stat(store.dir)).mode & 0o777).toBe(0o700);
    expect(await store.load()).toEqual({ version: 1, pairing });
    await writeFile(store.file, JSON.stringify({ version: 1, pairing: null, token: "plain" }));
    await expect(store.load()).rejects.toThrow(/not valid/);
    await dir.cleanup();
  });
});

describe("listSessions", () => {
  it("runs fixed argv and matches each folder to its repository", async () => {
    const calls: { file: string; args: readonly string[]; cwd?: string | undefined }[] = [];
    const run: RunCommand = (file, args, options) => {
      calls.push({ file, args, cwd: options?.cwd });
      if (file === "claude") {
        return Promise.resolve(
          JSON.stringify([
            {
              pid: 1,
              cwd: "/a",
              name: "alpha",
              status: "idle",
              sessionId: "s1",
              kind: "interactive",
            },
            { pid: 2, cwd: "/b", status: "busy", sessionId: "s2" },
            { pid: "bad" },
          ]),
        );
      }
      return options?.cwd === "/a"
        ? Promise.resolve("git@github.com:acme/alpha.git\n")
        : Promise.reject(new Error("no remote"));
    };
    const sessions = await listSessions(run);
    expect(sessions.map((s) => [s.pid, s.name, s.repo?.fullName ?? null])).toEqual([
      [1, "alpha", "acme/alpha"],
      [2, "pid-2", null],
    ]);
    expect(calls[0]).toEqual({ file: "claude", args: ["agents", "--json"], cwd: undefined });
    expect(calls.slice(1).map((c) => [c.file, c.args, c.cwd])).toEqual([
      ["git", ["remote", "get-url", "origin"], "/a"],
      ["git", ["remote", "get-url", "origin"], "/b"],
    ]);
  });

  it("explains non-JSON output", async () => {
    await expect(listSessions(() => Promise.resolve("oops"))).rejects.toThrow(/did not print JSON/);
  });
});

describe("findSession", () => {
  const sessions = [
    fakeSession({ pid: 10, name: "web" }),
    fakeSession({ pid: 11, name: "api" }),
    fakeSession({ pid: 12, name: "api" }),
  ];
  it("finds by pid or unique name", () => {
    expect(findSession(sessions, "10").name).toBe("web");
    expect(findSession(sessions, "web").pid).toBe(10);
  });
  it("refuses ambiguous and unknown selectors", () => {
    expect(() => findSession(sessions, "api")).toThrow(/Several sessions/);
    expect(() => findSession(sessions, "nope")).toThrow(/No running/);
  });
});
