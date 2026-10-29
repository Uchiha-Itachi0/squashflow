/**
 * B1, first open: say what Squashflow does, then the one-time connect as a card in the
 * inbox: run `npx squashflow`, type the code it prints, Connect. Shown until the browser
 * is connected, unless the user chose to copy pins by hand. The port lives in Settings.
 */

import { h } from "../../ui/dom";
import type { PanelActions, PanelModel } from "../model";

export function connectView(model: PanelModel, actions: PanelActions): HTMLElement[] {
  const { connection, busy } = model.send;
  const { code } = model.fields;
  code.onkeydown = (event) => {
    if (event.key === "Enter") actions.pair();
  };
  const unreachable = connection.state === "unreachable";
  return [
    h("div", { className: "scroll" }, [
      h("div", { className: "stack", attrs: { style: "padding: 20px 16px; gap: 14px" } }, [
        h("h1", { className: "title lg" }, [
          "Click anything on the page. ",
          h("i", { text: "Claude fixes it." }),
        ]),
        h("p", {
          className: "lead",
          text: "Your pins land here as chats. Connect once so they reach Claude Code.",
        }),
        h("section", { className: "card" }, [
          h("div", { className: "step" }, [
            h("span", { className: "num", text: "1" }),
            "Run this in your terminal",
          ]),
          h("div", { className: "cmd" }, [
            h("span", { className: "prompt", text: "$" }),
            "npx squashflow",
            h("span", { className: "spacer" }),
            h("button", {
              text: "Copy",
              attrs: { type: "button", "aria-label": "Copy command" },
              on: { click: actions.copyCommand },
            }),
          ]),
          unreachable &&
            h("p", {
              className: "caption",
              attrs: { style: "margin: 0; font-size: 13px" },
              text: "Squashflow isn't running on this laptop yet. Run the command, then connect.",
            }),
          h("div", { className: "step" }, [
            h("span", { className: "num", text: "2" }),
            h("label", { text: "Type the code it prints", attrs: { for: "pair-code" } }),
          ]),
          code,
        ]),
        h("p", {
          className: "caption",
          attrs: { style: "margin: 0" },
          text: "Stays on this laptop. Your code never leaves it.",
        }),
      ]),
    ]),
    h("footer", { className: "foot" }, [
      h("button", {
        className: "btn primary",
        text: busy ? "Connecting…" : "Connect",
        attrs: { type: "button", ...(busy ? { disabled: "" } : {}) },
        on: { click: actions.pair },
      }),
      connection.state === "paired"
        ? h("button", {
            className: "link-btn",
            text: "Cancel, stay connected",
            attrs: { type: "button" },
            on: { click: actions.cancelPairing },
          })
        : h("button", {
            className: "link-btn",
            text: "Skip. I'll copy pins by hand.",
            attrs: { type: "button" },
            on: { click: actions.skipToCopy },
          }),
    ]),
  ];
}
