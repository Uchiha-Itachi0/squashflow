/**
 * The real helper (the built `squashflow` CLI) against a fake `claude` on PATH, a
 * fake session inbox socket and fake session transcripts in a temporary folder. Nothing
 * touches a real Claude Code session: the helper's state, Claude config and inbox socket
 * folder all point into the temporary folder.
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { appendFile, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HELPER_CLI = join(here, "..", "..", "helper", "dist", "cli.js");
const READY_TIMEOUT_MS = 15_000;

export interface FakeSessionSpec {
  pid: number;
  name: string;
  status: "idle" | "busy";
  remote: string;
}

export interface RunningHelper {
  port: number;
  pairingCode: string;
  /** The helper's state folder (`SQUASHFLOW_HOME`), where it writes region screenshots. */
  home: string;
  /** NDJSON lines written to the fake inbox of the given session pid. */
  inboxLines(pid: number): string[];
  /** Resolves with the first line written to that inbox. */
  received(pid: number): Promise<string>;
  /** Append records to that session's fake transcript, as Claude Code would. */
  appendTranscript(pid: number, records: readonly unknown[]): Promise<void>;
  close(): Promise<void>;
}

export async function startHelper(sessions: readonly FakeSessionSpec[]): Promise<RunningHelper> {
  // Short base path: Unix socket paths are limited to ~104 bytes on macOS.
  const root = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "sqf-e2e-"));
  const bin = join(root, "bin");
  const socks = join(root, "socks");
  await mkdir(bin);
  await mkdir(socks);

  const agents: { pid: number; cwd: string; name: string; status: string; sessionId: string }[] =
    [];
  for (const session of sessions) {
    const cwd = join(root, "work", session.name);
    await mkdir(cwd, { recursive: true });
    execFileSync("git", ["init", "-q", cwd]);
    execFileSync("git", ["-C", cwd, "remote", "add", "origin", session.remote]);
    agents.push({
      pid: session.pid,
      cwd,
      name: session.name,
      status: session.status,
      sessionId: `00000000-0000-4000-8000-${String(session.pid).padStart(12, "0")}`,
    });
  }
  const agentsFile = join(root, "agents.json");
  await writeFile(agentsFile, JSON.stringify(agents));
  const fakeClaude = join(bin, "claude");
  await writeFile(
    fakeClaude,
    [
      "#!/bin/sh",
      `if [ "$1" = "agents" ]; then cat '${agentsFile}'; exit 0; fi`,
      `if [ "$1" = "--version" ]; then echo "2.1.224 (Claude Code)"; exit 0; fi`,
      "exit 1",
      "",
    ].join("\n"),
  );
  await chmod(fakeClaude, 0o755);

  const inboxes = new Map<number, FakeInbox>();
  for (const session of sessions) {
    inboxes.set(session.pid, await fakeInbox(join(socks, `${session.pid}.sock`)));
  }

  const port = await freePort();
  const child = spawn(process.execPath, [HELPER_CLI, "start", "--port", String(port), "--pair"], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      NO_COLOR: "1",
      SQUASHFLOW_HOME: join(root, "home"),
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      SQUASHFLOW_INBOX_SOCKET_DIR: socks,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pairingCode = await waitForPairingCode(child);

  const inbox = (pid: number): FakeInbox => {
    const found = inboxes.get(pid);
    if (found === undefined) throw new Error(`No fake session with pid ${pid}`);
    return found;
  };
  return {
    port,
    pairingCode,
    home: join(root, "home"),
    inboxLines: (pid) => inbox(pid).lines,
    received: (pid) => inbox(pid).received,
    appendTranscript: async (pid, records) => {
      const agent = agents.find((entry) => entry.pid === pid);
      if (agent === undefined) throw new Error(`No fake session with pid ${pid}`);
      // Claude Code's project folder: the cwd with every non-alphanumeric character as `-`.
      const folder = join(root, "claude", "projects", agent.cwd.replace(/[^A-Za-z0-9]/g, "-"));
      await mkdir(folder, { recursive: true });
      const lines = records.map((record) => `${JSON.stringify(record)}\n`).join("");
      await appendFile(join(folder, `${agent.sessionId}.jsonl`), lines);
    },
    close: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        await exited;
      }
      for (const box of inboxes.values()) await box.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function waitForPairingCode(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`The helper did not print a pairing code:\n${output}`));
    }, READY_TIMEOUT_MS);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      const code = /pairing code ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(output)?.[1];
      if (code !== undefined && output.includes("listening on")) {
        clearTimeout(timer);
        resolve(code);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The helper exited with ${String(code)}:\n${output}`));
    });
  });
}

interface FakeInbox {
  lines: string[];
  received: Promise<string>;
  close(): Promise<void>;
}

/** A fake session inbox: an owner-only Unix socket that records the lines written to it. */
async function fakeInbox(path: string): Promise<FakeInbox> {
  const lines: string[] = [];
  let resolveFirst: (line: string) => void = () => undefined;
  const received = new Promise<string>((resolve) => {
    resolveFirst = resolve;
  });
  const server: Server = createNetServer((connection) => {
    let buffer = "";
    connection.on("data", (chunk: Buffer) => {
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
  await chmod(path, 0o600);
  return {
    lines,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
