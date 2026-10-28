/**
 * P3, pins on this page: where pins go and how (send each now, or batch then Go), Squish
 * saying what is going on, the page's pins as cards, and Copy all with Go in the footer.
 * P6, copy only: the same pins as one message to paste anywhere, at a chosen detail level.
 * With pin mode off on the tab, a way to turn it on.
 */

import { DETAIL_LEVELS, type DetailLevel } from "@squashflow/shared";
import { buildCopyText } from "../../copy/copy";
import { shownLabel } from "../../status/pin-status";
import type { StoredPin } from "../../store/pins";
import { h } from "../../ui/dom";
import { icon, markup } from "../../ui/icons";
import { squishFace, squishSvg, type SquishMood } from "../../ui/squish";
import { pullRequestLabel, shortUrl, timeAgo } from "../format";
import type { PanelActions, PanelModel } from "../model";
import { pinState, type PinState } from "../thread";
import { connectView } from "./connect";

const LEVEL_LABELS: Record<DetailLevel, string> = {
  compact: "Compact",
  standard: "Standard",
  detailed: "Detailed",
  forensic: "Forensic",
};

export function pinsView(model: PanelModel, actions: PanelActions): HTMLElement[] {
  if (model.page.kind !== "on") return pinModeOff(model, actions);
  if (model.settings.copyOnly) return copyOnlyView(model, actions);
  if (model.send.connection.state !== "paired" || model.send.pairingOpen) {
    return connectView(model, actions);
  }
  const drafts = model.pins.filter((pin) => model.statuses[pin.id] === undefined);
  const target = model.target;
  const goLabel =
    target === null
      ? "Pick a session first"
      : drafts.length === 0
        ? `Go · nothing to send`
        : `Go · send ${drafts.length === 1 ? "1 pin" : `${drafts.length} pins`} to ${target.name}`;
  return [
    h("div", { className: "scroll" }, [
      targetBar(model, actions),
      squishSays(model),
      pageHead(model.page.url),
      pinList(model, actions),
    ]),
    h("footer", { className: "foot" }, [
      h("div", { className: "row" }, [
        h(
          "button",
          {
            className: "btn",
            attrs: { type: "button", ...(model.pins.length === 0 ? { disabled: "" } : {}) },
            on: { click: actions.copyAll },
          },
          [icon("copy"), "Copy all"],
        ),
        h("button", {
          className: "btn primary grow",
          text: goLabel,
          attrs: {
            type: "button",
            ...(drafts.length === 0 || target === null || model.send.busy ? { disabled: "" } : {}),
          },
          on: { click: actions.go },
        }),
      ]),
      h("span", { className: "caption", text: "You'll see exactly what is sent before it goes." }),
    ]),
  ];
}

function targetBar(model: PanelModel, actions: PanelActions): HTMLElement {
  const target = model.target;
  const mode = (value: "now" | "batch", label: string): HTMLButtonElement =>
    h("button", {
      text: label,
      attrs: {
        type: "button",
        role: "radio",
        "aria-checked": String(model.settings.sendMode === value),
      },
      on: { click: () => actions.setSendMode(value) },
    });
  return h("section", { className: "target", attrs: { "aria-label": "Where pins go" } }, [
    h("div", { className: "line" }, [
      h("span", { className: `dot ${target?.status ?? ""}` }),
      target === null
        ? h("span", { text: "No session picked yet" })
        : h("span", {}, ["Sending to ", h("b", { text: target.name })]),
      target !== null && h("span", { className: "soft", text: `· ${target.status}` }),
      h("span", { className: "spacer" }),
      h("button", {
        text: target === null ? "Pick one" : "Change",
        attrs: { type: "button" },
        on: { click: () => actions.setTab("sessions") },
      }),
    ]),
    h("div", { className: "modes", attrs: { role: "radiogroup", "aria-label": "Send mode" } }, [
      mode("now", "Send each pin now"),
      mode("batch", "Batch, then Go"),
    ]),
  ]);
}

/** Squish's one line about the page: what Claude is on, and what waits for the user. */
function squishSays(model: PanelModel): HTMLElement {
  const states = model.pins.map((pin) => pinState(model.statuses[pin.id]));
  const numbered = (wanted: (state: PinState) => boolean): number[] =>
    states.flatMap((state, index) => (wanted(state) ? [index + 1] : []));
  const needs = numbered((state) => state === "blocked" || state === "approve-in-terminal");
  const working = numbered((state) => state === "seen" || state === "sent");
  const drafts = numbered((state) => state === "draft");
  const parts: string[] = [];
  if (model.pins.length === 0) parts.push("Click anything on the page to pin it.");
  if (needs.length > 0)
    parts.push(`${pinsText(needs)} ${needs.length === 1 ? "needs" : "need"} you.`);
  if (working.length > 0) parts.push(`Claude has ${pinsText(working).toLowerCase()}.`);
  if (drafts.length > 0) {
    parts.push(
      model.settings.sendMode === "batch"
        ? `${pinsText(drafts)} ${drafts.length === 1 ? "is" : "are"} waiting for your Go!`
        : `${pinsText(drafts)} ${drafts.length === 1 ? "is" : "are"} not sent yet.`,
    );
  }
  if (parts.length === 0) parts.push("All squashed. Nice.");
  const mood: SquishMood =
    needs.length > 0
      ? "blocked"
      : working.length > 0
        ? "working"
        : drafts.length === 0 && model.pins.length > 0
          ? "squashed"
          : "waiting";
  return h("div", { className: "say" }, [
    h("span", { className: "face" }, [markup(squishFace(mood))]),
    h("div", { className: "bubble", text: parts.join(" ") }),
  ]);
}

function pinsText(numbers: readonly number[]): string {
  return numbers.length === 1 ? `Pin ${numbers[0]}` : `Pins ${numbers.join(", ")}`;
}

function pageHead(url: string): HTMLElement {
  return h("div", { className: "page-head" }, [
    h("h1", { className: "title md", text: "This page" }),
    h("span", { className: "mono", text: shortUrl(url), title: url }),
  ]);
}

function pinList(model: PanelModel, actions: PanelActions): HTMLElement {
  if (model.pins.length === 0) {
    return h("p", {
      className: "caption",
      attrs: { style: "padding: 0 16px" },
      text: "No pins on this page yet. Use the toolbar at the bottom of the page.",
    });
  }
  return h(
    "ol",
    { className: "pins", attrs: { "aria-label": "Pins on this page" } },
    model.pins.map((pin, index) => h("li", {}, [pinCard(pin, index + 1, model, actions)])),
  );
}

export function pinDot(state: PinState, number: number): HTMLElement {
  const done = state === "fixed" || state === "resolved";
  return h("span", { className: `pin-dot ${state}`, attrs: { "aria-hidden": "true" } }, [
    done ? icon("check", 3) : String(number),
  ]);
}

export function stateChip(state: PinState, label: string): HTMLElement {
  const tone =
    state === "fixed" || state === "resolved"
      ? "ok"
      : state === "blocked"
        ? "danger"
        : state === "approve-in-terminal"
          ? "warn"
          : state === "draft"
            ? ""
            : "accent";
  return h("span", { className: `chip ${tone}`, text: label });
}

function pinCard(
  pin: StoredPin,
  number: number,
  model: PanelModel,
  actions: PanelActions,
): HTMLElement {
  const tracking = model.statuses[pin.id];
  const state = pinState(tracking);
  const latest = tracking?.thread.at(-1);
  const label =
    tracking === undefined
      ? model.settings.sendMode === "batch"
        ? "Draft · waits for Go"
        : "Draft"
      : shownLabel(tracking);
  return h(
    "button",
    {
      className: state === "draft" ? "pin draft" : "pin",
      attrs: { type: "button", "aria-label": `Open pin ${number}`, "data-pin": pin.id },
      on: { click: () => actions.openPin(pin.id) },
    },
    [
      pinDot(state, number),
      h("span", { className: "main" }, [
        h("span", { className: "comment", text: pin.comment }),
        latest !== undefined && h("span", { className: "quote", text: latest.text }),
        h("span", { className: "meta" }, [
          stateChip(state, label),
          tracking?.pullRequestUrl != null &&
            h("span", {
              text: pullRequestLabel(tracking.pullRequestUrl),
              attrs: { style: "font-weight: 600; color: var(--accent-text)" },
            }),
          tracking !== undefined && h("span", { text: timeAgo(tracking.updatedAt, model.now) }),
          tracking === undefined &&
            pin.context.selector !== undefined &&
            h("span", { className: "mono", text: pin.context.selector }),
        ]),
      ]),
    ],
  );
}

/** Pin mode is not running on the active tab, or there is no web page. */
function pinModeOff(model: PanelModel, actions: PanelActions): HTMLElement[] {
  const hasTab = model.page.kind === "off";
  return [
    h("div", { className: "scroll" }, [
      h("div", { className: "empty" }, [
        h("span", { className: "squish" }, [markup(squishSvg("waiting"))]),
        h("h1", { className: "title lg" }, ["Pin right ", h("i", { text: "where you see it" })]),
        h("p", {
          className: "lead",
          text: hasTab
            ? "Pin mode is off on this tab. Turn it on, then click anything on the page to pin a comment to it."
            : "Open a web page, then press the Squashflow button in the toolbar to pin on it.",
        }),
        hasTab &&
          h("button", {
            className: "btn primary",
            text: "Start pinning on this page",
            attrs: { type: "button" },
            on: { click: actions.startPinning },
          }),
        h("p", {
          className: "caption",
          text: "Squashflow only sees the pages you turn it on for. The toolbar button (Alt+Shift+P) does the same.",
        }),
      ]),
    ]),
  ];
}

/** P6: nothing is sent; the pins as one message to copy, at a chosen detail level. */
function copyOnlyView(model: PanelModel, actions: PanelActions): HTMLElement[] {
  const pageUrl = model.page.kind === "on" ? model.page.url : "";
  const site = pageUrl === "" ? "this site" : new URL(pageUrl).host;
  const level = (value: DetailLevel): HTMLButtonElement =>
    h("button", {
      text: LEVEL_LABELS[value],
      attrs: {
        type: "button",
        role: "radio",
        "aria-checked": String(model.settings.level === value),
      },
      on: { click: () => actions.setLevel(value) },
    });
  const count = model.pins.length;
  const text =
    count === 0
      ? "No pins on this page yet."
      : buildCopyText({ pins: model.pins, level: model.settings.level, pageUrl });
  return [
    h("div", { className: "scroll" }, [
      h("div", { className: "stack", attrs: { style: "padding: 16px; gap: 14px" } }, [
        h("section", { className: "notice warn" }, [
          h("b", { text: `Copy mode on ${site}`, attrs: { style: "font-size: 14.5px" } }),
          h("span", {
            text: "So nothing is sent to Claude. Your pins are saved on this laptop and you can copy them anywhere.",
          }),
          h("button", {
            className: "link-btn",
            text: "Connect to your terminal instead →",
            attrs: { type: "button", style: "font-size: 13px" },
            on: { click: actions.connectAgain },
          }),
        ]),
        h("div", { attrs: { style: "display: flex; flex-direction: column; gap: 8px" } }, [
          h("span", {
            className: "eyebrow",
            text: "How much detail",
            attrs: { id: "level-label" },
          }),
          h(
            "div",
            {
              className: "seg-light",
              attrs: { role: "radiogroup", "aria-labelledby": "level-label" },
            },
            DETAIL_LEVELS.map(level),
          ),
        ]),
        h("div", { attrs: { style: "display: flex; flex-direction: column; gap: 8px" } }, [
          h("span", {
            className: "eyebrow",
            text: `Preview · ${count === 1 ? "1 pin" : `${count} pins`}`,
          }),
          h("pre", {
            className: "copy-preview",
            text,
            attrs: { "aria-label": "What Copy puts on the clipboard" },
          }),
        ]),
      ]),
    ]),
    h("footer", { className: "foot" }, [
      h("button", {
        className: "btn dark",
        text: count === 1 ? "Copy 1 pin" : `Copy ${count} pins`,
        attrs: { type: "button", ...(count === 0 ? { disabled: "" } : {}) },
        on: { click: actions.copyAll },
      }),
    ]),
  ];
}
