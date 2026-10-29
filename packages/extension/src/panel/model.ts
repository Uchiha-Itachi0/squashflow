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
import type { SendState } from "./send-flow";

/** Inputs kept across renders, so a re-render never clears what the user is typing. */
export interface PanelFields {
  code: HTMLInputElement;
  port: HTMLInputElement;
  reply: HTMLTextAreaElement;
  edit: HTMLTextAreaElement;
}

/** The inbox is home; Settings replaces it, and sheets slide over it. */
export type PanelScreen = "inbox" | "settings";
export type PanelSheet = "sessions" | null;

export interface PanelModel {
  screen: PanelScreen;
  sheet: PanelSheet;
  /** The last setup step that worked, said in a short green line until the next one. */
  confirmed: string | null;
  /** The pin whose thread is open. */
  openPinId: string | null;
  /** Whether the open draft's comment is being edited. */
  editing: boolean;
  /** Whether the open pin's technical details are shown. */
  detailsOpen: boolean;
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
  openSettings: () => void;
  closeSettings: () => void;
  openSessions: () => void;
  closeSessions: () => void;
  openPin: (id: string) => void;
  closePin: () => void;
  toggleDetails: () => void;
  startPinning: () => void;
  stopPinning: () => void;
  pair: () => void;
  skipToCopy: () => void;
  /** Leave copy mode. */
  connectAgain: () => void;
  /** Pair again while paired, and back out of that. */
  rePair: () => void;
  cancelPairing: () => void;
  /** Disconnect: forget the pairing. */
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
