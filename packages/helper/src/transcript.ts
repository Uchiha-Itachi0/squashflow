/**
 * Delivery confirmation from the session transcript (JSONL). The inbox socket
 * sends no acknowledgement, so the transcript is the source of truth:
 * - a `user` record with a peer origin carrying the pin marker -> Seen by Claude
 * - a `system` "Held peer message" notice carrying the marker -> Approve in terminal
 * Claude's reply after that is picked out by `ReplyTracker` (reply.ts).
 */

import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TRANSCRIPT_POLL_MS } from "./constants.js";

export type TranscriptSignal = "seen" | "held";

const HELD_NOTICE = "Held peer message";

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLAUDE_CONFIG_DIR;
  if (override !== undefined && override !== "") return override;
  return join(homedir(), ".claude");
}

/** Claude Code names a project folder after the cwd with every non-alphanumeric character as `-`. */
export function projectFolderName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export async function locateTranscript(
  configDir: string,
  cwd: string,
  sessionId: string,
): Promise<string> {
  const projects = join(configDir, "projects");
  const expected = join(projects, projectFolderName(cwd), `${sessionId}.jsonl`);
  if (await exists(expected)) return expected;
  const folders = await readdir(projects).catch(() => [] as string[]);
  for (const folder of folders) {
    const candidate = join(projects, folder, `${sessionId}.jsonl`);
    if (await exists(candidate)) return candidate;
  }
  return expected;
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/**
 * The pin id itself is the marker. Held-message previews strip punctuation such
 * as the brackets around it, so match the bare id, which is random and unique.
 */
export function classifyTranscriptLine(line: string, pinId: string): TranscriptSignal | null {
  const marker = pinId;
  if (!line.includes(marker)) return null;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(record)) return null;
  if (record.type === "user" && isObject(record.origin) && record.origin.kind === "peer") {
    return textOf(record.origin.body).includes(marker) || contentText(record).includes(marker)
      ? "seen"
      : null;
  }
  if (record.type === "system" && typeof record.content === "string") {
    return record.content.includes(HELD_NOTICE) && record.content.includes(marker) ? "held" : null;
  }
  return null;
}

export interface TranscriptWatch {
  stop(): void;
}

/**
 * Poll the transcript from `startOffset`, handing over each complete line appended
 * after it. Lines written before delivery are never read.
 */
export function watchTranscript(
  path: string,
  startOffset: number,
  onLine: (line: string) => void,
  pollMs: number = TRANSCRIPT_POLL_MS,
): TranscriptWatch {
  let offset = startOffset;
  let pending = "";
  let stopped = false;
  let reading = false;
  const isStopped = (): boolean => stopped;

  const tick = async (): Promise<void> => {
    if (stopped || reading) return;
    reading = true;
    try {
      const size = await fileSize(path);
      if (size <= offset) return;
      const handle = await open(path, "r");
      try {
        const buffer = Buffer.alloc(size - offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        offset += bytesRead;
        pending += buffer.subarray(0, bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (isStopped()) break;
        onLine(line);
      }
    } catch {
      // The transcript may not exist yet or be mid-rotation; the next tick retries.
    } finally {
      reading = false;
    }
  };

  const timer = setInterval(() => void tick(), pollMs);
  void tick();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function contentText(record: Record<string, unknown>): string {
  const message = record.message;
  if (!isObject(message)) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) => (isObject(part) && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
