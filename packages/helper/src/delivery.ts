/**
 * Pin delivery shared by `POST /pins` and `squashflow send`: build a draft the
 * user previews, deliver exactly that draft to the session inbox socket, then
 * follow the transcript from Sent to Seen by Claude (or Approve in terminal).
 */

import { randomBytes } from "node:crypto";
import { buildMessage, digestMessage, wrapForInbox, type PinSource } from "./message.js";
import type { PinInput } from "./schemas.js";
import type { SessionInfo } from "./sessions.js";
import { inboxSocketPath, writeToInbox } from "./socket.js";
import {
  fileSize,
  locateTranscript,
  watchTranscript,
  type TranscriptSignal,
  type TranscriptWatch,
} from "./transcript.js";

const DRAFT_TTL_MS = 10 * 60 * 1000;

export type PinStatus = "sent" | "approve-in-terminal" | "seen";

export const STATUS_LABELS: Record<PinStatus, string> = {
  sent: "Sent",
  "approve-in-terminal": "Approve in terminal",
  seen: "Seen by Claude",
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

export interface PinRecord {
  id: string;
  number: number;
  sessionPid: number;
  sessionName: string;
  status: PinStatus;
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryOptions {
  socketDir: string;
  claudeConfigDir: string;
  senderSocketPath: string;
  now?: () => number;
  pollMs?: number;
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
   * Take a previewed draft for delivery. The content is rebuilt and must hash to
   * the previewed digest, so only the exact message the user saw is delivered.
   */
  takeDraft(pinId: string, digest: string, pageUrl: string, pins: readonly PinInput[]): Draft {
    this.dropExpiredDrafts();
    const draft = this.drafts.get(pinId);
    if (!draft) throw new Error("No preview with that pin id; preview the message again.");
    const rebuilt = buildMessage({ pinId, source: draft.source, pageUrl, pins });
    if (digestMessage(rebuilt) !== digest || digest !== draft.digest) {
      throw new Error("The message changed since it was previewed; preview it again.");
    }
    this.drafts.delete(pinId);
    return draft;
  }

  async deliver(draft: Draft): Promise<PinRecord> {
    const { session } = draft;
    if (session.sessionId === null) {
      throw new Error(
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
    };
    this.publish(record);
    const watch = watchTranscript(
      transcript,
      draft.pinId,
      startOffset,
      (signal) => {
        this.onSignal(draft.pinId, signal);
      },
      this.options.pollMs,
    );
    this.watches.set(draft.pinId, watch);
    return record;
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

  private onSignal(pinId: string, signal: TranscriptSignal): void {
    const current = this.pins.get(pinId);
    if (!current || current.status === "seen") return;
    const status: PinStatus = signal === "seen" ? "seen" : "approve-in-terminal";
    if (status === current.status) return;
    this.publish({
      ...current,
      status,
      statusLabel: STATUS_LABELS[status],
      updatedAt: new Date(this.now()).toISOString(),
    });
    if (status === "seen") {
      this.watches.get(pinId)?.stop();
      this.watches.delete(pinId);
    }
  }

  private publish(record: PinRecord): void {
    this.pins.set(record.id, record);
    for (const listener of this.listeners) listener(record);
  }

  private dropExpiredDrafts(): void {
    const now = this.now();
    for (const [id, draft] of this.drafts) {
      if (draft.expiresAt <= now) this.drafts.delete(id);
    }
  }
}
