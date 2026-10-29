/**
 * What pin mode shows on the page (U1 on the design canvas): a host element with a
 * shadow root holding the overlay layer (hover box, selection, dragged area, numbered
 * markers coloured by status, the small comment box), the dark toolbar and a one-line
 * status. Everything else lives in the side panel.
 * Rendering only; the pin mode controller owns state and decides what to show.
 */

import type { Rect } from "@squashflow/shared";
import { HOST_TAG } from "../constants";
import type { ShownStatus } from "../status/pin-status";
import { h, placeBox } from "./dom";
import { icon } from "./icons";
import { PIN_UI_CSS } from "./styles";

export type PinModeKind = "element" | "text" | "area" | "multi";

export interface MarkerView {
  id: string;
  number: number;
  at: Rect;
  /** Each element of a multi-element pin, in the order picked; empty for other pins. */
  parts: readonly Rect[];
  /** Null while the pin is a draft. */
  status: { status: ShownStatus; label: string } | null;
}

/** Pin tools only: sending, copying and the session live in the side panel. */
export interface ToolbarProps {
  mode: PinModeKind;
  /** Elements picked in Multi mode, waiting to become one pin. */
  selected: number;
  onMode: (mode: PinModeKind) => void;
  onPinSelection: () => void;
  onClose: () => void;
}

export interface ComposerProps {
  anchor: Rect;
  number: number;
  /** What was pinned: a selector, or a short description. */
  where: string;
  /** What happens on Save, e.g. "Send it from the side panel". */
  hint: string;
  /** Offer to keep the region screenshot taken for the pin (ticked by default). */
  screenshot: boolean;
  /** `includeScreenshot` is false when the user unticked it, or none was offered. */
  onSave: (comment: string, includeScreenshot: boolean) => void;
  onCancel: () => void;
}

const COMPOSER_WIDTH = 330;
const COMPOSER_GAP = 10;
/** Half a marker and a little more: how far its centre stays from the page's edges. */
const MARKER_INSET = 18;
/** The toolbar's height and margin, which the comment box stays above. */
const TOOLBAR_CLEARANCE = 84;

const MODES: readonly [PinModeKind, string, string][] = [
  ["element", "Element", "Click an element to pin it. Drag to pin an area."],
  ["text", "Text", "Select text to pin it."],
  ["area", "Area", "Drag a box around what you want to pin."],
  ["multi", "Multi", "Click several elements, then pin them together."],
];

export class PinView {
  readonly host: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly hoverBox: HTMLElement;
  private readonly areaBox: HTMLElement;
  private readonly selectionLayer: HTMLElement;
  private readonly markerLayer: HTMLElement;
  private readonly toolbarSlot: HTMLElement;
  private readonly toast: HTMLElement;
  private composer: HTMLElement | null = null;

  constructor() {
    this.host = document.createElement(HOST_TAG);
    // Open so tests can drive the UI; page CSS cannot reach in either way.
    const shadow = this.host.attachShadow({ mode: "open" });
    this.hoverBox = h("div", { className: "box" });
    this.areaBox = h("div", { className: "box area" });
    this.selectionLayer = h("div", { className: "layer" });
    this.markerLayer = h("div", { className: "layer" });
    this.overlay = h("div", { className: "layer" }, [
      this.hoverBox,
      this.areaBox,
      this.selectionLayer,
      this.markerLayer,
    ]);
    this.toolbarSlot = h("div");
    this.toast = h("div", { className: "toast", attrs: { role: "status" } });
    shadow.append(h("style", { text: PIN_UI_CSS }), this.overlay, this.toast, this.toolbarSlot);
    this.showHover(null);
    this.showArea(null);
    // Keys typed in the pin UI must not trigger the page's own shortcuts.
    for (const type of ["keydown", "keyup", "keypress"] as const) {
      this.host.addEventListener(type, (event) => {
        event.stopPropagation();
      });
    }
    document.documentElement.append(this.host);
  }

  /**
   * Run `action` with the pin UI hidden and painted out, so a capture of the visible tab
   * shows only the page.
   */
  async hiddenWhile<T>(action: () => Promise<T>): Promise<T> {
    const parts = [this.overlay, this.toolbarSlot, this.toast];
    for (const part of parts) part.style.visibility = "hidden";
    try {
      await nextPaint();
      return await action();
    } finally {
      for (const part of parts) part.style.visibility = "";
    }
  }

  /** Whether an event started inside the pin UI. */
  owns(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  destroy(): void {
    this.host.remove();
  }

  showHover(box: Rect | null): void {
    showBox(this.hoverBox, box);
  }

  showArea(box: Rect | null): void {
    showBox(this.areaBox, box);
  }

  showSelection(boxes: readonly Rect[]): void {
    this.selectionLayer.replaceChildren(
      ...boxes.map((box, index) => partBox("box selected", box, String(index + 1))),
    );
  }

  showStatus(status: { text: string; error: boolean } | null): void {
    this.toast.textContent = status?.text ?? "";
    this.toast.className = status?.error === true ? "toast error" : "toast";
  }

  renderMarkers(markers: readonly MarkerView[], onOpen: (id: string) => void): void {
    const parts = markers.flatMap(({ number, parts }) =>
      parts.map((box, index) => partBox("box part", box, `${number}.${index + 1}`)),
    );
    this.markerLayer.replaceChildren(
      ...parts,
      ...markers.map(({ id, number, at, status }) => {
        const done = status?.status === "fixed" || status?.status === "resolved";
        const label = `Pin ${number}: ${status === null ? "draft" : status.label}`;
        const marker = h(
          "button",
          {
            className: status === null ? "marker" : `marker s-${status.status}`,
            title: label,
            attrs: {
              "data-pin": id,
              "aria-label": label,
              ...(status === null ? {} : { "data-status": status.status }),
            },
            on: { click: () => onOpen(id) },
          },
          [done ? icon("check", 3) : String(number)],
        );
        // At the element's top right corner, kept inside the page for full-width elements.
        const maxX = document.documentElement.scrollWidth - MARKER_INSET;
        marker.style.left = `${Math.max(MARKER_INSET, Math.min(at.x + at.width, maxX))}px`;
        marker.style.top = `${Math.max(MARKER_INSET, at.y)}px`;
        return marker;
      }),
    );
  }

  renderToolbar(props: ToolbarProps): void {
    this.toolbarSlot.replaceChildren(toolbar(props));
  }

  openComposer(props: ComposerProps): void {
    this.closeComposer();
    const field = h("textarea", {
      attrs: {
        id: "squashflow-comment",
        "aria-label": "Comment",
        placeholder: "What should change here?",
        maxlength: "8000",
      },
    });
    const keep = h("input", { attrs: { type: "checkbox" } });
    keep.checked = true;
    const save = (): void => {
      if (field.value.trim() !== "") {
        props.onSave(field.value.trim(), props.screenshot && keep.checked);
      }
    };
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        save();
      }
    });
    const composer = h(
      "div",
      { className: "composer", attrs: { role: "dialog", "aria-label": `Pin ${props.number}` } },
      [
        h("div", { className: "head" }, [
          h("b", { text: `Pin ${props.number}` }),
          h("span", { className: "where", text: props.where, title: props.where }),
        ]),
        field,
        props.screenshot &&
          h(
            "label",
            { className: "shot", title: "A screenshot of this region, as it shows on screen" },
            [keep, "Attach a screenshot"],
          ),
        h("div", { className: "row" }, [
          h("span", { className: "hint", text: props.hint }),
          h("span", { className: "spacer" }),
          h("button", { className: "btn", text: "Cancel", on: { click: props.onCancel } }),
          h("button", { className: "btn primary", text: "Save pin", on: { click: save } }),
        ]),
      ],
    );
    const maxX = document.documentElement.scrollWidth - COMPOSER_WIDTH - COMPOSER_GAP;
    const right = props.anchor.x + props.anchor.width + COMPOSER_GAP;
    const left = right <= maxX ? right : Math.max(COMPOSER_GAP, Math.min(props.anchor.x, maxX));
    const top =
      right <= maxX ? props.anchor.y : props.anchor.y + props.anchor.height + COMPOSER_GAP;
    composer.style.left = `${left}px`;
    this.overlay.append(composer);
    // Keep it in view and clear of the toolbar at the bottom of the window.
    const lowest = window.scrollY + window.innerHeight - composer.offsetHeight - TOOLBAR_CLEARANCE;
    composer.style.top = `${Math.max(window.scrollY + COMPOSER_GAP, Math.min(top, lowest))}px`;
    this.composer = composer;
    field.focus({ preventScroll: true });
  }

  closeComposer(): void {
    this.composer?.remove();
    this.composer = null;
  }

  get composing(): boolean {
    return this.composer !== null;
  }
}

function toolbar(props: ToolbarProps): HTMLElement {
  const modeButton = ([mode, label, hint]: (typeof MODES)[number]): HTMLButtonElement =>
    h(
      "button",
      {
        className: "tb",
        title: hint,
        attrs: { type: "button", "aria-pressed": String(props.mode === mode) },
        on: { click: () => props.onMode(mode) },
      },
      [icon(mode), label],
    );
  return h(
    "div",
    { className: "toolbar", attrs: { role: "toolbar", "aria-label": "Squashflow toolbar" } },
    [
      ...MODES.map(modeButton),
      props.mode === "multi" &&
        h("button", {
          className: "tb pick",
          text: `Pin ${props.selected} selected`,
          attrs: { type: "button", ...(props.selected === 0 ? { disabled: "" } : {}) },
          on: { click: props.onPinSelection },
        }),
      h("span", { className: "spacer" }),
      h(
        "button",
        {
          className: "tb",
          title: "Exit pin mode (Esc)",
          attrs: { type: "button", "aria-label": "Exit pin mode" },
          on: { click: props.onClose },
        },
        [icon("close")],
      ),
    ],
  );
}

/** Resolve after the browser has painted the current state of the page twice. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** An outlined element with its number, so each element of a multi pin can be told apart. */
function partBox(className: string, box: Rect, tag: string): HTMLElement {
  const element = h("div", { className }, [h("span", { className: "tag", text: tag })]);
  placeBox(element, box);
  return element;
}

function showBox(element: HTMLElement, box: Rect | null): void {
  element.style.display = box === null ? "none" : "block";
  if (box !== null) placeBox(element, box);
}
