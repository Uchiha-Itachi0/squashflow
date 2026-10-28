#!/usr/bin/env node
/** squashflow command line: start (default), sessions, send, doctor. */

import { parseArgs } from "node:util";
import { doctorCommand } from "./commands/doctor.js";
import { sendCommand } from "./commands/send.js";
import { sessionsCommand } from "./commands/sessions.js";
import { startCommand } from "./commands/start.js";
import { DEFAULT_PORT, HELPER_VERSION } from "./constants.js";
import { createTerminal, shouldUseColor } from "./terminal.js";

const DEFAULT_WAIT_SECONDS = 120;
const COMMANDS = new Set(["start", "sessions", "send", "doctor"]);

const USAGE = `Usage:
  squashflow [start] [--port <n>] [--pair]   run the helper (127.0.0.1 only)
  squashflow sessions [--json]                list Claude Code sessions with repo and status
  squashflow send --session <name|pid> [--url <url>] [--wait <seconds>] "<comment>"
                                              preview, confirm and deliver a pin
  squashflow doctor                           check Node, Claude Code, git and the inbox

Options:
  --no-color   plain output (NO_COLOR is honoured too)
  --version    print the helper version
  --help       print this help`;

export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      port: { type: "string" },
      pair: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      session: { type: "string" },
      url: { type: "string" },
      wait: { type: "string" },
      "no-color": { type: "boolean", default: false },
      version: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) return print(USAGE);
  if (values.version) return print(HELPER_VERSION);

  const term = createTerminal(shouldUseColor({ noColorFlag: values["no-color"] }));
  const [first, ...rest] = positionals;
  const command = first !== undefined && COMMANDS.has(first) ? first : "start";
  const args = command === first ? rest : positionals;

  switch (command) {
    case "sessions":
      return sessionsCommand(term, values.json);
    case "doctor":
      return doctorCommand(term);
    case "send": {
      if (values.session === undefined || args.length === 0)
        throw new UsageError("send needs --session and a comment.");
      return sendCommand(term, {
        session: values.session,
        comment: args.join(" "),
        url: values.url,
        waitSeconds: parsePositiveInt(values.wait, DEFAULT_WAIT_SECONDS, "--wait"),
      });
    }
    default: {
      if (args.length > 0) throw new UsageError(`Unknown command "${args[0] ?? ""}".`);
      return startCommand(term, {
        port: parsePositiveInt(values.port, DEFAULT_PORT, "--port"),
        forcePair: values.pair,
      });
    }
  }
}

class UsageError extends Error {}

function parsePositiveInt(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new UsageError(`${flag} must be a whole number between 1 and 65535.`);
  }
  return parsed;
}

function print(text: string): number {
  process.stdout.write(`${text}\n`);
  return 0;
}

function run(): void {
  if (process.platform === "win32") {
    process.stderr.write("squashflow: Windows is not supported yet. Use macOS or Linux.\n");
    process.exitCode = 1;
    return;
  }
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`squashflow: ${message}\n`);
      if (error instanceof UsageError) process.stderr.write(`\n${USAGE}\n`);
      process.exitCode = 1;
    },
  );
}

run();
