/**
 * Following one delivered pin through the session transcript, line by line:
 * Sent -> (Approve in terminal) -> Seen by Claude -> Claude's reply.
 *
 * The reply is the text of Claude's last assistant message in the turn that handled
 * the pin: the turn starts at the peer record carrying the pin id and ends at Claude
 * Code's `turn_duration` notice, or at the next prompt if that notice is missing.
 * Work handed on (to a worker, or a later turn) often settles the pin turns later, so
 * until a reply carries the pin's fixed or blocked line the tracker keeps reading, and
 * the last message of any later turn that names the pin id is a reply too.
 * Only text parts count (no thinking, tool calls or images), subagent (sidechain)
 * records are skipped, and the text is untrusted: it is capped and sent on as plain text.
 * A reply carrying the pin's fixed line (see `findFixedPullRequest`) reports the pull
 * request that fixes it; one carrying the pin's blocked line (see `findBlockedReport`)
 * reports that the session lacks GitHub access. Any other link in a reply means nothing.
 */

import {
  findBlockedReport,
  findFixedPullRequest,
  MAX_REPLY_CHARS,
  type BlockedReport,
} from "@squashflow/shared";
import { classifyTranscriptLine } from "./transcript.js";

/** Lines longer than this are skipped unparsed (request blobs, huge tool output). */
export const MAX_TRANSCRIPT_LINE_CHARS = 1024 * 1024;

export interface Reply {
  text: string;
  truncated: boolean;
  /** The pull request from the pin's fixed line, on the session's repository, if any. */
  pullRequestUrl: string | null;
  /** The session's report that it lacks GitHub access, when the reply carries the blocked line. */
  blocked: BlockedReport | null;
}

export type PinEvent = { kind: "seen" } | { kind: "held" } | { kind: "reply"; reply: Reply };

type Phase = "delivered" | "turn" | "later" | "done";

export class ReplyTracker {
  private phase: Phase = "delivered";
  private messageId: string | null = null;
  private text = "";

  /** `repo` is the session's repository (`owner/name`); a fixed line must point into it. */
  constructor(
    private readonly pinId: string,
    private readonly repo: string | null,
  ) {}

  /** Whether a reply settled the pin (fixed or blocked); nothing more will come. */
  get finished(): boolean {
    return this.phase === "done";
  }

  /** Feed one transcript line; returns what it means for this pin, if anything. */
  feed(line: string): PinEvent | null {
    if (this.phase === "done" || line.length > MAX_TRANSCRIPT_LINE_CHARS) return null;
    if (this.phase === "delivered") {
      const signal = classifyTranscriptLine(line, this.pinId);
      if (signal === "seen") this.phase = "turn";
      return signal === null ? null : { kind: signal };
    }
    const record = parseRecord(line);
    if (record === null || record.isSidechain === true) return null;
    if (record.type === "assistant") {
      this.collect(record);
      return null;
    }
    if (endsTurn(record)) return this.finish();
    return null;
  }

  private collect(record: Record<string, unknown>): void {
    const message = record.message;
    if (!isObject(message)) return;
    const text = textParts(message.content);
    if (text === "") return;
    const id = typeof message.id === "string" ? message.id : null;
    // Claude Code writes one record per content block, all with the message's id.
    const joined = id !== null && id === this.messageId ? `${this.text}\n\n${text}` : text;
    this.messageId = id;
    // Keep one character past the cap, so a cut reply is known to be cut.
    this.text = joined.slice(0, MAX_REPLY_CHARS + 1);
  }

  private finish(): PinEvent | null {
    const handled = this.phase === "turn";
    this.phase = "later";
    const text = cleanText(this.text);
    this.text = "";
    this.messageId = null;
    // After the turn that handled the pin, only a reply that names the pin is about it.
    if (text === "" || (!handled && !text.includes(this.pinId))) return null;
    const truncated = text.length > MAX_REPLY_CHARS;
    const kept = truncated ? text.slice(0, MAX_REPLY_CHARS) : text;
    const reply: Reply = {
      text: kept,
      truncated,
      pullRequestUrl: findFixedPullRequest(kept, this.pinId, this.repo),
      blocked: findBlockedReport(kept, this.pinId),
    };
    if (reply.pullRequestUrl !== null || reply.blocked !== null) this.phase = "done";
    return { kind: "reply", reply };
  }
}

/** The end of the turn: Claude Code's turn timing notice, or the next prompt. */
function endsTurn(record: Record<string, unknown>): boolean {
  if (record.type === "system") return record.subtype === "turn_duration";
  // Another peer message queued mid-turn is handled in the same turn, so it does not end it.
  if (record.type !== "user" || record.isMeta === true || isObject(record.origin)) return false;
  const message = record.message;
  if (!isObject(message)) return false;
  const { content } = message;
  if (typeof content === "string") return true;
  // Tool results come back as user records inside the same turn.
  return Array.isArray(content) && content.some((part) => isObject(part) && part.type === "text");
}

function textParts(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: unknown) =>
      isObject(part) && part.type === "text" && typeof part.text === "string"
        ? [part.text.trim()]
        : [],
    )
    .filter((text) => text !== "")
    .join("\n\n");
}

/** Drop control characters other than newline and tab; the text is shown as plain text. */
function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
}

function parseRecord(line: string): Record<string, unknown> | null {
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
