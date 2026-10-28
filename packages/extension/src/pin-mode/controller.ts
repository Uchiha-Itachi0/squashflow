/**
 * Pin mode on the current page. While it is on, clicks on the page place pins instead
 * of reaching the page: click an element, drag an area, Shift+click several elements,
 * or switch to Text and select text. Escape closes the comment box, then exits.
 * Sent pins show their status and Claude's reply, which the service worker stores.
 */

import type { DetailLevel, Rect } from "@squashflow/shared";
import { capturePin, pageRect, type PinTarget } from "../capture/context";
import { DRAG_THRESHOLD_PX, HOST_TAG } from "../constants";
import { buildCopyText, writeClipboard } from "../copy/copy";
import { askWorker, type AskWorker } from "../helper/messages";
import {
  moodFor,
  moodForStatus,
  shownLabel,
  shownStatus,
  type PinStatuses,
} from "../status/pin-status";
import { chromeStatusSource, type StatusSource } from "../status/store";
import { pinPageUrl, type PinStore, type StoredPin } from "../store/pins";
import type { SquishMood } from "../ui/squish";
import { PinView, type PinModeKind, type PinStatusView } from "../ui/view";
import { SendFlow } from "./send-flow";

const MOOD_RESET_MS = 2500;
/**
 * While a pin on the page is in flight, ask the service worker to catch up this often.
 * It re-reads the helper and reopens its event stream if the browser stopped the worker.
 */
const TRACK_INTERVAL_MS = 20_000;
const MAX_AREA_ELEMENTS = 20;

interface Drag {
  startX: number;
  startY: number;
  area: Rect | null;
}

export class PinMode {
  private readonly view = new PinView();
  private pins: StoredPin[] = [];
  private mode: PinModeKind = "element";
  private level: DetailLevel = "standard";
  private selection: Element[] = [];
  private drag: Drag | null = null;
  private status: { text: string; error: boolean } | null = null;
  /** A short-lived mood after an action; otherwise Squish follows the pins' statuses. */
  private flash: SquishMood | null = null;
  private moodTimer: ReturnType<typeof setTimeout> | undefined;
  private statuses: PinStatuses = {};
  private trackTimer: ReturnType<typeof setInterval> | undefined;
  private unwatch: () => void = () => undefined;
  private readonly listeners: [string, EventListener, Window | Document][] = [];
  private readonly send: SendFlow;

  constructor(
    private readonly store: PinStore,
    private readonly onStop: () => void,
    private readonly ask: AskWorker = askWorker,
    private readonly statusSource: StatusSource = chromeStatusSource(),
  ) {
    this.send = new SendFlow({
      ask,
      pageUrl: () => pinPageUrl(location.href),
      onChange: () => this.render(),
      report: (text, outcome) => {
        this.setStatus(text, outcome === "error");
        this.setMood(outcome === "error" ? "blocked" : "squashed");
      },
    });
  }

  async start(): Promise<void> {
    this.listen(window, "mousemove", (event) => this.onMove(event as MouseEvent));
    this.listen(window, "mousedown", (event) => this.onDown(event as MouseEvent));
    this.listen(window, "mouseup", (event) => this.onUp(event as MouseEvent));
    this.listen(window, "click", (event) => this.onClick(event));
    this.listen(window, "keydown", (event) => this.onKeyDown(event as KeyboardEvent));
    this.listen(window, "keyup", (event) => this.onKeyUp(event as KeyboardEvent));
    this.listen(window, "resize", () => this.renderMarkers());
    this.statuses = await this.statusSource.read();
    this.unwatch = this.statusSource.watch((statuses) => {
      this.statuses = statuses;
      this.render();
    });
    await this.reload();
    await this.send.start();
    await this.track();
    this.trackTimer = setInterval(() => void this.track(), TRACK_INTERVAL_MS);
  }

  stop(): void {
    for (const [type, listener, target] of this.listeners) {
      target.removeEventListener(type, listener, true);
    }
    clearTimeout(this.moodTimer);
    clearInterval(this.trackTimer);
    this.unwatch();
    this.view.destroy();
    this.onStop();
  }

  private listen(target: Window | Document, type: string, listener: EventListener): void {
    target.addEventListener(type, listener, true);
    this.listeners.push([type, listener, target]);
  }

  // ---- page events ----

  private onMove(event: MouseEvent): void {
    if (this.view.owns(event) || this.view.composing || this.mode === "text") {
      this.view.showHover(null);
      return;
    }
    if (this.drag !== null) {
      this.updateDrag(event);
      return;
    }
    const target = this.pageElementAt(event.clientX, event.clientY);
    this.view.showHover(target === null ? null : pageRect(target));
  }

  private onDown(event: MouseEvent): void {
    if (this.view.owns(event) || event.button !== 0 || this.mode === "text") return;
    block(event);
    if (this.view.composing) return;
    this.drag = { startX: event.pageX, startY: event.pageY, area: null };
  }

  private onUp(event: MouseEvent): void {
    if (this.view.owns(event) || event.button !== 0) return;
    if (this.mode === "text") {
      queueMicrotask(() => this.pinSelectedText());
      return;
    }
    block(event);
    const drag = this.drag;
    this.drag = null;
    this.view.showArea(null);
    if (this.view.composing) return;
    if (drag?.area) {
      this.pinArea(drag.area);
      return;
    }
    const target = this.pageElementAt(event.clientX, event.clientY);
    if (target === null) return;
    if (event.shiftKey) this.toggleSelected(target);
    else this.compose({ kind: "element", element: target });
  }

  private onClick(event: Event): void {
    if (!this.view.owns(event)) block(event);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    block(event);
    if (this.view.composing) this.view.closeComposer();
    else if (this.send.state.preview !== null) this.send.cancelPreview();
    else if (this.selection.length > 0) this.setSelection([]);
    else this.stop();
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.key !== "Shift" || this.selection.length === 0 || this.view.composing) return;
    const elements = this.selection;
    this.setSelection([]);
    this.compose(
      elements.length === 1 && elements[0]
        ? { kind: "element", element: elements[0] }
        : { kind: "elements", elements },
    );
  }

  // ---- placing pins ----

  private updateDrag(event: MouseEvent): void {
    const drag = this.drag;
    if (drag === null) return;
    const width = Math.abs(event.pageX - drag.startX);
    const height = Math.abs(event.pageY - drag.startY);
    if (drag.area === null && Math.max(width, height) < DRAG_THRESHOLD_PX) return;
    const area = {
      x: Math.min(event.pageX, drag.startX),
      y: Math.min(event.pageY, drag.startY),
      width,
      height,
    };
    this.drag = { ...drag, area };
    this.view.showHover(null);
    this.view.showArea(area);
  }

  private pinArea(area: Rect): void {
    const inside = Array.from(document.body.querySelectorAll("*"))
      .filter((element) => contains(area, pageRect(element)) && isVisible(element))
      .slice(0, MAX_AREA_ELEMENTS);
    const container =
      enclosingElement(inside) ??
      this.pageElementAt(
        area.x - window.scrollX + area.width / 2,
        area.y - window.scrollY + area.height / 2,
      ) ??
      document.body;
    this.compose({ kind: "area", area, elements: inside, container });
  }

  private pinSelectedText(): void {
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (this.view.host.contains(range.commonAncestorContainer)) return;
    this.compose({ kind: "text", range: range.cloneRange() });
  }

  private toggleSelected(element: Element): void {
    const next = this.selection.includes(element)
      ? this.selection.filter((item) => item !== element)
      : [...this.selection, element];
    this.setSelection(next);
  }

  private setSelection(elements: Element[]): void {
    this.selection = elements;
    this.view.showSelection(elements.map(pageRect));
  }

  private compose(target: PinTarget): void {
    const context = capturePin(target);
    this.view.showHover(null);
    this.view.openComposer({
      anchor: context.area ??
        context.rect ?? { x: 16, y: window.scrollY + 16, width: 0, height: 0 },
      heading: describeTarget(target),
      initial: "",
      editing: false,
      onSave: (comment) => {
        void this.run(async () => {
          await this.store.add({ comment, context });
          this.view.closeComposer();
          window.getSelection()?.removeAllRanges();
          await this.reload();
        });
      },
      onCancel: () => this.view.closeComposer(),
      onDelete: () => this.view.closeComposer(),
    });
  }

  private edit(id: string): void {
    const index = this.pins.findIndex((pin) => pin.id === id);
    const pin = this.pins[index];
    if (pin === undefined) return;
    this.view.openComposer({
      anchor: anchorOf(pin),
      heading: `Pin ${index + 1}`,
      initial: pin.comment,
      editing: true,
      onSave: (comment) => {
        void this.run(async () => {
          await this.store.update(id, comment);
          this.view.closeComposer();
          await this.reload();
        });
      },
      onCancel: () => this.view.closeComposer(),
      onDelete: () => this.remove(id),
    });
  }

  private remove(id: string): void {
    void this.run(async () => {
      await this.store.remove(id);
      if (this.statuses[id] !== undefined) {
        await this.ask({ type: "mark", pinId: id, mark: "forget" });
      }
      this.view.closeComposer();
      await this.reload();
    });
  }

  // ---- copy ----

  private copy(pins: readonly StoredPin[]): void {
    void this.run(async () => {
      const text = buildCopyText({ pins, level: this.level, pageUrl: pinPageUrl(location.href) });
      await writeClipboard(text, this.view.host.shadowRoot ?? this.view.host);
      const what = pins.length === 1 ? "1 pin" : `${pins.length} pins`;
      this.setStatus(`Copied ${what} (${this.level}). Paste it into your Claude Code session.`);
      this.setMood("squashed");
    });
  }

  // ---- send ----

  private sendPins(pins: readonly StoredPin[]): void {
    void this.send.preview(pins);
  }

  // ---- status ----

  /** Catch up on pins in flight on this page; the worker's answer is the latest. */
  private async track(): Promise<void> {
    const inFlight = this.pins.some((pin) => this.statuses[pin.id]?.inFlight === true);
    if (!inFlight) return;
    const reply = await this.ask({ type: "track" });
    if (!reply.ok) return;
    this.statuses = reply.value;
    this.render();
  }

  private resolve(id: string, resolved: boolean): void {
    void this.run(async () => {
      const reply = await this.ask({
        type: "mark",
        pinId: id,
        mark: resolved ? "resolve" : "reopen",
      });
      if (!reply.ok) throw new Error(reply.failure.message);
      this.statuses = reply.value;
      this.render();
    });
  }

  private statusOf(id: string): PinStatusView | null {
    const tracking = this.statuses[id];
    if (tracking === undefined) return null;
    const status = shownStatus(tracking);
    const latest = tracking.thread.at(-1);
    return {
      status,
      label: shownLabel(tracking),
      mood: moodForStatus(status),
      reply: latest === undefined ? null : { text: latest.text, truncated: latest.truncated },
      pullRequestUrl: tracking.pullRequestUrl,
    };
  }

  private currentMood(): SquishMood {
    if (this.flash !== null) return this.flash;
    const shown = this.pins.flatMap((pin) => {
      const tracking = this.statuses[pin.id];
      return tracking === undefined ? [] : [shownStatus(tracking)];
    });
    return moodFor(shown) ?? "waiting";
  }

  // ---- rendering ----

  private async reload(): Promise<void> {
    this.pins = await this.store.list();
    this.render();
  }

  private render(): void {
    this.view.renderPanel({
      pins: this.pins.map((pin, index) => ({
        id: pin.id,
        number: index + 1,
        comment: pin.comment,
        status: this.statusOf(pin.id),
      })),
      mode: this.mode,
      level: this.level,
      status: this.status,
      mood: this.currentMood(),
      onMode: (mode) => {
        this.mode = mode;
        this.setSelection([]);
        this.render();
      },
      onLevel: (level) => {
        this.level = level;
        this.render();
      },
      send: {
        state: this.send.state,
        target: this.send.target,
        handlers: {
          onOpenPairing: () => this.send.openPairing(),
          onClosePairing: () => this.send.closePairing(),
          onPair: (code, port) => void this.send.pair(code, port),
          onForget: () => void this.send.forget(),
          onRetry: () => void this.send.start(),
          onRefresh: () => void this.send.refresh(),
          onSelect: (pid) => this.send.select(pid),
          onRemember: (remember) => void this.send.rememberSite(remember),
        },
      },
      canSend: this.send.target !== null,
      onCopy: (id) => this.copy(this.pins.filter((pin) => pin.id === id)),
      onCopyAll: () => this.copy(this.pins),
      onSend: (id) => this.sendPins(this.pins.filter((pin) => pin.id === id)),
      onSendAll: () => this.sendPins(this.pins),
      onEdit: (id) => this.edit(id),
      onDelete: (id) => this.remove(id),
      onResolve: (id, resolved) => this.resolve(id, resolved),
      onClose: () => this.stop(),
    });
    const { preview, busy } = this.send.state;
    this.view.renderPreview(
      preview === null
        ? null
        : {
            preview,
            busy,
            onConfirm: () => void this.send.confirm(),
            onCancel: () => this.send.cancelPreview(),
          },
    );
    this.renderMarkers();
  }

  private renderMarkers(): void {
    const markers = this.pins.map((pin, index) => ({
      id: pin.id,
      number: index + 1,
      at: anchorOf(pin),
      status: this.statusOf(pin.id),
    }));
    this.view.renderMarkers(markers, (id) => this.edit(id));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      this.setStatus(error instanceof Error ? error.message : "Something went wrong.", true);
      this.setMood("blocked");
    }
  }

  private setStatus(text: string, error = false): void {
    this.status = { text, error };
    this.render();
  }

  private setMood(mood: SquishMood): void {
    this.flash = mood;
    this.render();
    clearTimeout(this.moodTimer);
    this.moodTimer = setTimeout(() => {
      this.flash = null;
      this.render();
    }, MOOD_RESET_MS);
  }

  private pageElementAt(x: number, y: number): Element | null {
    return (
      document
        .elementsFromPoint(x, y)
        .find(
          (element) => element.localName !== HOST_TAG && element !== document.documentElement,
        ) ?? null
    );
  }
}

/** Where a pin's marker goes: on the live element if it is still there, else where it was. */
function anchorOf(pin: StoredPin): Rect {
  const { context } = pin;
  if (context.area) return context.area;
  const live = context.selector ? safeQuery(context.selector) : null;
  if (live !== null) return pageRect(live);
  return context.rect ?? { x: 16, y: 16, width: 0, height: 0 };
}

function safeQuery(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function describeTarget(target: PinTarget): string {
  switch (target.kind) {
    case "element":
      return `Pin on <${target.element.localName}>`;
    case "elements":
      return `Pin on ${target.elements.length} elements`;
    case "text":
      return "Pin on the selected text";
    case "area":
      return `Pin on an area (${Math.round(target.area.width)}×${Math.round(target.area.height)})`;
  }
}

function block(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.width > 0 &&
    inner.height > 0 &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function isVisible(element: Element): boolean {
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** The deepest element containing all of `elements`. */
function enclosingElement(elements: readonly Element[]): Element | undefined {
  const [first, ...rest] = elements;
  let candidate: Element | null = first ?? null;
  while (candidate !== null && !rest.every((element) => candidate?.contains(element))) {
    candidate = candidate.parentElement;
  }
  return candidate ?? undefined;
}
