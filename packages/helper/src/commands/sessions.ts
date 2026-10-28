import { sessionDisplayName } from "@squashflow/shared";
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
    const terminal = session.terminal === null ? "" : `  ${term.dim(session.terminal)}`;
    const line = `  ${String(session.pid).padEnd(7)} ${sessionDisplayName(publicSession(session))}${terminal}`;
    const about = [
      session.account?.label ?? null,
      session.repo?.fullName ?? "no GitHub remote",
      session.branch,
      session.status,
      `name ${session.name}`,
    ]
      .filter(Boolean)
      .join(" · ");
    process.stdout.write(`${line}\n`);
    if (about !== "") process.stdout.write(`${term.dim(`          ${about}`)}\n`);
    process.stdout.write(`${term.dim(`          ${session.cwd}`)}\n`);
  }
  return 0;
}
