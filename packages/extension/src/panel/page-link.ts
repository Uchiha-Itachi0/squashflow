/**
 * The side panel's link to the page in the active tab of its window. It connects a port
 * to the pin mode script there and follows tab switches and navigation. Without the
 * `tabs` permission the panel never reads a tab's URL: the page tells it over the port,
 * so the panel knows only pages the user turned pin mode on.
 */

import {
  PANEL_PORT,
  PIN_MODE_STARTED,
  pageToPanelSchema,
  START_PIN_MODE,
  type PageToPanel,
  type PanelToPage,
} from "./protocol";

/** No tab; a tab without pin mode; or pin mode running on a page. */
export type PageState =
  { kind: "none" } | { kind: "off"; tabId: number } | { kind: "on"; tabId: number; url: string };

export interface PageLinkHooks {
  onPage: (page: PageState) => void;
  onMessage: (message: PageToPanel) => void;
}

export class PageLink {
  private port: chrome.runtime.Port | null = null;
  private state: PageState = { kind: "none" };
  /** The panel's own tab when it is open as a tab (tests), never treated as the page. */
  private selfTabId: number | null = null;

  constructor(private readonly hooks: PageLinkHooks) {}

  async start(): Promise<void> {
    this.selfTabId = (await chrome.tabs.getCurrent())?.id ?? null;
    chrome.tabs.onActivated.addListener(() => void this.refresh());
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      if (tabId === this.tabId() && change.status === "complete") void this.refresh();
    });
    chrome.runtime.onMessage.addListener((message: unknown, sender) => {
      const started =
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === PIN_MODE_STARTED;
      if (started && sender.id === chrome.runtime.id && sender.tab?.id !== undefined) {
        void this.refresh(sender.tab.id);
      }
      // Never answers: the service worker answers the pin mode script's requests.
      return false;
    });
    await this.refresh();
  }

  get page(): PageState {
    return this.state;
  }

  post(message: PanelToPage): void {
    this.port?.postMessage(message);
  }

  /** Start pin mode on the active tab; works where the user's click granted access. */
  async startPinMode(): Promise<boolean> {
    const tabId = this.tabId();
    if (tabId === null) return false;
    const started: unknown = await chrome.runtime
      .sendMessage({ type: START_PIN_MODE, tabId })
      .catch(() => false);
    return started === true;
  }

  /** Reconnect to the active tab, or to `startedTabId` when that is the active one. */
  async refresh(startedTabId?: number): Promise<void> {
    const tabId = await this.activeTabId();
    if (tabId === null) {
      // Focus moved to the panel's own tab (tests) or nowhere: keep the page shown.
      if (this.state.kind === "none") this.set({ kind: "none" });
      return;
    }
    if (startedTabId !== undefined && startedTabId !== tabId) return;
    if (this.port !== null && this.tabId() === tabId && startedTabId === undefined) return;
    this.connect(tabId);
  }

  private connect(tabId: number): void {
    this.port?.disconnect();
    this.port = null;
    this.set({ kind: "off", tabId });
    let port: chrome.runtime.Port;
    try {
      port = chrome.tabs.connect(tabId, { name: PANEL_PORT });
    } catch {
      return;
    }
    this.port = port;
    port.onMessage.addListener((raw: unknown) => {
      if (this.port !== port) return;
      const parsed = pageToPanelSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === "hello") this.set({ kind: "on", tabId, url: message.url });
      else this.hooks.onMessage(message);
    });
    port.onDisconnect.addListener(() => {
      // Also when nothing listened: a tab without pin mode is the normal case.
      if (this.port !== port) return;
      this.port = null;
      this.set({ kind: "off", tabId });
    });
  }

  private async activeTabId(): Promise<number | null> {
    const window = await chrome.windows.getCurrent().catch(() => undefined);
    if (window?.id === undefined) return null;
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
    if (tab?.id === undefined || tab.id === this.selfTabId) return null;
    return tab.id;
  }

  private tabId(): number | null {
    return this.state.kind === "none" ? null : this.state.tabId;
  }

  private set(state: PageState): void {
    this.state = state;
    this.hooks.onPage(state);
  }
}
