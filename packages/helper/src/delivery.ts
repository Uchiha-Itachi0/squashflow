/**
 * Pin delivery shared by `POST /pins` and `squashflow send`: build a draft the
 * user previews, deliver exactly that draft to the session inbox socket, then
 * follow the transcript from Sent to Seen by Claude (or Approve in terminal) and
 * on to Claude's reply, which moves the pin to Fixed when it links a pull request, or to
 * Blocked: GitHub access when it carries the pin's blocked line. A pin blocked on GitHub
 * access can be sent previewed follow-ups (retry, fork, patch) to the same session.
 */

import { randomBytes } from "node:crypto";
import {
  buildFollowUp,
  type FollowUpAction,
  type PinBlock,
  type PinRecord,
  type PinStatus,
} from "@squashflow/shared";
import { TRANSCRIPT_WATCH_MAX_MS } from "./constants.js";
import { ReplyTracker, type PinEvent, type Reply } from "./reply.js";
import { buildMessage, digestMessage, wrapForInbox, type PinSource } from "./message.js";
import type { PinInput } from "./schemas.js";
import { screenshotFiles, writeScreenshotFiles, type ScreenshotFile } from "./screenshots.js";
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

const GITHUB_ACCESS_LABEL = "Blocked: GitHub access";
const NOT_PICKED_UP: PinBlock = { kind: "not-picked-up", reason: null };

export interface Draft {
  pinId: string;
  session: SessionInfo;
  source: PinSource;
  pageUrl: string | undefined;
  /** The pins without their screenshots' image data, which the send carries again. */
  pins: readonly PinInput[];
  message: string;
  digest: string;
  expiresAt: number;
}

/** A previewed draft whose send matched it, with the screenshots that send carried. */
export interface VerifiedDraft {
  draft: Draft;
  screenshots: readonly ScreenshotFile[];
}

export interface FollowUpDraft {
  pinId: string;
  action: FollowUpAction;
  message: string;
  digest: string;
  expiresAt: number;
}

export type DraftErrorReason =
  "missing" | "changed" | "no-session-id" | "unknown-pin" | "not-blocked";

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
  /** Where region screenshots are written; without it, pins with screenshots are refused. */
  screenshotDir?: string;
  now?: () => number;
  pollMs?: number;
  /** Stop following a pin after this long with nothing new in its transcript. */
  watchMaxMs?: number;
}

export type PinListener = (pin: PinRecord) => void;

export class DeliveryService {
  private readonly drafts = new Map<string, Draft>();
  /** The latest previewed follow-up per pin. */
  private readonly followUps = new Map<string, FollowUpDraft>();
  /** The session each pin was delivered to, so follow-ups go to the same one. */
  private readonly sessions = new Map<string, SessionInfo>();
  /** The block to return to after a patch request is answered without a new outcome. */
  private readonly resumeBlocked = new Map<string, PinBlock>();
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
    const message = buildMessage({
      pinId,
      source,
      pageUrl,
      pins,
      screenshots: this.screenshotsFor(pinId, pins).map((file) => file.reference),
    });
    const draft: Draft = {
      pinId,
      session,
      source,
      pageUrl,
      // Kept for up to 10 minutes per preview, so without the images.
      pins: pins.map(({ comment, context }) =>
        context === undefined ? { comment } : { comment, context },
      ),
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
   * The draft is consumed by a successful `deliver`. The message names each screenshot
   * with its hash, so the screenshots this send carries are the ones that were previewed.
   */
  verifyDraft(
    pinId: string,
    digest: string,
    pageUrl: string,
    pins: readonly PinInput[],
  ): VerifiedDraft {
    this.dropExpiredDrafts();
    const draft = this.drafts.get(pinId);
    if (!draft) {
      throw new DraftError("missing", "No preview with that pin id; preview the message again.");
    }
    const screenshots = this.screenshotsFor(pinId, pins);
    const rebuilt = buildMessage({
      pinId,
      source: draft.source,
      pageUrl,
      pins,
      screenshots: screenshots.map((file) => file.reference),
    });
    if (digestMessage(rebuilt) !== digest || digest !== draft.digest) {
      throw new DraftError(
        "changed",
        "The message changed since it was previewed; preview it again.",
      );
    }
    return { draft, screenshots };
  }

  private screenshotsFor(pinId: string, pins: readonly PinInput[]): ScreenshotFile[] {
    const dir = this.options.screenshotDir;
    if (dir !== undefined) return screenshotFiles(dir, pinId, pins);
    if (pins.some((pin) => pin.screenshot !== undefined)) {
      throw new Error("This helper does not accept region screenshots here.");
    }
    return [];
  }

  async deliver(draft: Draft, screenshots: readonly ScreenshotFile[] = []): Promise<PinRecord> {
    this.drafts.delete(draft.pinId);
    try {
      return await this.deliverOnce(draft, screenshots);
    } catch (error) {
      this.drafts.set(draft.pinId, draft);
      throw error;
    }
  }

  private async deliverOnce(
    draft: Draft,
    screenshots: readonly ScreenshotFile[],
  ): Promise<PinRecord> {
    const { session } = draft;
    if (this.options.screenshotDir !== undefined) {
      await writeScreenshotFiles(this.options.screenshotDir, draft.pinId, screenshots);
    }
    await this.writeAndFollow(draft.pinId, session, draft.message);
    this.sessions.set(draft.pinId, session);
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
      blocked: null,
      following: true,
      revision: 0,
    };
    return this.publish(record);
  }

  /** Write a message to the session's inbox and follow its transcript from there. */
  private async writeAndFollow(
    pinId: string,
    session: SessionInfo,
    message: string,
  ): Promise<void> {
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
    const content = wrapForInbox(message, this.options.senderSocketPath);
    await writeToInbox(inboxSocketPath(this.options.socketDir, session.pid), content);
    this.follow(pinId, transcript, startOffset, session.repo?.fullName ?? null);
  }

  /** The session a pin was delivered to. */
  sessionOf(pinId: string): SessionInfo | undefined {
    return this.sessions.get(pinId);
  }

  /** Build a follow-up for a pin blocked on GitHub access; the user previews it first. */
  createFollowUp(pinId: string, action: FollowUpAction): FollowUpDraft {
    this.blockedOnGitHub(pinId);
    const message = buildFollowUp(pinId, action);
    const draft: FollowUpDraft = {
      pinId,
      action,
      message,
      digest: digestMessage(message),
      expiresAt: this.now() + DRAFT_TTL_MS,
    };
    this.followUps.set(pinId, draft);
    return draft;
  }

  /** Find the previewed follow-up; only the exact message the user saw is delivered. */
  verifyFollowUp(pinId: string, action: FollowUpAction, digest: string): FollowUpDraft {
    this.blockedOnGitHub(pinId);
    const draft = this.followUps.get(pinId);
    if (draft === undefined || draft.expiresAt <= this.now()) {
      this.followUps.delete(pinId);
      throw new DraftError("missing", "No preview of that follow-up; preview it again.");
    }
    if (draft.action !== action || draft.digest !== digest) {
      throw new DraftError("changed", "The follow-up changed since it was previewed.");
    }
    return draft;
  }

  /** Deliver a previewed follow-up to the pin's session and follow the pin again. */
  async deliverFollowUp(draft: FollowUpDraft, session: SessionInfo): Promise<PinRecord> {
    const current = this.blockedOnGitHub(draft.pinId);
    this.followUps.delete(draft.pinId);
    await this.writeAndFollow(draft.pinId, session, draft.message);
    if (draft.action === "patch" && current.blocked !== null) {
      this.resumeBlocked.set(draft.pinId, current.blocked);
    } else {
      this.resumeBlocked.delete(draft.pinId);
    }
    return this.publish(this.withStatus(current, "sent"));
  }

  /** The pin, if it is Blocked: GitHub access and no longer followed; throws otherwise. */
  private blockedOnGitHub(pinId: string): PinRecord {
    const current = this.pins.get(pinId);
    if (current === undefined) throw new DraftError("unknown-pin", "No pin with that id.");
    if (current.blocked?.kind !== "github-access" || this.watches.has(pinId)) {
      throw new DraftError("not-blocked", "Follow-ups are only for pins blocked on GitHub access.");
    }
    return current;
  }

  /**
   * Follow the transcript until Claude's reply, or until it has been quiet for the
   * watch lifetime (session gone, held message rejected). The lifetime restarts on
   * every new line, so a long piece of work in a busy session is still followed.
   */
  private follow(
    pinId: string,
    transcript: string,
    startOffset: number,
    repo: string | null,
  ): void {
    const tracker = new ReplyTracker(pinId, repo);
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
    const resume = this.resumeBlocked.get(current.id);
    this.resumeBlocked.delete(current.id);
    const after = this.afterReply(current, reply, resume);
    const next: PinRecord = {
      ...after,
      thread: [...current.thread, message],
      // Only a reply that fixes the pin sets its link; a blocked reply may mention others.
      pullRequestUrl: after.status === "fixed" ? reply.pullRequestUrl : current.pullRequestUrl,
      updatedAt: at,
    };
    this.publish(next);
  }

  /**
   * The status a reply leads to. The blocked line wins over the fixed line, since a session
   * that reports no access has not opened this pin's pull request. A reply to a patch request
   * that reports neither returns the pin to the block it was in.
   */
  private afterReply(current: PinRecord, reply: Reply, resume: PinBlock | undefined): PinRecord {
    if (reply.blocked !== null) {
      return this.withStatus(current, "blocked", {
        kind: "github-access",
        reason: reply.blocked.reason,
      });
    }
    if (reply.pullRequestUrl !== null) return this.withStatus(current, "fixed");
    if (resume !== undefined) return this.withStatus(current, "blocked", resume);
    return current;
  }

  /** Quiet for the whole watch lifetime: a pin never picked up is Blocked. */
  private onQuiet(pinId: string): void {
    this.stopWatch(pinId);
    this.resumeBlocked.delete(pinId);
    const current = this.pins.get(pinId);
    if (current?.status === "sent" || current?.status === "approve-in-terminal") {
      this.publish(this.withStatus(current, "blocked", NOT_PICKED_UP));
    } else {
      this.republish(pinId);
    }
  }

  /** Publish the pin again after the watch stopped, so clients see it is no longer followed. */
  private republish(pinId: string): void {
    const current = this.pins.get(pinId);
    if (current) this.publish(current);
  }

  private withStatus(
    current: PinRecord,
    status: PinStatus,
    blocked: PinBlock | null = null,
  ): PinRecord {
    const kept = status === "blocked" ? blocked : null;
    return {
      ...current,
      status,
      statusLabel: kept?.kind === "github-access" ? GITHUB_ACCESS_LABEL : STATUS_LABELS[status],
      blocked: kept,
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
