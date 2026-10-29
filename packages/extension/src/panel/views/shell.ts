/**
 * The side panel's frame: the header with the Squashflow mark, the chip that says who
 * fixes this site (it opens the session sheet), and Settings; the status line; the green
 * line that confirms the last setup step; the bottom sheet that slides over the inbox;
 * and the preview sheet that stands between every message and its delivery.
 */

import { sessionDisplayName } from "@squashflow/shared";
import { h, type Child } from "../../ui/dom";
import { icon, markup } from "../../ui/icons";
import { squishFace } from "../../ui/squish";
import type { PanelActions, PanelModel } from "../model";

export function header(model: PanelModel, actions: PanelActions): HTMLElement {
  return h("header", { className: "top" }, [
    h("div", { className: "bar" }, [
      brand(),
      h("span", { className: "spacer" }),
      whoChip(model, actions),
      h(
        "button",
        {
          className: "icon-btn",
          attrs: { type: "button", "aria-label": "Settings" },
          on: { click: actions.openSettings },
        },
        [icon("settings")],
      ),
    ]),
  ]);
}

/** A screen's own header: back to the inbox, and its title. */
export function backHeader(title: string, onBack: () => void, end: Child = null): HTMLElement {
  return h("header", { className: "thread-top" }, [
    h(
      "button",
      {
        className: "icon-btn",
        attrs: { type: "button", "aria-label": "Back to all pins" },
        on: { click: onBack },
      },
      [icon("back")],
    ),
    h("b", { text: title, attrs: { style: "font-size: 15px" } }),
    h("span", { className: "spacer" }),
    end,
  ]);
}

export function brand(): HTMLElement {
  return h("span", { className: "brand" }, [
    markup(squishFace()),
    h("span", {}, [h("b", { text: "Squash" }), h("i", { text: "flow" })]),
  ]);
}

/** Who fixes this site: the chosen session as a chip that opens the session sheet. */
function whoChip(model: PanelModel, actions: PanelActions): HTMLElement {
  if (model.settings.copyOnly) return h("span", { className: "pill", text: "Copy by hand" });
  const { state } = model.send.connection;
  if (state === "checking") return h("span", { className: "pill", text: "Checking…" });
  if (state !== "paired") return h("span", { className: "pill", text: "Not connected" });
  const target = model.target;
  const name = target === null ? "Choose who fixes it" : sessionDisplayName(target);
  return h(
    "button",
    {
      className: target === null ? "pill who" : "pill who ok",
      attrs: { type: "button", "aria-label": `Who fixes this site: ${name}` },
      on: { click: actions.openSessions },
    },
    [
      target !== null && h("span", { className: `dot ${target.status}` }),
      h("span", { className: "label", text: name }),
      icon("chevron"),
    ],
  );
}

export function statusLine(model: PanelModel): HTMLElement {
  return h("div", {
    className: model.status?.error === true ? "toast error" : "toast",
    text: model.status?.text ?? "",
    attrs: { role: "status" },
  });
}

/** The short green line that says the last setup step worked. */
export function confirmLine(text: string | null): HTMLElement | null {
  if (text === null) return null;
  return h("div", { className: "confirm" }, [
    h("span", { className: "check" }, [icon("check", 3)]),
    h("span", { text }),
  ]);
}

/** A bottom sheet over the inbox; the scrim and the close button dismiss it. */
export function bottomSheet(label: string, onClose: () => void, children: Child[]): HTMLElement {
  const scrim = h("div", { className: "scrim" }, [
    h("section", { className: "sheet", attrs: { role: "dialog", "aria-label": label } }, [
      h("div", { className: "sheet-top" }, [
        h("span", { className: "handle", attrs: { "aria-hidden": "true" } }),
        h(
          "button",
          {
            className: "icon-btn",
            attrs: { type: "button", "aria-label": "Close" },
            on: { click: onClose },
          },
          [icon("close")],
        ),
      ]),
      ...children,
    ]),
  ]);
  scrim.addEventListener("click", (event) => {
    if (event.target === scrim) onClose();
  });
  return scrim;
}

/** Exactly what the session will receive, with Send and Cancel. */
export function previewSheet(model: PanelModel, actions: PanelActions): HTMLElement | null {
  const { preview, busy } = model.send;
  if (preview === null) return null;
  return h("div", { className: "scrim" }, [
    h(
      "section",
      { className: "sheet", attrs: { role: "dialog", "aria-label": "Message preview" } },
      [
        h("div", { className: "head" }, [
          h("span", { className: "eyebrow", text: "Check before it goes" }),
          h("h2", { className: "title md", text: `Exactly what ${preview.sessionName} will get` }),
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
              text: previewSendLabel(model),
              attrs: { type: "button", ...(busy ? { disabled: "" } : {}) },
              on: { click: actions.confirm },
            }),
          ]),
          h("span", {
            className: "caption",
            text: "Nothing reaches Claude until you press Send.",
          }),
        ]),
      ],
    ),
  ]);
}

function previewSendLabel(model: PanelModel): string {
  const preview = model.send.preview;
  if (preview === null) return "";
  if (preview.kind === "follow-up") return "Send to Claude";
  if (preview.followUp !== null) return "Send reply to Claude";
  return sendLabel(preview.outgoing.pins.length);
}

/** The one send wording, everywhere: "Send 2 pins to Claude". */
export function sendLabel(count: number): string {
  return `Send ${count === 1 ? "1 pin" : `${count} pins`} to Claude`;
}
