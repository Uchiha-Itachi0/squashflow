/**
 * The pin UI: a host element with a shadow root holding the overlay layer (hover box,
 * selection, dragged area, markers, comment box) and the fixed panel.
 * Rendering only; the pin mode controller owns state and decides what to show.
 */

import { DETAIL_LEVELS, type DetailLevel, type Rect } from "@squashflow/shared";
import { HOST_TAG } from "../constants";
import { h, placeBox } from "./dom";
import { squishSvg, type SquishMood } from "./squish";
import { PIN_UI_CSS } from "./styles";

export type PinModeKind = "element" | "text";

export interface PanelPin {
  id: string;
  number: number;
  comment: string;
}

export interface PanelProps {
  pins: readonly PanelPin[];
  mode: PinModeKind;
  level: DetailLevel;
  status: { text: string; error: boolean } | null;
  mood: SquishMood;
  onMode: (mode: PinModeKind) => void;
  onLevel: (level: DetailLevel) => void;
  onCopy: (id: string) => void;
  onCopyAll: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export interface ComposerProps {
  anchor: Rect;
  heading: string;
  initial: string;
  editing: boolean;
  onSave: (comment: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}

const HINTS: Record<PinModeKind, string> = {
  element:
    "Click an element to pin it. Drag to pin an area. Shift+click several, then release Shift.",
  text: "Select text to pin it.",
};
const LEVEL_LABELS: Record<DetailLevel, string> = {
  compact: "Compact",
  standard: "Standard",
  detailed: "Detailed",
  forensic: "Forensic (no screenshots yet)",
};
const COMPOSER_WIDTH = 260;
const COMPOSER_GAP = 8;

export class PinView {
  readonly host: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly hoverBox: HTMLElement;
  private readonly areaBox: HTMLElement;
  private readonly selectionLayer: HTMLElement;
  private readonly markerLayer: HTMLElement;
  private readonly panelSlot: HTMLElement;
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
    this.panelSlot = h("div");
    shadow.append(h("style", { text: PIN_UI_CSS }), this.overlay, this.panelSlot);
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
      ...boxes.map((box) => {
        const element = h("div", { className: "box selected" });
        placeBox(element, box);
        return element;
      }),
    );
  }

  renderMarkers(
    markers: readonly { id: string; number: number; at: Rect }[],
    onOpen: (id: string) => void,
  ): void {
    this.markerLayer.replaceChildren(
      ...markers.map(({ id, number, at }) => {
        const marker = h("button", {
          className: "marker",
          text: String(number),
          title: `Pin ${number}`,
          attrs: { "data-pin": id, "aria-label": `Edit pin ${number}` },
          on: { click: () => onOpen(id) },
        });
        marker.style.left = `${at.x}px`;
        marker.style.top = `${at.y}px`;
        return marker;
      }),
    );
  }

  renderPanel(props: PanelProps): void {
    this.panelSlot.replaceChildren(panel(props));
  }

  openComposer(props: ComposerProps): void {
    this.closeComposer();
    const field = h("textarea", {
      attrs: {
        "aria-label": "Comment",
        placeholder: "What should change here?",
        maxlength: "8000",
      },
    });
    field.value = props.initial;
    const save = (): void => {
      if (field.value.trim() !== "") props.onSave(field.value.trim());
    };
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        save();
      }
    });
    const composer = h("div", { className: "composer", attrs: { role: "dialog" } }, [
      h("div", { className: "what", text: props.heading }),
      field,
      h("div", { className: "row" }, [
        props.editing &&
          h("button", { className: "danger", text: "Delete", on: { click: props.onDelete } }),
        h("span", { className: "spacer" }),
        h("button", { text: "Cancel", on: { click: props.onCancel } }),
        h("button", { className: "primary", text: "Save", on: { click: save } }),
      ]),
    ]);
    const maxX = document.documentElement.scrollWidth - COMPOSER_WIDTH - COMPOSER_GAP;
    composer.style.left = `${Math.max(COMPOSER_GAP, Math.min(props.anchor.x, maxX))}px`;
    composer.style.top = `${props.anchor.y + props.anchor.height + COMPOSER_GAP}px`;
    this.overlay.append(composer);
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

function panel(props: PanelProps): HTMLElement {
  const squish = h("div", { className: "squish" });
  squish.innerHTML = squishSvg(props.mood);
  const modeButton = (mode: PinModeKind, label: string): HTMLButtonElement =>
    h("button", {
      text: label,
      attrs: { "aria-pressed": String(props.mode === mode) },
      on: { click: () => props.onMode(mode) },
    });
  const level: HTMLSelectElement = h(
    "select",
    {
      attrs: { "aria-label": "Copy detail level" },
      on: { change: () => props.onLevel(readLevel(level.value)) },
    },
    DETAIL_LEVELS.map((value) => {
      const option = h("option", { text: LEVEL_LABELS[value], attrs: { value } });
      option.selected = value === props.level;
      return option;
    }),
  );
  return h("section", { className: "panel", attrs: { "aria-label": "Squashflow pins" } }, [
    h("header", {}, [
      squish,
      h("span", { className: "title", text: "Squashflow" }),
      h("div", { className: "modes" }, [
        modeButton("element", "Element"),
        modeButton("text", "Text"),
      ]),
      h("button", {
        text: "×",
        title: "Exit pin mode (Esc)",
        attrs: { "aria-label": "Exit pin mode" },
        on: { click: props.onClose },
      }),
    ]),
    h("div", { className: "hint", text: HINTS[props.mode] }),
    props.pins.length === 0
      ? h("div", { className: "empty", text: "No pins on this page yet." })
      : h(
          "ol",
          { className: "list" },
          props.pins.map((pin) => pinRow(pin, props)),
        ),
    h("div", {
      className: `status${props.status?.error === true ? " error" : ""}`,
      text: props.status?.text ?? "",
      attrs: { role: "status" },
    }),
    h("footer", {}, [
      level,
      h("button", {
        className: "primary",
        text: "Copy all",
        attrs: props.pins.length === 0 ? { disabled: "" } : {},
        on: { click: props.onCopyAll },
      }),
    ]),
  ]);
}

function pinRow(pin: PanelPin, props: PanelProps): HTMLLIElement {
  return h("li", { attrs: { "data-pin": pin.id } }, [
    h("span", { className: "badge", text: String(pin.number) }),
    h("span", { className: "comment", text: pin.comment, title: pin.comment }),
    h("span", { className: "actions" }, [
      h("button", {
        text: "Copy",
        attrs: { "aria-label": `Copy pin ${pin.number}` },
        on: { click: () => props.onCopy(pin.id) },
      }),
      h("button", {
        text: "Edit",
        attrs: { "aria-label": `Edit pin ${pin.number}` },
        on: { click: () => props.onEdit(pin.id) },
      }),
      h("button", {
        className: "danger",
        text: "Delete",
        attrs: { "aria-label": `Delete pin ${pin.number}` },
        on: { click: () => props.onDelete(pin.id) },
      }),
    ]),
  ]);
}

function readLevel(value: string): DetailLevel {
  return DETAIL_LEVELS.find((level) => level === value) ?? "standard";
}

function showBox(element: HTMLElement, box: Rect | null): void {
  element.style.display = box === null ? "none" : "block";
  if (box !== null) placeBox(element, box);
}
