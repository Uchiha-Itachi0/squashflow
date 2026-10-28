/**
 * Settings: the helper connection (re-pair, forget), how pins are sent, how much detail
 * Copy includes, copy mode, and pin mode on this tab.
 */

import { DETAIL_LEVELS, type DetailLevel } from "@squashflow/shared";
import { h } from "../../ui/dom";
import type { PanelActions, PanelModel } from "../model";

const LEVELS: Record<DetailLevel, string> = {
  compact: "Compact",
  standard: "Standard",
  detailed: "Detailed",
  forensic: "Forensic",
};

export function settingsView(model: PanelModel, actions: PanelActions): HTMLElement[] {
  const { connection, busy } = model.send;
  const disabled = busy ? { disabled: "" } : {};
  const radio = <T extends string>(
    current: T,
    value: T,
    label: string,
    onPick: (value: T) => void,
  ): HTMLButtonElement =>
    h("button", {
      text: label,
      attrs: { type: "button", role: "radio", "aria-checked": String(current === value) },
      on: { click: () => onPick(value) },
    });
  const helperLine =
    connection.state === "paired"
      ? `Connected to the helper on port ${connection.port} (version ${connection.version}).`
      : connection.state === "unreachable"
        ? connection.message
        : connection.state === "checking"
          ? "Checking the helper…"
          : "Not connected to the helper.";
  return [
    h("div", { className: "scroll" }, [
      h("div", { className: "stack", attrs: { style: "gap: 14px" } }, [
        h("section", { className: "card" }, [
          h("span", { className: "eyebrow", text: "Helper" }),
          h("p", { className: "lead", attrs: { style: "font-size: 13.5px" }, text: helperLine }),
          h("div", { attrs: { style: "display: flex; gap: 8px; flex-wrap: wrap" } }, [
            connection.state === "unreachable" &&
              h("button", {
                className: "btn small",
                text: "Try again",
                attrs: { type: "button", ...disabled },
                on: { click: actions.retry },
              }),
            h("button", {
              className: "btn small",
              text: connection.state === "paired" ? "Re-pair" : "Connect",
              attrs: { type: "button", ...disabled },
              on: {
                click: connection.state === "paired" ? actions.rePair : actions.connectAgain,
              },
            }),
            connection.state !== "unpaired" &&
              h("button", {
                className: "btn small",
                text: "Forget pairing",
                attrs: { type: "button", ...disabled },
                on: { click: actions.forget },
              }),
          ]),
        ]),
        h("section", { className: "card" }, [
          h("span", { className: "eyebrow", text: "Sending", attrs: { id: "send-mode-label" } }),
          h(
            "div",
            {
              className: "seg-light",
              attrs: { role: "radiogroup", "aria-labelledby": "send-mode-label" },
            },
            [
              radio(model.settings.sendMode, "now", "Send each pin now", actions.setSendMode),
              radio(model.settings.sendMode, "batch", "Batch, then Go", actions.setSendMode),
            ],
          ),
          h("label", { className: "set-row" }, [
            copyOnlyBox(model, actions),
            "Copy mode: never send, only copy",
          ]),
        ]),
        h("section", { className: "card" }, [
          h("span", {
            className: "eyebrow",
            text: "Copy detail",
            attrs: { id: "level-label-settings" },
          }),
          h(
            "div",
            {
              className: "seg-light",
              attrs: { role: "radiogroup", "aria-labelledby": "level-label-settings" },
            },
            DETAIL_LEVELS.map((level) =>
              radio(model.settings.level, level, LEVELS[level], actions.setLevel),
            ),
          ),
          h("p", {
            className: "caption",
            attrs: { style: "margin: 0" },
            text: "Forensic adds the pin's screenshot. What you type into form fields is never captured.",
          }),
        ]),
        model.page.kind === "on" &&
          h("section", { className: "card" }, [
            h("span", { className: "eyebrow", text: "This tab" }),
            h("button", {
              className: "btn small",
              text: "Stop pin mode on this page",
              attrs: { type: "button" },
              on: { click: actions.stopPinning },
            }),
          ]),
      ]),
    ]),
  ];
}

function copyOnlyBox(model: PanelModel, actions: PanelActions): HTMLInputElement {
  const box: HTMLInputElement = h("input", {
    attrs: { type: "checkbox" },
    on: { change: () => (box.checked ? actions.skipToCopy() : actions.connectAgain()) },
  });
  box.checked = model.settings.copyOnly;
  return box;
}
