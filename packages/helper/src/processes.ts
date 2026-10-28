/**
 * What the helper reads about a running session's process: whether it is Claude Code,
 * and the few environment variables that say which account it runs under
 * (`CLAUDE_CONFIG_DIR`) and which terminal it runs in (`HERDR_*`). Reading another
 * process's environment works only for the user's own processes: `ps -E` on macOS,
 * `/proc/<pid>/environ` on Linux. Windows is not supported.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { RunCommand } from "./exec.js";

/** The only variables kept from a session's environment. */
const KEPT_VARIABLES = /^(CLAUDE_CONFIG_DIR|HERDR_SOCKET_PATH|HERDR_WORKSPACE_ID|HERDR_TAB_ID)$/;
/** Where a variable starts in `ps -E` output: ` NAME=`. */
const PS_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*=/;

export interface ProcessInfo {
  /** Whether the program is Claude Code. */
  isClaude: boolean;
  /** Only the kept variables; values are untrusted. */
  env: Readonly<Record<string, string>>;
}

export type ReadProcess = (pid: number) => Promise<ProcessInfo | null>;

/** Read a process, or null when it is gone, not the user's, or the platform is unsupported. */
export function processReader(
  run: RunCommand,
  platform: NodeJS.Platform = process.platform,
): ReadProcess {
  if (platform === "darwin") return (pid) => readWithPs(run, pid);
  if (platform === "linux") return readFromProc;
  return () => Promise.resolve(null);
}

async function readWithPs(run: RunCommand, pid: number): Promise<ProcessInfo | null> {
  let output: string;
  try {
    output = await run("ps", ["-ww", "-E", "-o", "command=", "-p", String(pid)]);
  } catch {
    return null;
  }
  const line = output.trim();
  return line === "" ? null : parsePsLine(line);
}

/**
 * One `ps -E -o command=` line: the command and its arguments, then the environment as
 * `NAME=value` words. Values are split on spaces by `ps`, so a word that does not start
 * a new variable continues the previous value. The environment comes last, so a later
 * variable wins over an argument that happens to look like one.
 */
export function parsePsLine(line: string): ProcessInfo {
  const words = line.split(" ");
  const env: Record<string, string> = {};
  let current: string | null = null;
  for (const word of words) {
    if (PS_VARIABLE.test(word)) {
      const at = word.indexOf("=");
      current = word.slice(0, at);
      env[current] = word.slice(at + 1);
    } else if (current !== null) {
      env[current] = `${env[current] ?? ""} ${word}`;
    }
  }
  return { isClaude: isClaudeCommand(words), env: keep(env) };
}

async function readFromProc(pid: number): Promise<ProcessInfo | null> {
  try {
    const [environ, cmdline] = await Promise.all([
      readFile(`/proc/${pid}/environ`, "utf8"),
      readFile(`/proc/${pid}/cmdline`, "utf8"),
    ]);
    return parseProcEnviron(environ, cmdline.split("\0"));
  } catch {
    return null;
  }
}

/** `/proc/<pid>/environ` (NUL-separated `NAME=value`) and the process's argv. */
export function parseProcEnviron(environ: string, argv: readonly string[]): ProcessInfo {
  const env: Record<string, string> = {};
  for (const entry of environ.split("\0")) {
    const at = entry.indexOf("=");
    if (at > 0) env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return { isClaude: isClaudeCommand(argv), env: keep(env) };
}

/** `claude …`, or Node running Claude Code's script (`node …/claude …`). */
function isClaudeCommand(argv: readonly string[]): boolean {
  const [program = "", script = ""] = argv;
  if (basename(program) === "claude") return true;
  return /^node(\.exe)?$/.test(basename(program)) && /claude/i.test(script);
}

function keep(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => KEPT_VARIABLES.test(name)));
}
