/**
 * The side panel's frame: the header with the Squashflow mark and the helper's state,
 * the Pins / Sessions / Settings tabs, the status line, and the preview sheet that
 * stands between every message and its delivery.
 */

import { h } from "../../ui/dom";
import { markup } from "../../ui/icons";
import { squishFace } from "../../ui/squish";
import type { PanelActions, PanelModel } from "../model";
import type { PanelTab } from "../protocol";

export function header(model: PanelModel, actions: PanelActions, withTabs: boolean): HTMLElement {
  const drafts = model.pins.length;
  const tab = (id: PanelTab, label: string): HTMLButtonElement =>
    h("button", {
      className: "tab",
      text: label,
      attrs: { type: "button", role: "tab", "aria-selected": String(model.tab === id) },
      on: { click: () => actions.setTab(id) },
    });
  return h("header", { className: "top" }, [
    h("div", { className: "bar" }, [
      brand(),
      h("span", { className: "spacer" }),
      connectionPill(model),
    ]),
    withTabs &&
      h("nav", { className: "tabs", attrs: { role: "tablist", "aria-label": "Squashflow" } }, [
        tab("pins", drafts === 0 ? "Pins" : `Pins · ${drafts}`),
        tab("sessions", "Sessions"),
        tab("settings", "Settings"),
      ]),
  ]);
}

export function brand(): HTMLElement {
  return h("span", { className: "brand" }, [
    markup(squishFace()),
    h("span", {}, [h("b", { text: "Squash" }), h("i", { text: "flow" })]),
  ]);
}

function connectionPill(model: PanelModel): HTMLElement {
  if (model.settings.copyOnly) return h("span", { className: "pill", text: "Copy mode" });
  const { state } = model.send.connection;
  const [text, tone] =
    state === "paired"
      ? ["Helper on", "ok"]
      : state === "unreachable"
        ? ["Helper not running", "warn"]
        : state === "checking"
          ? ["Checking…", ""]
          : ["Not connected", ""];
  return h("span", { className: `pill ${tone}` }, [h("span", { className: "dot" }), text]);
}

export function statusLine(model: PanelModel): HTMLElement {
  return h("div", {
    className: model.status?.error === true ? "toast error" : "toast",
    text: model.status?.text ?? "",
    attrs: { role: "status" },
  });
}

/** Exactly what the session will receive, with Send and Cancel. */
export function previewSheet(model: PanelModel, actions: PanelActions): HTMLElement | null {
  const { preview, busy } = model.send;
  if (preview === null) return null;
  const to = `claude@${preview.sessionName}`;
  return h("div", { className: "scrim" }, [
    h(
      "section",
      { className: "sheet", attrs: { role: "dialog", "aria-label": "Message preview" } },
      [
        h("div", { className: "head" }, [
          h("span", { className: "eyebrow", text: "Check before it goes" }),
          h("h2", { className: "title md", text: `Exactly what ${to} will receive` }),
        ]),
        h("pre", { text: preview.message }),
        h("div", { className: "foot" }, [
          h("div", { className: "row" }, [
            h("button", {
              className: "btn",
              text: "Cancel",
              attrs: { type: "button" },
              on: { click: actions.cancelPreview },
            }),
            h("button", {
              className: "btn primary grow",
              text: `Send to ${to}`,
              attrs: { type: "button", ...(busy ? { disabled: "" } : {}) },
              on: { click: actions.confirm },
            }),
          ]),
          h("span", {
            className: "caption",
            text: "Nothing reaches the session until you press Send.",
          }),
        ]),
      ],
    ),
  ]);
}
