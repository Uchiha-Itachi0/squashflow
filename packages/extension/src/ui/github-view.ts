/**
 * The ways out of Blocked: GitHub access, under a pin's status: Log in (then Retry),
 * Fork and open a PR, Copy the patch, Ask the owner. Rendering only; the pin mode
 * controller decides what each one does.
 */

import { h } from "./dom";

export type GitHubChoice = "login" | "retry" | "fork" | "patch" | "owner";

export interface GitHubBlockView {
  /** The session's one-line reason: untrusted, rendered as plain text. */
  reason: string | null;
  /** Whether the Log in instruction is showing. */
  loginOpen: boolean;
}

export function gitHubOptions(
  number: number,
  block: GitHubBlockView,
  busy: boolean,
  onChoose: (choice: GitHubChoice) => void,
): HTMLElement {
  const button = (choice: GitHubChoice, text: string): HTMLButtonElement =>
    h("button", {
      text,
      attrs: { "aria-label": `${text} for pin ${number}`, ...(busy ? { disabled: "" } : {}) },
      on: { click: () => onChoose(choice) },
    });
  return h(
    "div",
    {
      className: "github",
      attrs: { role: "group", "aria-label": `GitHub access for pin ${number}` },
    },
    [
      block.reason !== null && h("div", { className: "note", text: `Reason: ${block.reason}` }),
      h("div", { className: "options" }, [
        button("login", "Log in"),
        button("fork", "Fork and open a PR"),
        button("patch", "Copy the patch"),
        button("owner", "Ask the owner"),
      ]),
      block.loginOpen &&
        h("div", { className: "row login" }, [
          h("span", {
            className: "note spacer",
            text: "Run `gh auth login` in a terminal, then press Retry.",
          }),
          button("retry", "Retry"),
        ]),
    ],
  );
}
