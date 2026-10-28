import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionInfo } from "../src/sessions.js";

export async function tempDir(
  prefix = "sqf-",
): Promise<{ path: string; cleanup(): Promise<void> }> {
  // Short base path: Unix socket paths are limited to ~104 bytes on macOS.
  const path = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), prefix));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

export interface FakeInbox {
  path: string;
  lines: string[];
  received: Promise<string>;
  close(): Promise<void>;
}

/** A fake session inbox: a Unix socket that records the NDJSON lines written to it. */
export async function fakeInbox(path: string, mode = 0o600): Promise<FakeInbox> {
  const lines: string[] = [];
  let resolveFirst: (line: string) => void = () => undefined;
  const received = new Promise<string>((resolve) => {
    resolveFirst = resolve;
  });
  const server: Server = createServer((connection) => {
    let buffer = "";
    connection.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        lines.push(line);
        resolveFirst(line);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  await chmod(path, mode);
  return {
    path,
    lines,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function fakeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    pid: 4242,
    name: "demo",
    status: "idle",
    cwd: "/work/demo",
    sessionId: "11111111-2222-3333-4444-555555555555",
    repo: { host: "github.com", owner: "acme", name: "demo", fullName: "acme/demo" },
    title: null,
    branch: null,
    startedAt: null,
    lastActiveAt: null,
    configDir: "/home/demo/.claude",
    account: null,
    terminal: null,
    ...overrides,
  };
}
