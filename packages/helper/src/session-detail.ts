/**
 * What tells one session from another in the picker, read from sources the helper
 * already reads: the session's title and last activity from its transcript, and its
 * branch from git. All of it is untrusted text, cleaned to one line and capped.
 *
 * The title is Claude Code's own (a `custom-title` from /rename, else its `ai-title`,
 * else a `summary`), or failing those the start of the first prompt the user typed.
 * Only the transcript's head and tail are read, so a long session costs the same as a
 * short one, and no other transcript content leaves this module.
 */

import { open, stat } from "node:fs/promises";
import { MAX_BRANCH_CHARS, MAX_SESSION_TITLE_CHARS } from "@squashflow/shared";
import type { RunCommand } from "./exec.js";

/** How much of each end of the transcript is read for the title. */
export const TITLE_SCAN_BYTES = 256 * 1024;

export interface TranscriptDetail {
  title: string | null;
  lastActiveAt: string | null;
}

/** Title kinds, strongest first: a user's rename beats Claude Code's own title. */
const TITLE_FIELDS = [
  ["custom-title", "customTitle"],
  ["ai-title", "aiTitle"],
  ["summary", "summary"],
] as const;

export async function readTranscriptDetail(path: string): Promise<TranscriptDetail> {
  let size: number;
  let modified: Date;
  try {
    const info = await stat(path);
    size = info.size;
    modified = info.mtime;
  } catch {
    return { title: null, lastActiveAt: null };
  }
  const lastActiveAt = modified.toISOString();
  try {
    const tail = await readSlice(path, Math.max(0, size - TITLE_SCAN_BYTES), size);
    const fromTail = titleRecord(completeLines(tail, size > TITLE_SCAN_BYTES));
    if (fromTail !== null) return { title: fromTail, lastActiveAt };
    if (size <= TITLE_SCAN_BYTES) {
      return { title: firstPrompt(completeLines(tail, false)), lastActiveAt };
    }
    const head = completeLines(await readSlice(path, 0, TITLE_SCAN_BYTES), false, true);
    return { title: titleRecord(head) ?? firstPrompt(head), lastActiveAt };
  } catch {
    return { title: null, lastActiveAt };
  }
}

/** The branch checked out in `cwd`, or null when detached, not a repository, or odd. */
export async function currentBranch(run: RunCommand, cwd: string): Promise<string | null> {
  try {
    const branch = cleanLine(await run("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd }));
    if (branch === "" || branch.length > MAX_BRANCH_CHARS || !/^[\w./+@-]+$/.test(branch)) {
      return null;
    }
    return branch;
  } catch {
    return null;
  }
}

/** Tidy untrusted text for one line of the picker: no control characters, capped. */
export function cleanTitle(raw: string): string | null {
  return cleanText(raw, MAX_SESSION_TITLE_CHARS);
}

/** Untrusted text as one plain line of at most `max` characters, or null when empty. */
export function cleanText(raw: string, max: number): string | null {
  const text = cleanLine(raw);
  if (text === "") return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function cleanLine(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function readSlice(path: string, from: number, to: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** Whole lines only: drop a partial first line (cut start) and a partial last line (cut end). */
function completeLines(text: string, cutStart: boolean, cutEnd = false): string[] {
  const lines = text.split("\n");
  if (cutStart) lines.shift();
  if (cutEnd) lines.pop();
  return lines;
}

/** The strongest title in these lines; within one kind the latest wins. */
function titleRecord(lines: readonly string[]): string | null {
  const latest = new Map<string, string>();
  for (const line of lines) {
    if (!line.includes("title") && !line.includes('"summary"')) continue;
    const record = parse(line);
    if (record === null) continue;
    for (const [type, field] of TITLE_FIELDS) {
      const value = record[field];
      if (record.type !== type || typeof value !== "string") continue;
      const title = cleanTitle(value);
      if (title !== null) latest.set(type, title);
    }
  }
  for (const [type] of TITLE_FIELDS) {
    const title = latest.get(type);
    if (title !== undefined) return title;
  }
  return null;
}

/**
 * The first prompt the user typed: not a peer message (Squashflow's own pins), not a
 * meta record, not a subagent's, and not Claude Code's own wrapped command output.
 */
function firstPrompt(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (!line.includes('"type":"user"')) continue;
    const record = parse(line);
    if (record?.type !== "user" || record.isMeta === true || record.isSidechain === true) continue;
    if (isObject(record.origin)) continue;
    const text = promptText(record.message);
    if (text === null || text.trimStart().startsWith("<")) continue;
    const title = cleanTitle(text);
    if (title !== null) return title;
  }
  return null;
}

function promptText(message: unknown): string | null {
  if (!isObject(message)) return null;
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const part = content.find(
    (item: unknown) => isObject(item) && item.type === "text" && typeof item.text === "string",
  ) as { text: string } | undefined;
  return part?.text ?? null;
}

function parse(line: string): Record<string, unknown> | null {
  try {
    const record: unknown = JSON.parse(line);
    return isObject(record) ? record : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
