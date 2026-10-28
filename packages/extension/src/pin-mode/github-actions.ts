/**
 * What the four ways out of Blocked: GitHub access do. Log in shows the `gh auth login`
 * instruction and a Retry; Retry and Fork and open a PR send a follow-up to the pin's
 * session through the same preview-then-send confirm as pins. Copy the patch copies the
 * diff from Claude's replies, or, when none has one yet, previews a follow-up asking the
 * session for it. Ask the owner copies a ready-made message built from the pin.
 */

import type { PinTracking } from "../status/pin-status";
import type { StoredPin } from "../store/pins";
import { buildOwnerMessage, changeSummary, extractPatch } from "../github/blocked";
import type { GitHubBlockView, GitHubChoice } from "../ui/github-view";
import type { SendFlow } from "./send-flow";

export interface GitHubActionHooks {
  send: SendFlow;
  pageUrl: () => string;
  copy: (text: string) => Promise<void>;
  report: (text: string) => void;
  onChange: () => void;
}

export class GitHubActions {
  /** Pins whose Log in instruction is showing. */
  private loginOpen: ReadonlySet<string> = new Set();

  constructor(private readonly hooks: GitHubActionHooks) {}

  /** The options to show for a pin, when it is Blocked: GitHub access. */
  view(pinId: string, tracking: PinTracking | undefined): GitHubBlockView | null {
    if (tracking?.status !== "blocked" || tracking.blocked?.kind !== "github-access") return null;
    return { reason: tracking.blocked.reason, loginOpen: this.loginOpen.has(pinId) };
  }

  async choose(
    choice: GitHubChoice,
    pin: StoredPin,
    number: number,
    tracking: PinTracking,
  ): Promise<void> {
    switch (choice) {
      case "login":
        this.setLoginOpen(pin.id, !this.loginOpen.has(pin.id));
        return;
      case "retry":
        this.setLoginOpen(pin.id, false);
        await this.hooks.send.previewFollowUp(pin.id, "retry", tracking.sessionName);
        return;
      case "fork":
        await this.hooks.send.previewFollowUp(pin.id, "fork", tracking.sessionName);
        return;
      case "patch":
        await this.copyPatch(pin, number, tracking);
        return;
      case "owner":
        await this.hooks.copy(
          buildOwnerMessage({
            pageUrl: this.hooks.pageUrl(),
            comment: pin.comment,
            summary: changeSummary(tracking.thread),
            hasPatch: latestPatch(tracking) !== null,
          }),
        );
        this.hooks.report(`Copied a message for the repository owner about pin ${number}.`);
        return;
    }
  }

  private async copyPatch(pin: StoredPin, number: number, tracking: PinTracking): Promise<void> {
    const patch = latestPatch(tracking);
    if (patch === null) {
      await this.hooks.send.previewFollowUp(pin.id, "patch", tracking.sessionName);
      return;
    }
    await this.hooks.copy(patch);
    this.hooks.report(`Copied the patch for pin ${number}.`);
  }

  private setLoginOpen(pinId: string, open: boolean): void {
    const next = new Set(this.loginOpen);
    if (open) next.add(pinId);
    else next.delete(pinId);
    this.loginOpen = next;
    this.hooks.onChange();
  }
}

/** The patch in Claude's most recent reply that has one. */
export function latestPatch(tracking: PinTracking): string | null {
  for (const message of [...tracking.thread].reverse()) {
    const patch = extractPatch(message);
    if (patch !== null) return patch;
  }
  return null;
}
