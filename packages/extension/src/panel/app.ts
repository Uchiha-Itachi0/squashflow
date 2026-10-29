/**
 * The side panel: everything about pins except placing them on the page. It owns the
 * connection to the helper (through the service worker, which keeps the token), the
 * session sheet, preview-then-send, the inbox and each pin's chat, copy, and the
 * settings. It reads
 * the page's pins and their statuses from extension storage, and talks to the pin mode
 * script in the active tab over `PageLink`.
 */

import { sessionDisplayName, type DetailLevel } from "@squashflow/shared";
import { copyPins, copyScreenshot, writeClipboard } from "../copy/copy";
import { askWorker, type AskWorker } from "../helper/messages";
import {
  DEFAULT_SETTINGS,
  SettingsStore,
  watchSettings,
  type SendMode,
  type Settings,
} from "../settings";
import type { PinStatuses } from "../status/pin-status";
import { chromeStatusSource, type StatusSource } from "../status/store";
import { PinStore, watchPins, type StoredPin } from "../store/pins";
import { h } from "../ui/dom";
import { GitHubActions, type GitHubChoice } from "./github-actions";
import type { PanelActions, PanelFields, PanelModel, PanelScreen, PanelSheet } from "./model";
import { PageLink, type PageState } from "./page-link";
import type { PageToPanel } from "./protocol";
import { SendFlow } from "./send-flow";
import { backHeader, header, previewSheet, statusLine } from "./views/shell";
import { LEVEL_LABELS, pinsView } from "./views/pins";
import { sessionsSheet } from "./views/sessions";
import { settingsView } from "./views/settings";
import { threadView } from "./views/thread";

/** While a pin is in flight, ask the service worker to catch up this often. */
const TRACK_INTERVAL_MS = 20_000;
const STATUS_MS = 8000;
const HELPER_COMMAND = "npx squashflow";

export class PanelApp {
  private screen: PanelScreen = "inbox";
  private sheet: PanelSheet = null;
  private confirmed: string | null = null;
  private openPinId: string | null = null;
  private editing = false;
  private detailsOpen = false;
  private pins: StoredPin[] = [];
  private statuses: PinStatuses = {};
  private settings: Settings = DEFAULT_SETTINGS;
  private status: { text: string; error: boolean } | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private unwatchPins: () => void = () => undefined;
  /** Which view was last rendered, and how long its thread was, to keep or move the scroll. */
  private shown = { view: "", length: 0 };
  private readonly fields: PanelFields = panelFields();
  private readonly settingsStore = new SettingsStore(chrome.storage.local);
  private readonly send: SendFlow;
  private readonly github: GitHubActions;
  private readonly link: PageLink;

  constructor(
    private readonly root: HTMLElement,
    private readonly ask: AskWorker = askWorker,
    private readonly statusSource: StatusSource = chromeStatusSource(),
  ) {
    this.send = new SendFlow({
      ask,
      pageUrl: () => this.pageUrl(),
      onChange: () => this.render(),
      report: (text, outcome) => this.setStatus(text, outcome === "error"),
    });
    this.github = new GitHubActions({
      send: this.send,
      copy: (text) => writeClipboard(text, this.root),
      report: (text) => this.setStatus(text),
      onChange: () => this.render(),
    });
    this.link = new PageLink({
      onPage: (page) => void this.onPage(page),
      onMessage: (message) => this.onPageMessage(message),
    });
  }

  async start(): Promise<void> {
    this.settings = await this.settingsStore.read();
    watchSettings((settings) => {
      this.settings = settings;
      this.render();
    });
    this.statuses = await this.statusSource.read();
    this.statusSource.watch((statuses) => {
      this.statuses = statuses;
      this.render();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.back()) event.preventDefault();
    });
    this.render();
    await this.link.start();
    await this.send.start();
    await this.track();
    setInterval(() => void this.track(), TRACK_INTERVAL_MS);
  }

  // ---- the page ----

  private pageUrl(): string | null {
    const { page } = this.link;
    return page.kind === "on" ? page.url : null;
  }

  private async onPage(page: PageState): Promise<void> {
    this.unwatchPins();
    this.unwatchPins = () => undefined;
    if (page.kind !== "on") {
      this.pins = [];
      this.openPinId = null;
      this.render();
      return;
    }
    this.unwatchPins = watchPins(page.url, () => void this.reloadPins());
    await this.reloadPins();
    // The remembered repository depends on the page's site.
    if (this.send.state.connection.state === "paired") await this.send.refresh();
  }

  private async reloadPins(): Promise<void> {
    const url = this.pageUrl();
    this.pins = url === null ? [] : await new PinStore(chrome.storage.local, url).list();
    if (this.openPinId !== null && !this.pins.some((pin) => pin.id === this.openPinId)) {
      this.openPinId = null;
      this.editing = false;
    }
    this.render();
  }

  private onPageMessage(message: PageToPanel): void {
    switch (message.type) {
      case "send-pin":
        void this.reloadPins().then(() => this.sendPin(message.pinId));
        return;
      case "open-pin":
        void this.reloadPins().then(() => this.openPin(message.pinId));
        return;
      case "hello":
        return;
    }
  }

  // ---- actions ----

  private readonly actions: PanelActions = {
    openSettings: () => {
      this.screen = "settings";
      this.sheet = null;
      this.openPinId = null;
      this.editing = false;
      this.render();
    },
    closeSettings: () => {
      this.screen = "inbox";
      this.render();
    },
    openSessions: () => {
      this.sheet = "sessions";
      this.render();
      void this.send.refresh();
    },
    closeSessions: () => {
      this.sheet = null;
      this.render();
    },
    openPin: (id) => this.openPin(id),
    closePin: () => {
      this.openPinId = null;
      this.editing = false;
      this.render();
    },
    toggleDetails: () => {
      this.detailsOpen = !this.detailsOpen;
      this.render();
    },
    startPinning: () =>
      void this.run(async () => {
        if (!(await this.link.startPinMode())) {
          this.setStatus(
            "Press the Squashflow button in the browser toolbar to pin on this page.",
            true,
          );
        }
      }),
    stopPinning: () => this.link.post({ type: "stop" }),
    pair: () => {
      const code = this.fields.code.value.trim();
      const port = Number(this.fields.port.value);
      if (code === "" || !Number.isInteger(port)) return;
      this.fields.code.value = "";
      void this.run(async () => {
        await this.send.pair(code, port);
        if (this.send.state.connection.state === "paired") {
          await this.setSettings({ copyOnly: false });
          this.screen = "inbox";
          // The green line confirms it; the toast would say it twice.
          this.status = null;
          if (this.send.target === null) {
            this.confirmed = "Connected. Now pick who fixes this site.";
            this.sheet = "sessions";
          } else {
            this.confirmed = "Connected.";
          }
          this.render();
        }
      });
    },
    skipToCopy: () => void this.setSettings({ copyOnly: true }),
    connectAgain: () =>
      void this.run(async () => {
        await this.setSettings({ copyOnly: false });
        this.screen = "inbox";
        this.render();
      }),
    rePair: () => {
      this.send.openPairing();
      this.screen = "inbox";
      this.render();
    },
    cancelPairing: () => this.send.closePairing(),
    forget: () => {
      this.confirmed = null;
      void this.send.forget();
    },
    retry: () => void this.send.start(),
    refresh: () => void this.send.refresh(),
    selectSession: (pid) => this.send.select(pid),
    useSession: () => {
      const target = this.send.target;
      if (target === null) return;
      this.sheet = null;
      this.confirmed = `${sessionDisplayName(target)} will fix this site.`;
      this.render();
    },
    rememberSite: (remember) => void this.send.rememberSite(remember),
    setSendMode: (sendMode: SendMode) => void this.setSettings({ sendMode }),
    setLevel: (level: DetailLevel) => void this.setSettings({ level }),
    go: () => this.go(),
    sendPin: (id) => this.sendPin(id),
    copyAll: () => this.copy(this.pins),
    copyPin: (id) => this.copy(this.pins.filter((pin) => pin.id === id)),
    copyScreenshot: (id) => {
      const screenshot = this.pins.find((pin) => pin.id === id)?.screenshot;
      if (screenshot === undefined) return;
      void this.run(async () => {
        await copyScreenshot(screenshot);
        this.setStatus("Copied the screenshot. Paste it into your Claude Code session.");
      });
    },
    copyCommand: () =>
      void this.run(async () => {
        await writeClipboard(HELPER_COMMAND, this.root);
        this.setStatus(`Copied ${HELPER_COMMAND}. Run it in a terminal.`);
      }),
    reply: (id) => {
      const pin = this.pins.find((candidate) => candidate.id === id);
      const tracking = this.statuses[id];
      const text = this.fields.reply.value.trim();
      if (pin === undefined || tracking === undefined || text === "") return;
      void this.run(async () => {
        await this.send.previewReply(pin, tracking, text);
      });
    },
    resolve: (id, resolved) =>
      void this.run(async () => {
        const reply = await this.ask({
          type: "mark",
          pinId: id,
          mark: resolved ? "resolve" : "reopen",
        });
        if (!reply.ok) throw new Error(reply.failure.message);
        this.statuses = reply.value;
        this.render();
      }),
    gitHub: (id, choice: GitHubChoice) => {
      const index = this.pins.findIndex((pin) => pin.id === id);
      const pin = this.pins[index];
      const tracking = this.statuses[id];
      if (pin === undefined || tracking === undefined) return;
      void this.run(() => this.github.choose(choice, pin, index + 1, tracking));
    },
    startEdit: () => {
      const pin = this.pins.find((candidate) => candidate.id === this.openPinId);
      if (pin === undefined) return;
      this.fields.edit.value = pin.comment;
      this.editing = true;
      this.render();
      this.fields.edit.focus();
    },
    saveEdit: (id) => {
      const comment = this.fields.edit.value.trim();
      const url = this.pageUrl();
      if (comment === "" || url === null) return;
      void this.run(async () => {
        await new PinStore(chrome.storage.local, url).update(id, comment);
        this.editing = false;
        await this.reloadPins();
      });
    },
    cancelEdit: () => {
      this.editing = false;
      this.render();
    },
    deletePin: (id) => {
      const url = this.pageUrl();
      if (url === null) return;
      void this.run(async () => {
        await new PinStore(chrome.storage.local, url).remove(id);
        if (this.statuses[id] !== undefined) {
          await this.ask({ type: "mark", pinId: id, mark: "forget" });
        }
        this.openPinId = null;
        this.editing = false;
        await this.reloadPins();
      });
    },
    confirm: () =>
      void this.run(async () => {
        const followUp =
          this.send.state.preview?.kind === "pins" && this.send.state.preview.followUp !== null;
        await this.send.confirm();
        if (followUp && this.send.state.preview === null) this.fields.reply.value = "";
      }),
    cancelPreview: () => this.send.cancelPreview(),
  };

  private openPin(id: string): void {
    if (!this.pins.some((pin) => pin.id === id)) return;
    this.screen = "inbox";
    this.sheet = null;
    this.openPinId = id;
    this.editing = false;
    this.detailsOpen = false;
    this.fields.reply.value = "";
    this.render();
  }

  /**
   * Escape steps back one level: out of the preview, the session sheet, editing, a pin's
   * chat, or Settings, to the pins. Whether there was anywhere to go back from.
   */
  private back(): boolean {
    if (this.send.state.preview !== null) {
      this.actions.cancelPreview();
    } else if (this.sheet !== null) {
      this.actions.closeSessions();
    } else if (this.editing) {
      this.actions.cancelEdit();
    } else if (this.openPinId !== null) {
      this.actions.closePin();
    } else if (this.screen === "settings") {
      this.actions.closeSettings();
    } else {
      return false;
    }
    return true;
  }

  /** Preview every draft on the page; nothing is delivered until the user confirms. */
  private go(): void {
    const drafts = this.pins.filter((pin) => this.statuses[pin.id] === undefined);
    if (!this.canSend()) return;
    this.confirmed = null;
    if (drafts.length === 0) {
      this.setStatus("Every pin on this page has been sent. Pin something new first.");
      return;
    }
    void this.send.preview(drafts);
  }

  private sendPin(id: string): void {
    const pin = this.pins.find((candidate) => candidate.id === id);
    if (pin === undefined || !this.canSend()) return;
    this.confirmed = null;
    void this.send.preview([pin]);
  }

  /** Whether pins can be sent; otherwise send the user where they can fix that. */
  private canSend(): boolean {
    if (this.settings.copyOnly) {
      this.setStatus("You chose to copy pins by hand. Copy them, or connect in Settings.");
      return false;
    }
    if (this.send.state.connection.state !== "paired") {
      this.screen = "inbox";
      this.openPinId = null;
      this.setStatus("Connect first, or copy the pins instead.", true);
      return false;
    }
    if (this.send.target === null) {
      this.screen = "inbox";
      this.sheet = "sessions";
      this.render();
      return false;
    }
    return true;
  }

  private copy(pins: readonly StoredPin[]): void {
    const url = this.pageUrl();
    if (pins.length === 0 || url === null) return;
    void this.run(async () => {
      const { level } = this.settings;
      const result = await copyPins({ pins, level, pageUrl: url }, this.root);
      const what = pins.length === 1 ? "1 pin" : `${pins.length} pins`;
      this.setStatus(`Copied ${what} (${LEVEL_LABELS[level]}). ${copyAdvice(result)}`);
    });
  }

  /** Catch up on pins in flight while the panel is open; the worker's answer is the latest. */
  private async track(): Promise<void> {
    const inFlight = Object.values(this.statuses).some((tracking) => tracking.inFlight);
    if (!inFlight) return;
    const reply = await this.ask({ type: "track" });
    if (!reply.ok) return;
    this.statuses = reply.value;
    this.render();
  }

  private async setSettings(patch: Partial<Settings>): Promise<void> {
    await this.run(async () => {
      this.settings = await this.settingsStore.change(patch);
      this.render();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      this.setStatus(error instanceof Error ? error.message : "Something went wrong.", true);
    }
  }

  private setStatus(text: string, error = false): void {
    this.status = { text, error };
    this.render();
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.status = null;
      this.render();
    }, STATUS_MS);
  }

  // ---- rendering ----

  private model(): PanelModel {
    return {
      screen: this.screen,
      sheet: this.sheet,
      confirmed: this.confirmed,
      openPinId: this.openPinId,
      editing: this.editing,
      detailsOpen: this.detailsOpen,
      page: this.link.page,
      pins: this.pins,
      statuses: this.statuses,
      settings: this.settings,
      status: this.status,
      send: this.send.state,
      target: this.send.target,
      github: (pinId) => this.github.view(pinId, this.statuses[pinId]),
      fields: this.fields,
      now: Date.now(),
    };
  }

  private render(): void {
    const model = this.model();
    const focused = document.activeElement;
    const index = this.pins.findIndex((pin) => pin.id === this.openPinId);
    const open = this.pins[index];
    const body =
      open !== undefined
        ? threadView(model, this.actions, open, index + 1)
        : this.screen === "settings"
          ? [
              backHeader("Settings", this.actions.closeSettings),
              ...settingsView(model, this.actions),
            ]
          : [header(model, this.actions), ...pinsView(model, this.actions)];
    const sheet =
      open === undefined &&
      this.screen === "inbox" &&
      this.sheet === "sessions" &&
      model.send.connection.state === "paired"
        ? sessionsSheet(model, this.actions)
        : null;
    const scrolled = this.root.querySelector(".scroll")?.scrollTop ?? 0;
    const [first, ...rest] = body;
    this.root.replaceChildren(
      ...(first === undefined ? [] : [first]),
      statusLine(model),
      ...rest,
      ...nonNull(sheet),
      ...nonNull(previewSheet(model, this.actions)),
    );
    this.keepScroll(open, scrolled);
    // A re-render must not take the caret away from what the user is typing.
    if (
      focused instanceof HTMLElement &&
      focused.isConnected &&
      focused !== document.activeElement
    ) {
      focused.focus({ preventScroll: true });
    }
  }

  /**
   * A re-render keeps the scroll where the user left it; a thread opens at its latest
   * message, and follows new ones as they arrive, like a chat.
   */
  private keepScroll(open: StoredPin | undefined, scrolled: number): void {
    const scroll = this.root.querySelector(".scroll");
    if (scroll === null) return;
    const view = open === undefined ? this.screen : `pin:${open.id}`;
    const length = open === undefined ? 0 : scroll.querySelectorAll(".convo > li").length;
    const grew = view === this.shown.view ? length > this.shown.length : open !== undefined;
    scroll.scrollTop = grew ? scroll.scrollHeight : view === this.shown.view ? scrolled : 0;
    if (grew) {
      // The screenshot loads after the first layout; stay at the latest message.
      for (const image of scroll.querySelectorAll("img")) {
        image.addEventListener("load", () => (scroll.scrollTop = scroll.scrollHeight), {
          once: true,
        });
      }
    }
    this.shown = { view, length };
  }
}

function nonNull<T>(value: T | null): T[] {
  return value === null ? [] : [value];
}

function panelFields(): PanelFields {
  return {
    code: h("input", {
      className: "code-input",
      attrs: {
        id: "pair-code",
        placeholder: "ABCD-EFGH",
        autocomplete: "off",
        spellcheck: "false",
        maxlength: "32",
      },
    }),
    port: h("input", {
      className: "field mono",
      attrs: {
        id: "pair-port",
        type: "number",
        min: "1",
        max: "65535",
        style: "width: 110px; height: 36px",
      },
    }),
    reply: h("textarea", {
      attrs: {
        id: "reply",
        placeholder: "Reply to Claude…",
        maxlength: "4000",
        rows: "1",
      },
    }),
    edit: h("textarea", {
      className: "edit-box",
      attrs: { id: "edit-comment", maxlength: "8000" },
    }),
  };
}

function copyAdvice({
  imageAttached,
  screenshots,
}: {
  imageAttached: boolean;
  screenshots: number;
}): string {
  if (imageAttached) {
    return "Paste the text into your Claude Code session, then paste the screenshot (Ctrl+V).";
  }
  if (screenshots > 0) {
    return "Paste it into your Claude Code session; the text says how to add the screenshots.";
  }
  return "Paste it into your Claude Code session.";
}
