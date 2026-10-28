/**
 * What the side panel's views render, and what they can ask the app to do. The app
 * (`app.ts`) owns the state; the views are functions of this model.
 */

import type { DetailLevel, PublicSession } from "@squashflow/shared";
import type { Settings, SendMode } from "../settings";
import type { PinStatuses } from "../status/pin-status";
import type { StoredPin } from "../store/pins";
import type { GitHubBlockView, GitHubChoice } from "./github-actions";
import type { PageState } from "./page-link";
import type { PanelTab } from "./protocol";
import type { SendState } from "./send-flow";

/** Inputs kept across renders, so a re-render never clears what the user is typing. */
export interface PanelFields {
  code: HTMLInputElement;
  port: HTMLInputElement;
  reply: HTMLTextAreaElement;
  edit: HTMLTextAreaElement;
  repoLink: HTMLInputElement;
}

export interface PanelModel {
  tab: PanelTab;
  /** The pin whose thread is open. */
  openPinId: string | null;
  /** Whether the open draft's comment is being edited. */
  editing: boolean;
  page: PageState;
  pins: readonly StoredPin[];
  statuses: PinStatuses;
  settings: Settings;
  status: { text: string; error: boolean } | null;
  send: SendState;
  /** The chosen session, when pins can be sent to it. */
  target: PublicSession | null;
  github: (pinId: string) => GitHubBlockView | null;
  fields: PanelFields;
  now: number;
}

export interface PanelActions {
  setTab: (tab: PanelTab) => void;
  openPin: (id: string) => void;
  closePin: () => void;
  startPinning: () => void;
  stopPinning: () => void;
  pair: () => void;
  skipToCopy: () => void;
  /** Leave copy mode. */
  connectAgain: () => void;
  /** Pair again while paired, and back out of that. */
  rePair: () => void;
  cancelPairing: () => void;
  forget: () => void;
  retry: () => void;
  refresh: () => void;
  selectSession: (pid: number) => void;
  useSession: () => void;
  rememberSite: (remember: boolean) => void;
  setSendMode: (mode: SendMode) => void;
  setLevel: (level: DetailLevel) => void;
  go: () => void;
  sendPin: (id: string) => void;
  copyAll: () => void;
  copyPin: (id: string) => void;
  copyScreenshot: (id: string) => void;
  copyCommand: () => void;
  reply: (id: string) => void;
  resolve: (id: string, resolved: boolean) => void;
  gitHub: (id: string, choice: GitHubChoice) => void;
  startEdit: () => void;
  saveEdit: (id: string) => void;
  cancelEdit: () => void;
  deletePin: (id: string) => void;
  confirm: () => void;
  cancelPreview: () => void;
}
