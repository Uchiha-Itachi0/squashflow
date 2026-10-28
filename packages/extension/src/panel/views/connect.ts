/**
 * P1, connect the helper: run `npx squashflow`, type the pairing code it prints. Shown in
 * the Pins tab until the browser is paired, unless the user chose to copy and paste.
 */

import { h } from "../../ui/dom";
import { icon, markup } from "../../ui/icons";
import { squishSvg } from "../../ui/squish";
import type { PanelActions, PanelModel } from "../model";

export function connectView(model: PanelModel, actions: PanelActions): HTMLElement[] {
  const { connection, busy } = model.send;
  const { code, port } = model.fields;
  if (port.value === "") port.value = String(connection.port);
  code.onkeydown = (event) => {
    if (event.key === "Enter") actions.pair();
  };
  const unreachable = connection.state === "unreachable";
  return [
    h("div", { className: "scroll" }, [
      h("div", { className: "stack", attrs: { style: "padding: 24px 20px; gap: 18px" } }, [
        h("div", { attrs: { style: "display: flex; flex-direction: column; gap: 8px" } }, [
          h("span", { className: "squish-hello", attrs: { style: "width: 72px; height: 62px" } }, [
            markup(squishSvg("waiting")),
          ]),
          h("span", { className: "eyebrow", text: "One-time setup" }),
          h("h1", { className: "title xl" }, ["Connect to ", h("i", { text: "your terminal" })]),
          h("p", {
            className: "lead",
            text: "So your pins can reach the Claude Code you already have open.",
          }),
        ]),
        h("section", { className: "card" }, [
          h("div", { className: "step" }, [
            h("span", { className: "num", text: "1" }),
            "Run this in any terminal",
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
          h("p", {
            className: "caption",
            attrs: { style: "margin: 0; font-size: 13px" },
            text: unreachable
              ? connection.message
              : "It starts a small helper and prints a pairing code.",
          }),
        ]),
        h("section", { className: "card" }, [
          h("div", { className: "step" }, [
            h("span", { className: "num", text: "2" }),
            h("label", { text: "Type the code it shows", attrs: { for: "pair-code" } }),
          ]),
          code,
          h("div", { className: "set-row" }, [
            h("label", { className: "muted", text: "Helper port", attrs: { for: "pair-port" } }),
            port,
          ]),
          h("button", {
            className: "btn primary",
            text: busy ? "Connecting…" : "Connect",
            attrs: { type: "button", ...(busy ? { disabled: "" } : {}) },
            on: { click: actions.pair },
          }),
        ]),
        h("div", { className: "notice" }, [
          icon("lock"),
          h("span", {
            text: "The helper only runs on this laptop and only answers this paired browser. Your code and GitHub login never leave your machine.",
          }),
        ]),
      ]),
    ]),
    h("footer", { className: "foot", attrs: { style: "gap: 4px" } }, [
      connection.state === "paired"
        ? h("button", {
            className: "link-btn",
            text: "Cancel, keep the current pairing",
            attrs: { type: "button" },
            on: { click: actions.cancelPairing },
          })
        : h("button", {
            className: "link-btn",
            text: "Skip, I'll just copy and paste →",
            attrs: { type: "button" },
            on: { click: actions.skipToCopy },
          }),
      h("span", {
        className: "caption",
        text: "You can pin and copy without connecting anything.",
      }),
    ]),
  ];
}
