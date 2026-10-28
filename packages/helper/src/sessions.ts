/**
 * Session discovery (`claude agents --json`), repository matching (`git remote get-url
 * origin`), and what tells sessions apart in the picker (session-detail.ts).
 */

import { z } from "zod";
import type { RunCommand } from "./exec.js";
import { normaliseRemoteUrl, type RepoRef } from "./repo.js";
import { currentBranch, readTranscriptDetail } from "./session-detail.js";
import { claudeConfigDir, locateTranscript } from "./transcript.js";

const agentSchema = z.object({
  pid: z.number().int().positive(),
  cwd: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  sessionId: z.string().optional(),
  /** Milliseconds since the epoch. */
  startedAt: z.number().int().positive().optional(),
});

export interface SessionInfo {
  pid: number;
  name: string;
  status: string;
  cwd: string;
  sessionId: string | null;
  repo: RepoRef | null;
  /** Claude Code's title for the session, or the start of its first prompt. Untrusted. */
  title: string | null;
  branch: string | null;
  startedAt: string | null;
  lastActiveAt: string | null;
}

export async function listSessions(
  run: RunCommand,
  configDir: string = claudeConfigDir(),
): Promise<SessionInfo[]> {
  const output = await run("claude", ["agents", "--json"]);
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    throw new Error("`claude agents --json` did not print JSON. Run `squashflow doctor`.");
  }
  if (!Array.isArray(raw)) throw new Error("`claude agents --json` did not print a list.");
  const agents = raw.flatMap((entry) => {
    const parsed = agentSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return Promise.all(
    agents.map(async (agent) => {
      const sessionId = agent.sessionId ?? null;
      const [repo, branch, detail] = await Promise.all([
        repoForFolder(run, agent.cwd),
        currentBranch(run, agent.cwd),
        sessionId === null
          ? { title: null, lastActiveAt: null }
          : locateTranscript(configDir, agent.cwd, sessionId).then(readTranscriptDetail),
      ]);
      return {
        pid: agent.pid,
        name: agent.name ?? `pid-${agent.pid}`,
        status: agent.status ?? "unknown",
        cwd: agent.cwd,
        sessionId,
        repo,
        title: detail.title,
        branch,
        startedAt: isoTime(agent.startedAt),
        lastActiveAt: detail.lastActiveAt,
      };
    }),
  );
}

function isoTime(epochMs: number | undefined): string | null {
  if (epochMs === undefined) return null;
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function repoForFolder(run: RunCommand, cwd: string): Promise<RepoRef | null> {
  try {
    const url = await run("git", ["remote", "get-url", "origin"], { cwd });
    return normaliseRemoteUrl(url);
  } catch {
    return null;
  }
}

/** Pick one session by pid or exact name. Throws with a readable reason otherwise. */
export function findSession(sessions: readonly SessionInfo[], selector: string): SessionInfo {
  const trimmed = selector.trim();
  if (/^\d+$/.test(trimmed)) {
    const byPid = sessions.find((session) => session.pid === Number(trimmed));
    if (byPid) return byPid;
  }
  const byName = sessions.filter((session) => session.name === trimmed);
  if (byName.length === 1 && byName[0]) return byName[0];
  if (byName.length > 1) {
    const pids = byName.map((session) => session.pid).join(", ");
    throw new SessionLookupError(
      "ambiguous",
      `Several sessions are named "${trimmed}" (pids ${pids}). Pick one by pid.`,
    );
  }
  throw new SessionLookupError(
    "not-found",
    `No running Claude Code session matches "${trimmed}". Try \`squashflow sessions\`.`,
  );
}

export type SessionLookupReason = "not-found" | "ambiguous";

export class SessionLookupError extends Error {
  override readonly name = "SessionLookupError";

  constructor(
    readonly reason: SessionLookupReason,
    message: string,
  ) {
    super(message);
  }
}
