/**
 * The pin UI: a host element with a shadow root holding the overlay layer (hover box,
 * selection, dragged area, markers, comment box) and the fixed panel.
 * Rendering only; the pin mode controller owns state and decides what to show.
 */

import { DETAIL_LEVELS, type DetailLevel, type Rect } from "@squashflow/shared";
import { HOST_TAG } from "../constants";
import { h, placeBox } from "./dom";
import {
  pairingFields,
  previewDialog,
  sendSection,
  type PairingFields,
  type PreviewProps,
  type SendSectionProps,
} from "./send-view";
import type { ShownStatus } from "../status/pin-status";
import { gitHubOptions, type GitHubBlockView, type GitHubChoice } from "./github-view";
import { squishSvg, type SquishMood } from "./squish";
import { PIN_UI_CSS } from "./styles";

export type PinModeKind = "element" | "text";

/** A sent pin's status as the panel and its marker show it. */
export interface PinStatusView {
  status: ShownStatus;
  label: string;
  mood: SquishMood;
  /** Claude's latest reply: untrusted, always rendered as plain text. */
  reply: { text: string; truncated: boolean } | null;
  pullRequestUrl: string | null;
  /** Set while the pin is Blocked: GitHub access, to offer the ways out. */
  github: GitHubBlockView | null;
}

export interface PanelPin {
  id: string;
  number: number;
  comment: string;
  /** Whether the pin has a region screenshot. */
  hasScreenshot: boolean;
  status: PinStatusView | null;
}

export interface MarkerView {
  id: string;
  number: number;
  at: Rect;
  status: PinStatusView | null;
}

export interface PanelProps {
  pins: readonly PanelPin[];
  mode: PinModeKind;
  level: DetailLevel;
  status: { text: string; error: boolean } | null;
  mood: SquishMood;
  onMode: (mode: PinModeKind) => void;
  onLevel: (level: DetailLevel) => void;
  /** The Claude Code section, without the pairing inputs the view keeps itself. */
  send: Omit<SendSectionProps, "fields">;
  /** Whether a session is chosen, so pins can be sent. */
  canSend: boolean;
  onCopy: (id: string) => void;
  onCopyAll: () => void;
  onCopyScreenshot: (id: string) => void;
  onSend: (id: string) => void;
  onSendAll: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onResolve: (id: string, resolved: boolean) => void;
  onGitHub: (id: string, choice: GitHubChoice) => void;
  onClose: () => void;
}

export interface ComposerProps {
  anchor: Rect;
  heading: string;
  initial: string;
  editing: boolean;
  /** Offer to keep the region screenshot taken for a new pin (ticked by default). */
  screenshot: boolean;
  /** `includeScreenshot` is false when the user unticked it, or none was offered. */
  onSave: (comment: string, includeScreenshot: boolean) => void;
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
  forensic: "Forensic (with screenshots)",
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
  private readonly previewSlot: HTMLElement;
  private readonly pairing: PairingFields = pairingFields();
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
    this.previewSlot = h("div");
    shadow.append(h("style", { text: PIN_UI_CSS }), this.overlay, this.panelSlot, this.previewSlot);
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
    const parts = [this.overlay, this.panelSlot, this.previewSlot];
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
      ...boxes.map((box) => {
        const element = h("div", { className: "box selected" });
        placeBox(element, box);
        return element;
      }),
    );
  }

  renderMarkers(markers: readonly MarkerView[], onOpen: (id: string) => void): void {
    this.markerLayer.replaceChildren(
      ...markers.map(({ id, number, at, status }) => {
        const marker = h("button", {
          className: status === null ? "marker" : `marker s-${status.status}`,
          text: String(number),
          title: status === null ? `Pin ${number}` : `Pin ${number}: ${status.label}`,
          attrs: {
            "data-pin": id,
            "aria-label": `Edit pin ${number}`,
            ...(status === null ? {} : { "data-status": status.status }),
          },
          on: { click: () => onOpen(id) },
        });
        marker.style.left = `${at.x}px`;
        marker.style.top = `${at.y}px`;
        return marker;
      }),
    );
  }

  renderPanel(props: PanelProps): void {
    this.panelSlot.replaceChildren(panel(props, this.pairing));
  }

  /** The message preview dialog, or nothing. */
  renderPreview(props: PreviewProps | null): void {
    this.previewSlot.replaceChildren(...(props === null ? [] : [previewDialog(props)]));
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
    const keep = h("input", { attrs: { type: "checkbox" } });
    keep.checked = true;
    const save = (): void => {
      if (field.value.trim() !== "")
        props.onSave(field.value.trim(), props.screenshot && keep.checked);
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
      props.screenshot &&
        h(
          "label",
          { className: "keep-shot", title: "A screenshot of this region, as it shows on screen" },
          [keep, "Include screenshot"],
        ),
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

function panel(props: PanelProps, fields: PairingFields): HTMLElement {
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
    sendSection({ ...props.send, fields }),
    h("footer", {}, [
      level,
      h("button", {
        className: props.canSend ? "" : "primary",
        text: "Copy all",
        attrs: props.pins.length === 0 ? { disabled: "" } : {},
        on: { click: props.onCopyAll },
      }),
      props.canSend &&
        h("button", {
          className: "primary",
          text: "Send all",
          attrs: props.pins.length === 0 || props.send.state.busy ? { disabled: "" } : {},
          on: { click: props.onSendAll },
        }),
    ]),
  ]);
}

function pinRow(pin: PanelPin, props: PanelProps): HTMLLIElement {
  const { status } = pin;
  return h("li", { attrs: { "data-pin": pin.id } }, [
    h("span", { className: "badge", text: String(pin.number) }),
    h("div", { className: "body" }, [
      h("span", { className: "comment", text: pin.comment, title: pin.comment }),
    ]),
    h("span", { className: "actions" }, [
      props.canSend &&
        h("button", {
          text: "Send",
          attrs: { "aria-label": `Send pin ${pin.number}` },
          on: { click: () => props.onSend(pin.id) },
        }),
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
    (pin.hasScreenshot || status !== null) &&
      h("div", { className: "details" }, [
        pin.hasScreenshot &&
          h("div", { className: "shot" }, [
            h("span", { className: "shot-tag", text: "Screenshot" }),
            h("button", {
              className: "link",
              text: "Copy screenshot",
              attrs: { "aria-label": `Copy screenshot of pin ${pin.number}` },
              on: { click: () => props.onCopyScreenshot(pin.id) },
            }),
          ]),
        status !== null && pinStatus(pin, status, props),
      ]),
  ]);
}

/**
 * The status chip, Claude's reply as plain text, the pull request link, Resolve or Reopen,
 * and the ways out of Blocked: GitHub access.
 */
function pinStatus(pin: PanelPin, status: PinStatusView, props: PanelProps): HTMLElement {
  const mood = h("span", { className: "mini-squish" });
  // Constant markup chosen by mood; no reply or page text goes into it.
  mood.innerHTML = squishSvg(status.mood);
  const resolved = status.status === "resolved";
  return h("div", { className: "pin-status" }, [
    h("div", { className: "row" }, [
      h("span", { className: `chip pin-state s-${status.status}` }, [mood, status.label]),
      status.pullRequestUrl !== null &&
        h("a", {
          className: "pr-link",
          text: pullRequestLabel(status.pullRequestUrl),
          attrs: {
            href: status.pullRequestUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            "aria-label": `Pull request for pin ${pin.number}`,
          },
        }),
      h("span", { className: "spacer" }),
      h("button", {
        className: "link",
        text: resolved ? "Reopen" : "Resolve",
        attrs: { "aria-label": `${resolved ? "Reopen" : "Resolve"} pin ${pin.number}` },
        on: { click: () => props.onResolve(pin.id, !resolved) },
      }),
    ]),
    status.reply !== null &&
      h("p", {
        className: "reply",
        text: status.reply.truncated ? `${status.reply.text} … (cut)` : status.reply.text,
        attrs: { "aria-label": `Claude's reply to pin ${pin.number}` },
      }),
    status.github !== null &&
      !resolved &&
      gitHubOptions(pin.number, status.github, props.send.state.busy, (choice) =>
        props.onGitHub(pin.id, choice),
      ),
  ]);
}

function pullRequestLabel(url: string): string {
  const number = /\/pull\/([0-9]+)/.exec(url)?.[1];
  return number === undefined ? "Pull request" : `PR #${number}`;
}

function readLevel(value: string): DetailLevel {
  return DETAIL_LEVELS.find((level) => level === value) ?? "standard";
}

/** Resolve after the browser has painted the current state of the page twice. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function showBox(element: HTMLElement, box: Rect | null): void {
  element.style.display = box === null ? "none" : "block";
  if (box !== null) placeBox(element, box);
}
