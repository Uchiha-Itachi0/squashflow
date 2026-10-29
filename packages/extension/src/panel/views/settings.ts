/**
 * Settings: the connection to the terminal (connect again, disconnect, the port), how
 * pins are sent, copying by hand and how much a copy includes, and pin mode on this tab.
 * The technical words the main view avoids live here.
 */

import { h } from "../../ui/dom";
import type { PanelActions, PanelModel } from "../model";
import { levelPicker } from "./pins";

export function settingsView(model: PanelModel, actions: PanelActions): HTMLElement[] {
  const { connection, busy } = model.send;
  const disabled = busy ? { disabled: "" } : {};
  const { port } = model.fields;
  if (port.value === "") port.value = String(connection.port);
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
  const connectionLine =
    connection.state === "paired"
      ? `Connected to Squashflow in your terminal (version ${connection.version}).`
      : connection.state === "unreachable"
        ? "Can't reach Squashflow on this laptop. Run npx squashflow in a terminal."
        : connection.state === "checking"
          ? "Checking…"
          : "Not connected.";
  return [
    h("div", { className: "scroll" }, [
      h("div", { className: "stack", attrs: { style: "gap: 14px" } }, [
        h("section", { className: "card" }, [
          h("span", { className: "eyebrow", text: "Connection" }),
          h("p", {
            className: "lead",
            attrs: { style: "font-size: 13.5px" },
            text: connectionLine,
          }),
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
              text: connection.state === "paired" ? "Connect again" : "Connect",
              attrs: { type: "button", ...disabled },
              on: {
                click: connection.state === "paired" ? actions.rePair : actions.connectAgain,
              },
            }),
            connection.state !== "unpaired" &&
              h("button", {
                className: "btn small",
                text: "Disconnect",
                attrs: { type: "button", ...disabled },
                on: { click: actions.forget },
              }),
          ]),
          h("div", { className: "set-row" }, [
            h("label", { className: "muted", text: "Port", attrs: { for: "pair-port" } }),
            port,
          ]),
          h("p", {
            className: "caption",
            attrs: { style: "margin: 0" },
            text: "Change the port only if you started Squashflow with a different one. It is used the next time you connect.",
          }),
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
              radio(model.settings.sendMode, "batch", "Collect, then send", actions.setSendMode),
              radio(model.settings.sendMode, "now", "Send each pin", actions.setSendMode),
            ],
          ),
          h("p", {
            className: "caption",
            attrs: { style: "margin: 0" },
            text: "Send each pin opens the message as soon as you save a pin. Either way, you see it before it goes.",
          }),
          h("label", { className: "set-row" }, [
            copyOnlyBox(model, actions),
            "Copy by hand: never send, only copy",
          ]),
        ]),
        h("section", { className: "card" }, [
          levelPicker(model, actions, "level-label-settings"),
          h("p", {
            className: "caption",
            attrs: { style: "margin: 0" },
            text: "+ Screenshot adds the pin's screenshot. What you type into form fields is never captured.",
          }),
        ]),
        model.page.kind === "on" &&
          h("section", { className: "card" }, [
            h("span", { className: "eyebrow", text: "This tab" }),
            h("button", {
              className: "btn small",
              text: "Stop pinning on this page",
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
