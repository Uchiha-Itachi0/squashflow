/**
 * The local half of a pin that is Blocked: GitHub access: the patch to copy and the
 * message for the repository owner. Both come from Claude's replies, which are untrusted
 * text; they only ever go to the clipboard, where the user reads them before using them.
 */

import { BLOCKED_MARKER, type ThreadMessage } from "@squashflow/shared";

/** Most characters of Claude's summary kept in the owner message. */
export const MAX_SUMMARY_CHARS = 2000;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;

/**
 * The patch in a reply: the last fenced block marked `diff` or `patch` that reads as a
 * unified diff. A cut reply has no complete patch, so it yields none.
 */
export function extractPatch(message: Pick<ThreadMessage, "text" | "truncated">): string | null {
  if (message.truncated) return null;
  let patch: string | null = null;
  let open: { fence: string; info: string; lines: string[] } | null = null;
  for (const line of message.text.split(/\r?\n/)) {
    const match = FENCE.exec(line);
    if (open === null) {
      if (match?.[1] !== undefined) open = { fence: match[1], info: match[2] ?? "", lines: [] };
      continue;
    }
    const closes =
      match?.[1] !== undefined &&
      match[1][0] === open.fence[0] &&
      match[1].length >= open.fence.length;
    if (!closes) {
      open.lines.push(line);
      continue;
    }
    const body = `${open.lines.join("\n")}\n`;
    if (/^(diff|patch)$/i.test(open.info) && looksLikeDiff(body)) patch = body;
    open = null;
  }
  return patch;
}

function looksLikeDiff(body: string): boolean {
  return /^(diff --git |--- )/m.test(body) && /^\+\+\+ /m.test(body) && /^@@ /m.test(body);
}

/**
 * What Claude said about the change, for the owner: the reply that reported the block,
 * without the blocked line or code blocks, capped.
 */
export function changeSummary(thread: readonly ThreadMessage[]): string {
  const report =
    [...thread].reverse().find((message) => message.text.includes(`${BLOCKED_MARKER} [`)) ??
    thread.at(-1);
  if (report === undefined) return "";
  const kept: string[] = [];
  let inFence: string | null = null;
  for (const line of report.text.split(/\r?\n/)) {
    const fence = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      inFence = inFence === null ? fence : null;
      continue;
    }
    if (inFence === null && !line.startsWith(BLOCKED_MARKER)) kept.push(line);
  }
  const summary = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS)}…` : summary;
}

export interface OwnerMessageInput {
  /** The page the pin is on. */
  pageUrl: string;
  comment: string;
  /** Claude's summary of the change; may be empty. */
  summary: string;
  /** Whether a patch is available to share. */
  hasPatch: boolean;
}

/** A ready-made message asking the repository owner to make the change. */
export function buildOwnerMessage({
  pageUrl,
  comment,
  summary,
  hasPatch,
}: OwnerMessageInput): string {
  return [
    `Hi! While reviewing ${pageUrl} I'd like this changed:`,
    "",
    quote(comment),
    "",
    ...(summary === "" ? [] : ["The change I prepared:", "", quote(summary), ""]),
    "I don't have access to push a branch or open a pull request on this repository.",
    hasPatch
      ? "Could you make this change, or give me access? I can send you the patch."
      : "Could you make this change, or give me access to open a pull request?",
  ].join("\n");
}

function quote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}
