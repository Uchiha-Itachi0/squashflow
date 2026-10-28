/** `squashflow doctor`: check everything the helper depends on. */

import { readdir, stat } from "node:fs/promises";
import { MIN_CLAUDE_CODE_VERSION } from "./constants.js";
import type { RunCommand } from "./exec.js";
import { listSessions } from "./sessions.js";
import { inboxSocketDir } from "./socket.js";
import { meetsMinimum, parseVersion } from "./version.js";

export const MIN_NODE_VERSION = "22.12.0";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorOptions {
  run: RunCommand;
  nodeVersion?: string;
  socketDir?: string;
}

export async function runDoctor({
  run,
  nodeVersion = process.versions.node,
  socketDir = inboxSocketDir(),
}: DoctorOptions): Promise<DoctorCheck[]> {
  return [
    checkNode(nodeVersion),
    await checkClaudeVersion(run),
    await checkAgents(run),
    await checkSocketDir(socketDir),
    await checkGit(run),
  ];
}

function checkNode(version: string): DoctorCheck {
  const ok = meetsMinimum(version, MIN_NODE_VERSION);
  return { name: "node", ok, detail: `${version} (minimum ${MIN_NODE_VERSION})` };
}

export async function checkClaudeVersion(run: RunCommand): Promise<DoctorCheck> {
  let output: string;
  try {
    output = await run("claude", ["--version"]);
  } catch {
    return { name: "claude", ok: false, detail: "`claude` was not found on PATH" };
  }
  const found = parseVersion(output);
  if (!found)
    return {
      name: "claude",
      ok: false,
      detail: `could not read a version from "${output.trim()}"`,
    };
  const version = found.join(".");
  const ok = meetsMinimum(version, MIN_CLAUDE_CODE_VERSION);
  const detail = `${version} (minimum ${MIN_CLAUDE_CODE_VERSION})${ok ? "" : "; update Claude Code"}`;
  return { name: "claude", ok, detail };
}

async function checkAgents(run: RunCommand): Promise<DoctorCheck> {
  try {
    const sessions = await listSessions(run);
    return {
      name: "sessions",
      ok: true,
      detail: `${sessions.length} running (claude agents --json)`,
    };
  } catch (error) {
    return {
      name: "sessions",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkSocketDir(dir: string): Promise<DoctorCheck> {
  try {
    const info = await stat(dir);
    if (!info.isDirectory())
      return { name: "inbox", ok: false, detail: `${dir} is not a directory` };
    const sockets = (await readdir(dir)).filter((entry) => entry.endsWith(".sock"));
    return { name: "inbox", ok: true, detail: `${dir} (${sockets.length} session sockets)` };
  } catch {
    return {
      name: "inbox",
      ok: false,
      detail: `${dir} does not exist yet; start a Claude Code session (not --bare) and retry`,
    };
  }
}

async function checkGit(run: RunCommand): Promise<DoctorCheck> {
  try {
    const output = await run("git", ["--version"]);
    return { name: "git", ok: true, detail: output.trim() };
  } catch {
    return { name: "git", ok: false, detail: "`git` was not found on PATH" };
  }
}
