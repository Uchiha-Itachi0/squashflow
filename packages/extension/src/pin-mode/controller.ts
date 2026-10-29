/**
 * Pin mode on the current page. While it is on, clicks on the page place pins instead
 * of reaching the page. The toolbar picks how: Element (click an element, or drag an
 * area), Text (select text), Area (drag a box) or Multi (click several elements, then
 * pin them together; Shift+click does the same in Element). Escape closes the comment
 * box, then clears a selection, then exits.
 * Each new pin gets a region screenshot of the visible tab, taken with the pin UI hidden.
 * The page shows only the pin tools, the markers and the comment box; the side panel,
 * connected through `PanelLink`, does everything else: sending, copying, the session,
 * and every helper call.
 */

import type { PageContext, Rect, Screenshot } from "@squashflow/shared";
import { capturePin, pageRect, type PinTarget } from "../capture/context";
import {
  pinRegion,
  visibleRegion,
  type ScreenshotReply,
  type ScreenshotRequest,
} from "../capture/screenshot";
import { DRAG_THRESHOLD_PX, HOST_TAG } from "../constants";
import { DEFAULT_SETTINGS, SettingsStore, watchSettings, type Settings } from "../settings";
import { shownLabel, shownStatus, type PinStatuses } from "../status/pin-status";
import { chromeStatusSource, type StatusSource } from "../status/store";
import { pinPageUrl, watchPins, type PinStore, type StoredPin } from "../store/pins";
import { addPageFonts } from "../ui/page-fonts";
import { PinView, type MarkerView, type PinModeKind } from "../ui/view";
import { PanelLink } from "./panel-link";

const MAX_AREA_ELEMENTS = 20;
/** How long a status line stays on the page. */
const STATUS_MS = 6000;

interface Drag {
  startX: number;
  startY: number;
  area: Rect | null;
}

export class PinMode {
  private readonly view = new PinView();
  private readonly settingsStore = new SettingsStore(chrome.storage.local);
  private readonly link: PanelLink;
  private pins: StoredPin[] = [];
  private mode: PinModeKind = "element";
  private settings: Settings = DEFAULT_SETTINGS;
  private selection: Element[] = [];
  private drag: Drag | null = null;
  /** Set while a new pin's screenshot is being taken; further pins wait for it. */
  private capturing = false;
  private statuses: PinStatuses = {};
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly cleanups: (() => void)[] = [];
  private readonly listeners: [string, EventListener, Window | Document][] = [];

  constructor(
    private readonly store: PinStore,
    private readonly onStop: () => void,
    private readonly statusSource: StatusSource = chromeStatusSource(),
  ) {
    this.link = new PanelLink({
      pageUrl: () => pinPageUrl(location.href),
      onStop: () => this.stop(),
    });
  }

  async start(): Promise<void> {
    this.cleanups.push(addPageFonts());
    this.listen(window, "mousemove", (event) => this.onMove(event as MouseEvent));
    this.listen(window, "mousedown", (event) => this.onDown(event as MouseEvent));
    this.listen(window, "mouseup", (event) => this.onUp(event as MouseEvent));
    this.listen(window, "click", (event) => this.onClick(event));
    this.listen(window, "keydown", (event) => this.onKeyDown(event as KeyboardEvent));
    this.listen(window, "keyup", (event) => this.onKeyUp(event as KeyboardEvent));
    this.listen(window, "resize", () => this.renderMarkers());
    this.render();
    this.settings = await this.settingsStore.read();
    this.cleanups.push(
      watchSettings((settings) => {
        this.settings = settings;
        this.render();
      }),
    );
    this.statuses = await this.statusSource.read();
    this.cleanups.push(
      this.statusSource.watch((statuses) => {
        this.statuses = statuses;
        this.render();
      }),
    );
    this.cleanups.push(watchPins(location.href, () => void this.reload()));
    await this.reload();
    this.link.start();
  }

  stop(): void {
    for (const [type, listener, target] of this.listeners) {
      target.removeEventListener(type, listener, true);
    }
    for (const cleanup of this.cleanups) cleanup();
    clearTimeout(this.statusTimer);
    this.link.stop();
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
    if (this.mode === "area") {
      this.view.showHover(null);
      return;
    }
    const target = this.pageElementAt(event.clientX, event.clientY);
    this.view.showHover(target === null ? null : pageRect(target));
  }

  private onDown(event: MouseEvent): void {
    if (this.view.owns(event) || event.button !== 0 || this.mode === "text") return;
    block(event);
    if (this.view.composing || this.mode === "multi") return;
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
    if (this.mode === "area") return;
    const target = this.pageElementAt(event.clientX, event.clientY);
    if (target === null) return;
    if (event.shiftKey || this.mode === "multi") this.toggleSelected(target);
    else this.compose({ kind: "element", element: target });
  }

  private onClick(event: Event): void {
    if (!this.view.owns(event)) block(event);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter" && this.mode === "multi" && !this.view.composing) {
      block(event);
      this.pinSelection();
      return;
    }
    if (event.key !== "Escape") return;
    block(event);
    if (this.view.composing) this.view.closeComposer();
    else if (this.selection.length > 0) this.setSelection([]);
    else this.stop();
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.key !== "Shift" || this.mode === "multi" || this.view.composing) return;
    this.pinSelection();
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
    this.renderToolbar();
  }

  /** Turn the elements picked in Multi mode (or with Shift) into one pin. */
  private pinSelection(): void {
    const elements = this.selection;
    if (elements.length === 0) return;
    this.setSelection([]);
    this.compose(
      elements.length === 1 && elements[0]
        ? { kind: "element", element: elements[0] }
        : { kind: "elements", elements },
    );
  }

  private compose(target: PinTarget): void {
    if (this.capturing) return;
    this.capturing = true;
    const context = capturePin(target);
    this.view.showHover(null);
    void this.screenshot(context)
      .then((screenshot) => {
        this.openNewPin(target, context, screenshot);
      })
      .finally(() => {
        this.capturing = false;
      });
  }

  /**
   * A crop of the visible tab around the pin, taken by the service worker with the pin
   * UI hidden. Pins are still saved without one when it cannot be taken.
   */
  private async screenshot(context: PageContext): Promise<Screenshot | undefined> {
    const region = pinRegion(context);
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
    const visible =
      region === null
        ? null
        : visibleRegion(region, { x: window.scrollX, y: window.scrollY }, viewport);
    if (visible === null) return undefined;
    const request: ScreenshotRequest = { type: "screenshot", region: visible, viewport };
    const reply = await this.view.hiddenWhile(async () => {
      try {
        return await chrome.runtime.sendMessage<ScreenshotRequest, ScreenshotReply | undefined>(
          request,
        );
      } catch {
        return undefined;
      }
    });
    return reply?.ok === true ? reply.value : undefined;
  }

  private openNewPin(
    target: PinTarget,
    context: PageContext,
    screenshot: Screenshot | undefined,
  ): void {
    this.view.openComposer({
      anchor: context.area ??
        context.rect ?? { x: 16, y: window.scrollY + 16, width: 0, height: 0 },
      number: this.pins.length + 1,
      where: context.selector ?? describeTarget(target),
      hint: this.saveHint(),
      screenshot: screenshot !== undefined,
      onSave: (comment, includeScreenshot) => {
        void this.run(async () => {
          const pin = await this.store.add({
            comment,
            context,
            screenshot: includeScreenshot ? screenshot : undefined,
          });
          this.view.closeComposer();
          window.getSelection()?.removeAllRanges();
          await this.reload();
          if (this.sendsEachPin()) this.link.send({ type: "send-pin", pinId: pin.id });
        });
      },
      onCancel: () => this.view.closeComposer(),
    });
  }

  private sendsEachPin(): boolean {
    return this.settings.sendMode === "now" && !this.settings.copyOnly;
  }

  private saveHint(): string {
    if (this.settings.copyOnly) return "Saved here · copy it from the side panel";
    if (this.sendsEachPin()) return "You check it in the side panel before it goes";
    return "Send it from the side panel";
  }

  // ---- toolbar ----

  private setMode(mode: PinModeKind): void {
    this.mode = mode;
    this.setSelection([]);
    this.view.showHover(null);
  }

  // ---- rendering ----

  private async reload(): Promise<void> {
    this.pins = await this.store.list();
    this.render();
  }

  private render(): void {
    this.renderToolbar();
    this.renderMarkers();
  }

  private renderToolbar(): void {
    this.view.renderToolbar({
      mode: this.mode,
      selected: this.selection.length,
      onMode: (mode) => this.setMode(mode),
      onPinSelection: () => this.pinSelection(),
      onClose: () => this.stop(),
    });
  }

  private renderMarkers(): void {
    const markers: MarkerView[] = this.pins.map((pin, index) => {
      const tracking = this.statuses[pin.id];
      return {
        id: pin.id,
        number: index + 1,
        at: anchorOf(pin),
        parts: partsOf(pin),
        status:
          tracking === undefined
            ? null
            : { status: shownStatus(tracking), label: shownLabel(tracking) },
      };
    });
    this.view.renderMarkers(markers, (id) => this.link.send({ type: "open-pin", pinId: id }));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      this.setStatus(error instanceof Error ? error.message : "Something went wrong.", true);
    }
  }

  private setStatus(text: string, error = false): void {
    this.view.showStatus({ text, error });
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.view.showStatus(null), STATUS_MS);
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

/** Where each element of a multi-element pin is: live if still there, else where it was. */
function partsOf(pin: StoredPin): Rect[] {
  const { context } = pin;
  if (context.kind !== "elements") return [];
  return [context, ...(context.elements ?? [])].flatMap((element) => {
    const live = element.selector ? safeQuery(element.selector) : null;
    if (live !== null) return [pageRect(live)];
    return element.rect === undefined ? [] : [element.rect];
  });
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
      return `<${target.element.localName}>`;
    case "elements":
      return `${target.elements.length} elements`;
    case "text":
      return "Selected text";
    case "area":
      return `Area ${Math.round(target.area.width)} × ${Math.round(target.area.height)}`;
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
