/**
 * Pin delivery shared by `POST /pins` and `squashflow send`: build a draft the
 * user previews, deliver exactly that draft to the session inbox socket, then
 * follow the transcript from Sent to Seen by Claude (or Approve in terminal) and
 * on to Claude's reply, which moves the pin to Fixed when it links a pull request.
 */

import { randomBytes } from "node:crypto";
import type { PinRecord, PinStatus } from "@squashflow/shared";
import { TRANSCRIPT_WATCH_MAX_MS } from "./constants.js";
import { ReplyTracker, type PinEvent, type Reply } from "./reply.js";
import { buildMessage, digestMessage, wrapForInbox, type PinSource } from "./message.js";
import type { PinInput } from "./schemas.js";
import type { SessionInfo } from "./sessions.js";
import { inboxSocketPath, writeToInbox } from "./socket.js";
import { fileSize, locateTranscript, watchTranscript, type TranscriptWatch } from "./transcript.js";

const DRAFT_TTL_MS = 10 * 60 * 1000;

export type { PinRecord, PinStatus } from "@squashflow/shared";

export const STATUS_LABELS: Record<PinStatus, string> = {
  sent: "Sent",
  "approve-in-terminal": "Approve in terminal",
  seen: "Seen by Claude",
  fixed: "Fixed",
  blocked: "Blocked: not picked up",
};

export interface Draft {
  pinId: string;
  session: SessionInfo;
  source: PinSource;
  pageUrl: string | undefined;
  pins: readonly PinInput[];
  message: string;
  digest: string;
  expiresAt: number;
}

export type DraftErrorReason = "missing" | "changed" | "no-session-id";

export class DraftError extends Error {
  override readonly name = "DraftError";

  constructor(
    readonly reason: DraftErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export interface DeliveryOptions {
  socketDir: string;
  claudeConfigDir: string;
  senderSocketPath: string;
  now?: () => number;
  pollMs?: number;
  /** Stop following a pin after this long with nothing new in its transcript. */
  watchMaxMs?: number;
}

export type PinListener = (pin: PinRecord) => void;

export class DeliveryService {
  private readonly drafts = new Map<string, Draft>();
  private readonly pins = new Map<string, PinRecord>();
  private readonly watches = new Map<string, TranscriptWatch>();
  private readonly listeners = new Set<PinListener>();
  private nextNumber = 1;
  private readonly now: () => number;

  constructor(private readonly options: DeliveryOptions) {
    this.now = options.now ?? Date.now;
  }

  createDraft(
    session: SessionInfo,
    source: PinSource,
    pageUrl: string | undefined,
    pins: readonly PinInput[],
  ): Draft {
    this.dropExpiredDrafts();
    const pinId = `sf-${randomBytes(6).toString("hex")}`;
    const message = buildMessage({ pinId, source, pageUrl, pins });
    const draft: Draft = {
      pinId,
      session,
      source,
      pageUrl,
      pins,
      message,
      digest: digestMessage(message),
      expiresAt: this.now() + DRAFT_TTL_MS,
    };
    this.drafts.set(pinId, draft);
    return draft;
  }

  /**
   * Find a previewed draft for delivery. The content is rebuilt and must hash to
   * the previewed digest, so only the exact message the user saw is delivered.
   * The draft is consumed by a successful `deliver`.
   */
  verifyDraft(pinId: string, digest: string, pageUrl: string, pins: readonly PinInput[]): Draft {
    this.dropExpiredDrafts();
    const draft = this.drafts.get(pinId);
    if (!draft) {
      throw new DraftError("missing", "No preview with that pin id; preview the message again.");
    }
    const rebuilt = buildMessage({ pinId, source: draft.source, pageUrl, pins });
    if (digestMessage(rebuilt) !== digest || digest !== draft.digest) {
      throw new DraftError(
        "changed",
        "The message changed since it was previewed; preview it again.",
      );
    }
    return draft;
  }

  async deliver(draft: Draft): Promise<PinRecord> {
    this.drafts.delete(draft.pinId);
    try {
      return await this.deliverOnce(draft);
    } catch (error) {
      this.drafts.set(draft.pinId, draft);
      throw error;
    }
  }

  private async deliverOnce(draft: Draft): Promise<PinRecord> {
    const { session } = draft;
    if (session.sessionId === null) {
      throw new DraftError(
        "no-session-id",
        `Session ${session.name} has no session id, so delivery cannot be confirmed.`,
      );
    }
    const transcript = await locateTranscript(
      this.options.claudeConfigDir,
      session.cwd,
      session.sessionId,
    );
    const startOffset = await fileSize(transcript);
    const content = wrapForInbox(draft.message, this.options.senderSocketPath);
    await writeToInbox(inboxSocketPath(this.options.socketDir, session.pid), content);

    const stamp = new Date(this.now()).toISOString();
    const record: PinRecord = {
      id: draft.pinId,
      number: this.nextNumber++,
      sessionPid: session.pid,
      sessionName: session.name,
      status: "sent",
      statusLabel: STATUS_LABELS.sent,
      createdAt: stamp,
      updatedAt: stamp,
      thread: [],
      pullRequestUrl: null,
      following: true,
      revision: 0,
    };
    this.follow(draft.pinId, transcript, startOffset);
    return this.publish(record);
  }

  /**
   * Follow the transcript until Claude's reply, or until it has been quiet for the
   * watch lifetime (session gone, held message rejected). The lifetime restarts on
   * every new line, so a long piece of work in a busy session is still followed.
   */
  private follow(pinId: string, transcript: string, startOffset: number): void {
    const tracker = new ReplyTracker(pinId);
    const lifetime = this.options.watchMaxMs ?? TRANSCRIPT_WATCH_MAX_MS;
    const expire = (): void => {
      this.onQuiet(pinId);
    };
    let expiry = setTimeout(expire, lifetime);
    expiry.unref();
    const watch = watchTranscript(
      transcript,
      startOffset,
      (line) => {
        clearTimeout(expiry);
        expiry = setTimeout(expire, lifetime);
        expiry.unref();
        const event = tracker.feed(line);
        if (tracker.finished) this.stopWatch(pinId);
        if (event !== null) this.onEvent(pinId, event);
        else if (tracker.finished) this.republish(pinId);
      },
      this.options.pollMs,
    );
    this.watches.set(pinId, {
      stop: () => {
        clearTimeout(expiry);
        watch.stop();
      },
    });
  }

  get(pinId: string): PinRecord | undefined {
    return this.pins.get(pinId);
  }

  subscribe(listener: PinListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    for (const watch of this.watches.values()) watch.stop();
    this.watches.clear();
    this.listeners.clear();
  }

  private onEvent(pinId: string, event: PinEvent): void {
    const current = this.pins.get(pinId);
    if (!current) return;
    if (event.kind === "reply") {
      this.onReply(current, event.reply);
      return;
    }
    if (current.status === "seen") return;
    const status: PinStatus = event.kind === "seen" ? "seen" : "approve-in-terminal";
    if (status !== current.status) this.publish(this.withStatus(current, status));
  }

  private onReply(current: PinRecord, reply: Reply): void {
    const at = new Date(this.now()).toISOString();
    const message = {
      id: `${current.id}-${current.thread.length + 1}`,
      from: "claude" as const,
      text: reply.text,
      truncated: reply.truncated,
      at,
    };
    const fixed = reply.pullRequestUrl !== null;
    const next: PinRecord = {
      ...(fixed ? this.withStatus(current, "fixed") : current),
      thread: [...current.thread, message],
      pullRequestUrl: reply.pullRequestUrl ?? current.pullRequestUrl,
      updatedAt: at,
    };
    this.publish(next);
  }

  /** Quiet for the whole watch lifetime: a pin never picked up is Blocked. */
  private onQuiet(pinId: string): void {
    this.stopWatch(pinId);
    const current = this.pins.get(pinId);
    if (current?.status === "sent" || current?.status === "approve-in-terminal") {
      this.publish(this.withStatus(current, "blocked"));
    } else {
      this.republish(pinId);
    }
  }

  /** Publish the pin again after the watch stopped, so clients see it is no longer followed. */
  private republish(pinId: string): void {
    const current = this.pins.get(pinId);
    if (current) this.publish(current);
  }

  private withStatus(current: PinRecord, status: PinStatus): PinRecord {
    return {
      ...current,
      status,
      statusLabel: STATUS_LABELS[status],
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private stopWatch(pinId: string): void {
    this.watches.get(pinId)?.stop();
    this.watches.delete(pinId);
  }

  private publish(record: PinRecord): PinRecord {
    const next = {
      ...record,
      following: this.watches.has(record.id),
      revision: (this.pins.get(record.id)?.revision ?? -1) + 1,
    };
    this.pins.set(next.id, next);
    for (const listener of this.listeners) listener(next);
    return next;
  }

  private dropExpiredDrafts(): void {
    const now = this.now();
    for (const [id, draft] of this.drafts) {
      if (draft.expiresAt <= now) this.drafts.delete(id);
    }
  }
}
