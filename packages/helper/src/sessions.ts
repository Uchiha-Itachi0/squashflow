/**
 * Session discovery across every Claude account on the machine, repository matching
 * (`git remote get-url origin`), and what tells sessions apart in the picker.
 *
 * `claude agents --json` lists only the sessions of the account it runs as, so the
 * helper starts from the live inbox sockets (`<socket dir>/<pid>.sock`, any account),
 * reads each session's account folder from its own environment (processes.ts), and
 * runs `claude agents --json` once per account folder. A live session no listing names
 * still appears, with what is known about it.
 */

import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { z } from "zod";
import type { SessionAccount } from "@squashflow/shared";
import {
  accountEnv,
  accountFolder,
  configDirOf,
  configuredDirs,
  readAccount,
  type ConfigDir,
} from "./accounts.js";
import type { RunCommand } from "./exec.js";
import { herdrLabels, herdrPlace, placeKey, type HerdrPlace } from "./herdr.js";
import { processReader, type ReadProcess } from "./processes.js";
import { normaliseRemoteUrl, type RepoRef } from "./repo.js";
import { currentBranch, readTranscriptDetail } from "./session-detail.js";
import { checkInboxSocket, inboxSocketDir, inboxSocketPath } from "./socket.js";
import { locateTranscript } from "./transcript.js";

const agentSchema = z.object({
  pid: z.number().int().positive(),
  cwd: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  sessionId: z.string().optional(),
  /** Milliseconds since the epoch. */
  startedAt: z.number().int().positive().optional(),
});

type Agent = z.infer<typeof agentSchema>;

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
  /** The account folder the session runs under; its transcripts are in `<it>/projects`. */
  configDir: string;
  account: SessionAccount | null;
  /** The terminal workspace's name (herdr), when known. Untrusted. */
  terminal: string | null;
}

export interface DiscoveryOptions {
  /** Where inbox sockets are; `SQUASHFLOW_INBOX_SOCKET_DIR` or `/tmp/cc-socks`. */
  socketDir?: string;
  /** The helper's environment: extra account folders, and the base for child programs. */
  env?: NodeJS.ProcessEnv;
  home?: string;
  readProcess?: ReadProcess;
}

/** A session with a live, well-formed inbox socket, and what its environment says. */
interface LiveSession {
  pid: number;
  configDir: ConfigDir;
  herdr: HerdrPlace | null;
}

interface Located {
  agent: Agent;
  configDir: ConfigDir;
}

export async function listSessions(
  run: RunCommand,
  options: DiscoveryOptions = {},
): Promise<SessionInfo[]> {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const live = await liveSessions(
    options.socketDir ?? inboxSocketDir(env),
    options.readProcess ?? processReader(run),
  );
  const dirs = distinct([...live.map((session) => session.configDir), ...configuredDirs(env)]);
  const located = await listAgents(run, dirs, env);
  const byPid = new Map(located.map((entry) => [entry.agent.pid, entry]));
  for (const session of live) {
    if (!byPid.has(session.pid)) {
      byPid.set(session.pid, {
        agent: { pid: session.pid, cwd: "" },
        configDir: session.configDir,
      });
    }
  }
  const livePids = new Map(live.map((session) => [session.pid, session]));
  const places = live.flatMap((session) => (session.herdr === null ? [] : [session.herdr]));
  const [labels, accounts] = await Promise.all([
    places.length === 0 ? new Map<string, string>() : herdrLabels(run, places, env),
    accountsOf(dirs, home),
  ]);
  return Promise.all(
    [...byPid.values()].map(async ({ agent, configDir }) => {
      const place = livePids.get(agent.pid)?.herdr ?? null;
      return describe(run, agent, accountFolder(configDir, home), {
        account: accounts.get(configDir) ?? null,
        terminal: place === null ? null : (labels.get(placeKey(place)) ?? null),
      });
    }),
  );
}

/**
 * Sessions behind the inbox sockets: only sockets that pass the ownership and 0600
 * check, whose pid is still a Claude Code process. Stale sockets of exited sessions
 * stay behind in the folder and are skipped.
 */
async function liveSessions(socketDir: string, readProcess: ReadProcess): Promise<LiveSession[]> {
  const entries = await readdir(socketDir).catch(() => [] as string[]);
  const pids = entries.flatMap((entry) => {
    const match = /^([1-9][0-9]{0,9})\.sock$/.exec(entry);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
  const found = await Promise.all(
    pids.map(async (pid): Promise<LiveSession | null> => {
      try {
        await checkInboxSocket(inboxSocketPath(socketDir, pid));
      } catch {
        return null;
      }
      const info = await readProcess(pid);
      if (info === null || !info.isClaude) return null;
      return {
        pid,
        configDir: configDirOf(info.env.CLAUDE_CONFIG_DIR),
        herdr: herdrPlace(info.env),
      };
    }),
  );
  return found.filter((session) => session !== null).sort((a, b) => a.pid - b.pid);
}

/**
 * `claude agents --json` once per account folder, merged by pid (the first account to
 * list a pid keeps it). One account failing leaves the others; only when every listing
 * fails is the first failure reported.
 */
async function listAgents(
  run: RunCommand,
  dirs: readonly ConfigDir[],
  env: NodeJS.ProcessEnv,
): Promise<Located[]> {
  const results = await Promise.allSettled(
    dirs.map(async (configDir) => {
      const output = await run("claude", ["agents", "--json"], { env: accountEnv(configDir, env) });
      return parseAgents(output).map((agent) => ({ agent, configDir }));
    }),
  );
  const listed = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const [failure] = results.flatMap((result) => (result.status === "rejected" ? [result] : []));
  if (listed.length === 0 && failure !== undefined) throw failure.reason;
  const seen = new Set<number>();
  return listed.flat().filter(({ agent }) => {
    if (seen.has(agent.pid)) return false;
    seen.add(agent.pid);
    return true;
  });
}

function parseAgents(output: string): Agent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    throw new Error("`claude agents --json` did not print JSON. Run `squashflow doctor`.");
  }
  if (!Array.isArray(raw)) throw new Error("`claude agents --json` did not print a list.");
  return raw.flatMap((entry) => {
    const parsed = agentSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

async function accountsOf(
  dirs: readonly ConfigDir[],
  home: string,
): Promise<Map<ConfigDir, SessionAccount | null>> {
  const accounts = await Promise.all(dirs.map((dir) => readAccount(dir, home)));
  return new Map(dirs.map((dir, index) => [dir, accounts[index] ?? null]));
}

async function describe(
  run: RunCommand,
  agent: Agent,
  configDir: string,
  extra: { account: SessionAccount | null; terminal: string | null },
): Promise<SessionInfo> {
  const sessionId = agent.sessionId ?? null;
  const known = agent.cwd !== "";
  const [repo, branch, detail] = await Promise.all([
    known ? repoForFolder(run, agent.cwd) : null,
    known ? currentBranch(run, agent.cwd) : null,
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
    configDir,
    ...extra,
  };
}

function distinct(dirs: readonly ConfigDir[]): ConfigDir[] {
  return [...new Set(dirs)];
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
