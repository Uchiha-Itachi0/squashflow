import { runCommand } from "../exec.js";
import { publicSession } from "../http/server.js";
import { listSessions } from "../sessions.js";
import type { Terminal } from "../terminal.js";

export async function sessionsCommand(term: Terminal, json: boolean): Promise<number> {
  const sessions = await listSessions(runCommand);
  if (json) {
    process.stdout.write(`${JSON.stringify(sessions.map(publicSession), null, 2)}\n`);
    return 0;
  }
  if (sessions.length === 0) {
    process.stdout.write(`${term.info("no running Claude Code sessions")}\n`);
    return 0;
  }
  process.stdout.write(`${term.info(`${sessions.length} Claude Code session(s)`)}\n`);
  for (const session of sessions) {
    const repo = session.repo?.fullName ?? term.dim("no GitHub remote");
    const line = `  ${String(session.pid).padEnd(7)} ${session.name.padEnd(24)} ${session.status.padEnd(8)} ${repo}`;
    process.stdout.write(`${line}\n${term.dim(`          ${session.cwd}`)}\n`);
  }
  return 0;
}
