/**
 * Sending pins to a Claude Code session from the panel: pairing, the session picker
 * and preview-then-send, also for follow-ups to a pin blocked on GitHub access. All helper calls go through the service worker. When the
 * helper is not running, not paired, or no session fits, copy stays available and the
 * panel says why.
 */

import { DEFAULT_HELPER_PORT, type FollowUpAction, type PublicSession } from "@squashflow/shared";
import type { HelperFailure } from "../helper/errors";
import { matchSessions } from "../helper/matching";
import type { AskWorker, ConnectionStatus } from "../helper/messages";
import type { OutgoingPins } from "../helper/client";
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
  selectedPid: number | null;
  /** Why there is nothing to send to, with what to do instead. */
  note: string | null;
  preview: PendingPreview | null;
  busy: boolean;
}

export interface SendFlowHooks {
  ask: AskWorker;
  /** The page the pins are on, without its fragment. */
  pageUrl: () => string;
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
    this.update({ selectedPid: pid });
  }

  /** Remember the chosen session's repository for this site, or forget the site. */
  async rememberSite(remember: boolean): Promise<void> {
    const repo = remember ? (this.target?.repo ?? null) : null;
    await this.busy(async () => {
      const reply = await this.hooks.ask({
        type: "remember-site",
        pageUrl: this.hooks.pageUrl(),
        repo,
      });
      if (!reply.ok) {
        this.fail(reply.failure);
        return;
      }
      this.applySessions(this.current.sessions, repo, this.current.selectedPid);
    });
  }

  /** Ask the helper for the exact message; nothing is delivered until `confirm`. */
  async preview(pins: readonly StoredPin[]): Promise<void> {
    const session = this.target;
    if (session === null || pins.length === 0) return;
    const outgoing: OutgoingPins = {
      session: session.pid,
      pageUrl: this.hooks.pageUrl(),
      pins: pins.map(({ comment, context, screenshot }) =>
        screenshot === undefined ? { comment, context } : { comment, context, screenshot },
      ),
    };
    await this.busy(async () => {
      const reply = await this.hooks.ask({ type: "preview", outgoing });
      if (!reply.ok) {
        this.fail(reply.failure);
        return;
      }
      const localPinIds = pins.map((pin) => pin.id);
      this.update({
        preview: { kind: "pins", outgoing, localPinIds, sessionName: session.name, ...reply.value },
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
      });
      this.update({ preview: null });
      if (!reply.ok) {
        this.fail(reply.failure);
        return;
      }
      const count = preview.outgoing.pins.length;
      const what = count === 1 ? "1 pin" : `${count} pins`;
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
    const stillThere = sessions.some((session) => session.pid === this.current.selectedPid);
    this.applySessions(sessions, repo, stillThere ? this.current.selectedPid : null);
  }

  private applySessions(
    sessions: readonly PublicSession[],
    repo: string | null,
    selectedPid: number | null,
  ): void {
    const { matching, preselectedPid } = matchSessions(sessions, repo);
    this.update({
      sessions,
      repo,
      matchingPids: matching.map((session) => session.pid),
      selectedPid: selectedPid ?? preselectedPid,
      note: sessionsNote(sessions, repo, matching.length),
    });
  }

  private applyStatus(status: ConnectionStatus): void {
    const paired = status.state === "paired";
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
      this.update({ selectedPid: null, preview: null });
    }
    this.hooks.report(failure.message, "error");
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
