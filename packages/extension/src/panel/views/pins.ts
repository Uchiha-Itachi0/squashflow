/**
 * B3, the inbox: the page's pins as chats, grouped by who acts next (Needs you, Claude is
 * on it, Ready to send, Fixed), each row saying where its pin stands (animated while
 * Claude works on it), with the one send button in the footer. B5, copy by hand: the
 * same pins, nothing sent; how much a copy includes lives in Settings. With pin mode off
 * on the tab, a way to turn it on.
 */

import { DETAIL_LEVELS, type DetailLevel } from "@squashflow/shared";
import { shownLabel } from "../../status/pin-status";
import type { StoredPin } from "../../store/pins";
import { h } from "../../ui/dom";
import { icon, markup } from "../../ui/icons";
import { squishSvg } from "../../ui/squish";
import { pullRequestLabel, timeAgo } from "../format";
import type { PanelActions, PanelModel } from "../model";
import {
  INBOX_GROUPS,
  inboxGroup,
  pinProgress,
  pinState,
  PROGRESS_LABELS,
  replyForDisplay,
  type PinState,
} from "../thread";
import { connectView } from "./connect";
import { confirmLine, sendLabel } from "./shell";

/** How much a copy includes, in plain words. */
export const LEVEL_LABELS: Record<DetailLevel, string> = {
  compact: "Short",
  standard: "Normal",
  detailed: "Full",
  forensic: "+ Screenshot",
};

/** How much of Claude's latest reply a pin row shows. */
const QUOTE_CHARS = 80;

export function pinsView(model: PanelModel, actions: PanelActions): HTMLElement[] {
  if (model.page.kind !== "on") return pinModeOff(model, actions);
  if (model.settings.copyOnly) return copyOnlyView(model, actions);
  if (model.send.connection.state !== "paired" || model.send.pairingOpen) {
    return connectView(model, actions);
  }
  const drafts = model.pins.filter((pin) => model.statuses[pin.id] === undefined).length;
  return [
    h("div", { className: "scroll" }, [
      h("div", { className: "stack" }, [confirmLine(model.confirmed), inbox(model, actions)]),
    ]),
    model.pins.length > 0 &&
      h("footer", { className: "foot" }, [
        drafts > 0 &&
          h("button", {
            className: "btn primary",
            text: sendLabel(drafts),
            attrs: { type: "button", ...(model.send.busy ? { disabled: "" } : {}) },
            on: { click: actions.go },
          }),
        h("span", { className: "caption center" }, [
          drafts > 0 && "You'll see the message before it goes. · ",
          h("button", {
            className: "link-btn inline",
            text: "Copy all",
            attrs: { type: "button" },
            on: { click: actions.copyAll },
          }),
        ]),
      ]),
  ].filter((part): part is HTMLElement => part !== false);
}

function inbox(model: PanelModel, actions: PanelActions): HTMLElement {
  if (model.pins.length === 0) return noPins();
  const rows = model.pins.map((pin, index) => ({
    pin,
    number: index + 1,
    group: inboxGroup(pinState(model.statuses[pin.id])),
  }));
  return h("div", { className: "inbox" }, [
    h("p", { className: "hint", text: PIN_HINT }),
    ...INBOX_GROUPS.flatMap(([group, title]) => {
      const inGroup = rows.filter((row) => row.group === group);
      if (inGroup.length === 0) return [];
      return [
        h("section", { className: "group", attrs: { "aria-label": title } }, [
          h("h2", { className: "eyebrow", text: `${title} · ${inGroup.length}` }),
          h(
            "ol",
            { className: "pins" },
            inGroup.map(({ pin, number }) => h("li", {}, [pinRow(pin, number, model, actions)])),
          ),
        ]),
      ];
    }),
  ]);
}

/** What a pin is, in one line, above the list. */
const PIN_HINT = "Each pin is a comment on this page. Open one to chat with Claude about it.";

/** No pins on the page yet: what a pin is, and how to make one. */
function noPins(): HTMLElement {
  return h("div", { className: "no-pins" }, [
    h("span", { className: "squish" }, [markup(squishSvg("waiting"))]),
    h("h2", { className: "title md", text: "No pins yet" }),
    h("ol", { className: "how" }, [
      h("li", { text: "Click anything on the page." }),
      h("li", { text: "Say what to change. That's a pin." }),
      h("li", { text: "Send it. Claude fixes it, and you chat about it here." }),
    ]),
  ]);
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

function pinRow(
  pin: StoredPin,
  number: number,
  model: PanelModel,
  actions: PanelActions,
): HTMLElement {
  const tracking = model.statuses[pin.id];
  const state = pinState(tracking);
  const progress = pinProgress(tracking);
  const dot = pinDot(state, number);
  if (progress !== null) dot.classList.add("pulse");
  return h(
    "button",
    {
      className: state === "draft" ? "pin draft" : "pin",
      attrs: { type: "button", "aria-label": `Open pin ${number}`, "data-pin": pin.id },
      on: { click: () => actions.openPin(pin.id) },
    },
    [
      dot,
      h("span", { className: "main" }, [
        h("span", { className: "comment", text: pin.comment }),
        progress === null
          ? h("span", { className: "meta", text: pinMeta(pin, state, model) })
          : h("span", { className: `meta working-tag ${progress}` }, [
              h("span", { className: "dots", attrs: { "aria-hidden": "true" } }, [
                h("i"),
                h("i"),
                h("i"),
              ]),
              PROGRESS_LABELS[progress],
            ]),
      ]),
    ],
  );
}

/** One short line under a pin: what Claude said last, or where it stands, and when. */
function pinMeta(pin: StoredPin, state: PinState, model: PanelModel): string {
  const tracking = model.statuses[pin.id];
  if (tracking === undefined) return timeAgo(pin.createdAt, model.now);
  const when = timeAgo(tracking.updatedAt, model.now);
  if (state === "fixed" && tracking.pullRequestUrl !== null) {
    return `${pullRequestLabel(tracking.pullRequestUrl)} · Merge it, then mark done`;
  }
  const latest = tracking.thread.at(-1);
  const said = latest === undefined ? "" : oneLine(replyForDisplay(latest.text));
  const what = said === "" ? shownLabel(tracking) : `Claude: “${said}”`;
  return when === "" ? what : `${what} · ${when}`;
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= QUOTE_CHARS ? flat : `${flat.slice(0, QUOTE_CHARS - 1)}…`;
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
            ? "Squashflow is off on this tab. Turn it on, then click anything on the page to pin a comment to it."
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

/** B5: nothing is sent; the pins to copy into any chat with Claude. */
function copyOnlyView(model: PanelModel, actions: PanelActions): HTMLElement[] {
  const count = model.pins.length;
  return [
    h("div", { className: "scroll" }, [
      h("div", { className: "stack" }, [
        h("div", { className: "note" }, [
          "You copy pins and paste them into Claude yourself. ",
          h("button", {
            className: "link-btn inline",
            text: "Connect instead",
            attrs: { type: "button" },
            on: { click: actions.connectAgain },
          }),
        ]),
        count === 0
          ? noPins()
          : h("section", { className: "group", attrs: { "aria-label": "On this page" } }, [
              h("h2", { className: "eyebrow", text: `On this page · ${count}` }),
              h(
                "ol",
                { className: "pins" },
                model.pins.map((pin, index) =>
                  h("li", {}, [pinRow(pin, index + 1, model, actions)]),
                ),
              ),
            ]),
      ]),
    ]),
    h("footer", { className: "foot" }, [
      h("button", {
        className: "btn primary",
        text: count === 1 ? "Copy 1 pin" : `Copy ${count} pins`,
        attrs: { type: "button", ...(count === 0 ? { disabled: "" } : {}) },
        on: { click: actions.copyAll },
      }),
      h("span", { className: "caption center" }, [
        `Includes: ${LEVEL_LABELS[model.settings.level]}. `,
        h("button", {
          className: "link-btn inline",
          text: "Change in Settings",
          attrs: { type: "button" },
          on: { click: actions.openSettings },
        }),
      ]),
    ]),
  ];
}

/** How much a copy includes: Short, Normal, Full, + Screenshot. */
export function levelPicker(model: PanelModel, actions: PanelActions, id: string): HTMLElement {
  return h("div", { className: "stack tight" }, [
    h("span", { className: "eyebrow", text: "Include", attrs: { id } }),
    h(
      "div",
      { className: "seg-light", attrs: { role: "radiogroup", "aria-labelledby": id } },
      DETAIL_LEVELS.map((level) =>
        h("button", {
          text: LEVEL_LABELS[level],
          attrs: {
            type: "button",
            role: "radio",
            "aria-checked": String(model.settings.level === level),
          },
          on: { click: () => actions.setLevel(level) },
        }),
      ),
    ),
  ]);
}
