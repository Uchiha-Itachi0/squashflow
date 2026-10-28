/**
 * The pin mode script's end of the port the side panel opens to the page. The panel
 * says where pins go and can stop pin mode; the page tells it the page URL, Go, a pin
 * to send now, and a pin or tab to open. With no panel open, the page asks the service
 * worker to open one.
 */

import {
  OPEN_PANEL,
  PANEL_PORT,
  PIN_MODE_STARTED,
  type PageToPanel,
  type PanelToPage,
  type ToolbarTarget,
} from "../panel/protocol";

export interface PanelLinkHooks {
  pageUrl: () => string;
  onTarget: (target: ToolbarTarget | null) => void;
  onStop: () => void;
}

export class PanelLink {
  private port: chrome.runtime.Port | null = null;
  /** What the user asked for while no panel was open; delivered once one connects. */
  private pending: PageToPanel | null = null;

  constructor(private readonly hooks: PanelLinkHooks) {}

  private readonly onConnect = (port: chrome.runtime.Port): void => {
    // Only this extension's own side panel; there is no externally_connectable.
    if (port.name !== PANEL_PORT || port.sender?.id !== chrome.runtime.id) return;
    this.port?.disconnect();
    this.port = port;
    port.onMessage.addListener((message: PanelToPage) => {
      if (message.type === "target") this.hooks.onTarget(message.target);
      else this.hooks.onStop();
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      this.hooks.onTarget(null);
    });
    port.postMessage({ type: "hello", url: this.hooks.pageUrl() } satisfies PageToPanel);
    if (this.pending !== null) port.postMessage(this.pending);
    this.pending = null;
  };

  start(): void {
    chrome.runtime.onConnect.addListener(this.onConnect);
    // An open side panel connects when it hears this; nothing answers it.
    void chrome.runtime.sendMessage({ type: PIN_MODE_STARTED }).catch(() => undefined);
  }

  stop(): void {
    chrome.runtime.onConnect.removeListener(this.onConnect);
    this.port?.disconnect();
    this.port = null;
  }

  get connected(): boolean {
    return this.port !== null;
  }

  /** Tell the panel; with none connected, ask the service worker to open it first. */
  send(message: PageToPanel): void {
    if (this.port !== null) {
      this.port.postMessage(message);
      return;
    }
    this.pending = message;
    void chrome.runtime.sendMessage({ type: OPEN_PANEL }).catch(() => undefined);
  }
}
