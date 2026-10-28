/**
 * Sending pins to a Claude Code session from the side panel: pairing, the session picker
 * and preview-then-send, also for the user's follow-ups on a sent pin and the follow-ups
 * to a pin blocked on GitHub access. All helper calls go through the service worker.
 * When the helper is not running, not paired, or no session fits, copy stays available
 * and the panel says why.
 */

import {
  DEFAULT_HELPER_PORT,
  MAX_COMMENT_CHARS,
  type FollowUpAction,
  type PublicSession,
} from "@squashflow/shared";
import type { HelperFailure } from "../helper/errors";
import { matchSessions } from "../helper/matching";
import { siteOf } from "../helper/sites";
import type { AskWorker, ConnectionStatus } from "../helper/messages";
import type { OutgoingPins } from "../helper/client";
import type { PinTracking } from "../status/pin-status";
import type { StoredPin } from "../store/pins";

export type ConnectionView = { state: "checking"; port: number } | ConnectionStatus;

interface PreviewBase {
  /** The session that will receive the message. */
  sessionName: string;
  pinId: string;
  digest: string;
  message: string;
}

/** Pins about to be sent to the chosen session. */
export interface PinsPreview extends PreviewBase {
  kind: "pins";
  outgoing: OutgoingPins;
  /** The extension's own ids of the pins in the message, in order. */
  localPinIds: readonly string[];
  /** Set for the user's follow-up on one sent pin: what they typed. */
  followUp: string | null;
}

/** A follow-up about to be sent to the session that has the pin. */
export interface FollowUpPreview extends PreviewBase {
  kind: "follow-up";
  /** The extension's own id of the pin the follow-up is about. */
  localPinId: string;
  action: FollowUpAction;
}

export type PendingPreview = PinsPreview | FollowUpPreview;

export const FOLLOW_UP_LABELS: Record<FollowUpAction, string> = {
  retry: "Retry after logging in",
  fork: "Fork and open a PR",
  patch: "Ask for the patch",
};

export interface SendState {
  connection: ConnectionView;
  pairingOpen: boolean;
  sessions: readonly PublicSession[];
  /** The repository remembered for this site. */
  repo: string | null;
  /** Sessions on that repository. */
  matchingPids: readonly number[];
  /**
   * The session pins go to: the one the user picked on this site, or else the only
   * session on the site's repository. A pick made on another site, or a session that is
   * merely the only one running, never counts: with no pick here and not exactly one
   * match, nothing is selected and Send stays disabled until the user picks.
   */
  selectedPid: number | null;
  /** Why there is nothing to send to, with what to do instead. */
  note: string | null;
  preview: PendingPreview | null;
  busy: boolean;
}

export interface SendFlowHooks {
  ask: AskWorker;
  /** The page the pins are on, without its fragment; null with no page open. */
  pageUrl: () => string | null;
  onChange: () => void;
  report: (text: string, outcome: "ok" | "error") => void;
}

export class SendFlow {
  private current: SendState = {
    connection: { state: "checking", port: DEFAULT_HELPER_PORT },
    pairingOpen: false,
    sessions: [],
    repo: null,
    matchingPids: [],
    selectedPid: null,
    note: null,
    preview: null,
    busy: false,
  };

  /** The session the user picked themselves, on which site; kept while it is still running. */
  private picked: { site: string | null; pid: number } | null = null;

  constructor(private readonly hooks: SendFlowHooks) {}

  get state(): SendState {
    return this.current;
  }

  /** The chosen session, when pins can be sent to it. */
  get target(): PublicSession | null {
    if (this.current.connection.state !== "paired") return null;
    return (
      this.current.sessions.find((session) => session.pid === this.current.selectedPid) ?? null
    );
  }

  async start(): Promise<void> {
    const status = await this.hooks.ask({ type: "status" });
    if (!status.ok) {
      const { port } = this.current.connection;
      this.applyStatus({ state: "unreachable", port, message: status.failure.message });
      return;
    }
    this.applyStatus(status.value);
    if (status.value.state === "paired") await this.refresh();
  }

  openPairing(): void {
    this.update({ pairingOpen: true });
  }

  closePairing(): void {
    this.update({ pairingOpen: false });
  }

  async pair(code: string, port: number): Promise<void> {
    await this.busy(async () => {
      const reply = await this.hooks.ask({ type: "pair", code, port });
      if (!reply.ok) {
        this.hooks.report(reply.failure.message, "error");
        return;
      }
      this.applyStatus(reply.value);
      if (reply.value.state !== "paired") return;
      this.update({ pairingOpen: false });
      this.hooks.report("Paired with the helper.", "ok");
      await this.loadSessions();
    });
  }

  async forget(): Promise<void> {
    await this.busy(async () => {
      const reply = await this.hooks.ask({ type: "forget" });
      if (!reply.ok) {
        this.fail(reply.failure);
        return;
      }
      this.applyStatus(reply.value);
      this.hooks.report("Forgot the pairing. Pins can still be copied.", "ok");
    });
  }

  async refresh(): Promise<void> {
    await this.busy(() => this.loadSessions());
  }

  select(pid: number): void {
    this.picked = { site: this.site(), pid };
    this.update({ selectedPid: pid });
  }

  /** Remember the chosen session's repository for this site, or forget the site. */
  async rememberSite(remember: boolean): Promise<void> {
    const repo = remember ? (this.target?.repo ?? null) : null;
    const pageUrl = this.hooks.pageUrl();
    if (pageUrl === null) return;
    await this.busy(async () => {
      const reply = await this.hooks.ask({ type: "remember-site", pageUrl, repo });
      if (!reply.ok) {
        this.fail(reply.failure);
        return;
      }
      this.applySessions(this.current.sessions, repo);
    });
  }

  /** Ask the helper for the exact message; nothing is delivered until `confirm`. */
  async preview(pins: readonly StoredPin[]): Promise<void> {
    const session = this.target;
    const [first] = pins;
    if (session === null || first === undefined) return;
    const outgoing: OutgoingPins = {
      session: session.pid,
      pageUrl: first.pageUrl,
      pins: pins.map(({ comment, context, screenshot }) =>
        screenshot === undefined ? { comment, context } : { comment, context, screenshot },
      ),
    };
    await this.previewOutgoing(
      outgoing,
      pins.map((pin) => pin.id),
      session.name,
      null,
    );
  }

  /**
   * The user's follow-up on a sent pin, from the thread's composer: a new message about
   * the same element, to the session that has the pin, previewed like any pin. It names
   * the earlier message so the session can connect the two.
   */
  async previewReply(pin: StoredPin, tracking: PinTracking, text: string): Promise<void> {
    const reply = text.trim();
    if (reply === "") return;
    const session =
      this.current.sessions.find((candidate) => candidate.pid === tracking.sessionPid) ??
      this.current.sessions.find((candidate) => candidate.name === tracking.sessionName);
    if (this.current.connection.state !== "paired" || session === undefined) {
      this.hooks.report(
        `claude@${tracking.sessionName} is not running any more. Copy the pin instead, or send it again to another session.`,
        "error",
      );
      return;
    }
    const outgoing: OutgoingPins = {
      session: session.pid,
      pageUrl: pin.pageUrl,
      pins: [
        { comment: followUpComment(tracking.messageId, pin.comment, reply), context: pin.context },
      ],
    };
    await this.previewOutgoing(outgoing, [pin.id], session.name, reply);
  }

  private async previewOutgoing(
    outgoing: OutgoingPins,
    localPinIds: readonly string[],
    sessionName: string,
    followUp: string | null,
  ): Promise<void> {
    await this.busy(async () => {
      const reply = await this.hooks.ask({ type: "preview", outgoing });
      if (!reply.ok) {
        this.fail(reply.failure);
        return;
      }
      this.update({
        preview: { kind: "pins", outgoing, localPinIds, followUp, sessionName, ...reply.value },
      });
    });
  }

  /**
   * Ask the helper for the exact follow-up to a pin blocked on GitHub access. It goes to
   * the session that has the pin, so no session needs to be chosen; nothing is delivered
   * until `confirm`.
   */
  async previewFollowUp(
    localPinId: string,
    action: FollowUpAction,
    sessionName: string,
  ): Promise<void> {
    await this.busy(async () => {
      const reply = await this.hooks.ask({ type: "follow-up-preview", pinId: localPinId, action });
      if (!reply.ok) {
        this.fail(reply.failure);
        return;
      }
      this.update({
        preview: { kind: "follow-up", localPinId, action, sessionName, ...reply.value },
      });
    });
  }

  cancelPreview(): void {
    this.update({ preview: null });
  }

  /** Deliver the previewed message, identified by its pin id and digest. */
  async confirm(): Promise<void> {
    const preview = this.current.preview;
    if (preview === null) return;
    if (preview.kind === "follow-up") {
      await this.confirmFollowUp(preview);
      return;
    }
    await this.busy(async () => {
      const reply = await this.hooks.ask({
        type: "send",
        outgoing: preview.outgoing,
        pinId: preview.pinId,
        digest: preview.digest,
        localPinIds: [...preview.localPinIds],
        ...(preview.followUp === null ? {} : { followUp: preview.followUp }),
      });
      this.update({ preview: null });
      if (!reply.ok) {
        this.fail(reply.failure);
        return;
      }
      const count = preview.outgoing.pins.length;
      const what =
        preview.followUp !== null ? "your reply" : count === 1 ? "1 pin" : `${count} pins`;
      this.hooks.report(`Sent ${what} to claude@${reply.value.sessionName}.`, "ok");
    });
  }

  private async confirmFollowUp(preview: FollowUpPreview): Promise<void> {
    await this.busy(async () => {
      const reply = await this.hooks.ask({
        type: "follow-up-send",
        pinId: preview.localPinId,
        action: preview.action,
        digest: preview.digest,
      });
      this.update({ preview: null });
      if (!reply.ok) {
        this.fail(reply.failure);
        return;
      }
      const to = `claude@${reply.value.sessionName}`;
      this.hooks.report(
        preview.action === "patch"
          ? `Asked ${to} for the patch. Press Copy the patch again once it replies.`
          : `Sent "${FOLLOW_UP_LABELS[preview.action]}" to ${to}.`,
        "ok",
      );
    });
  }

  private async loadSessions(): Promise<void> {
    const reply = await this.hooks.ask({ type: "sessions", pageUrl: this.hooks.pageUrl() });
    if (!reply.ok) {
      this.fail(reply.failure);
      return;
    }
    const { sessions, repo } = reply.value;
    this.applySessions(sessions, repo);
  }

  private applySessions(sessions: readonly PublicSession[], repo: string | null): void {
    const { matching, preselectedPid } = matchSessions(sessions, repo);
    const { picked } = this;
    if (picked !== null && !sessions.some((session) => session.pid === picked.pid)) {
      this.picked = null;
    }
    const pickedHere = this.picked?.site === this.site() ? this.picked.pid : null;
    this.update({
      sessions,
      repo,
      matchingPids: matching.map((session) => session.pid),
      selectedPid: pickedHere ?? preselectedPid,
      note: sessionsNote(sessions, repo, matching.length),
    });
  }

  private applyStatus(status: ConnectionStatus): void {
    const paired = status.state === "paired";
    if (!paired) this.picked = null;
    this.update({
      connection: status,
      ...(paired ? {} : { sessions: [], matchingPids: [], selectedPid: null, preview: null }),
      note: paired ? this.current.note : (status.message ?? null),
    });
  }

  /** A failed call: show it, and fall back to copy when the helper is gone or unpaired. */
  private fail(failure: HelperFailure): void {
    const { port } = this.current.connection;
    if (failure.kind === "unreachable") {
      this.applyStatus({ state: "unreachable", port, message: failure.message });
    } else if (failure.kind === "unpaired") {
      this.applyStatus({ state: "unpaired", port, message: failure.message });
    } else if (failure.kind === "gone") {
      this.picked = null;
      this.update({ selectedPid: null, preview: null });
    }
    this.hooks.report(failure.message, "error");
  }

  /** The site of the page the panel is on, or null with no page. */
  private site(): string | null {
    const pageUrl = this.hooks.pageUrl();
    return pageUrl === null ? null : siteOf(pageUrl);
  }

  private async busy(action: () => Promise<void>): Promise<void> {
    if (this.current.busy) return;
    this.update({ busy: true });
    try {
      await action();
    } finally {
      this.update({ busy: false });
    }
  }

  private update(patch: Partial<SendState>): void {
    this.current = { ...this.current, ...patch };
    this.hooks.onChange();
  }
}

/** Most characters of the earlier comment quoted in a follow-up. */
const QUOTED_COMMENT_CHARS = 300;

/** The comment a follow-up carries: which earlier message it continues, then the reply. */
export function followUpComment(messageId: string, earlier: string, reply: string): string {
  const quoted =
    earlier.length > QUOTED_COMMENT_CHARS ? `${earlier.slice(0, QUOTED_COMMENT_CHARS)}…` : earlier;
  const lead = `Follow-up to Squashflow pin [${messageId}] on the same element (earlier comment: "${quoted}"):`;
  return `${lead}\n\n${reply}`.slice(0, MAX_COMMENT_CHARS);
}

function sessionsNote(
  sessions: readonly PublicSession[],
  repo: string | null,
  matches: number,
): string | null {
  if (sessions.length === 0) {
    return "No Claude Code session is running. Start one in your project and press Refresh, or copy the pins instead.";
  }
  if (repo !== null && matches === 0) {
    return `No session is working on ${repo}. Start one there and press Refresh, pick another session, or copy the pins instead.`;
  }
  if (repo !== null && matches > 1) return `Several sessions are working on ${repo}; pick one.`;
  if (repo === null) return "Pick the session working on this site's code.";
  return null;
}
