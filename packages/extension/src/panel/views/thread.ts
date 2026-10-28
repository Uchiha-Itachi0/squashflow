/**
 * P4, one pin as a conversation: the user's comment and what was pinned first, then
 * status changes as small system lines, Claude's replies as bubbles (safe markdown, see
 * markdown.ts) next to Squish, whose face follows the pin's status, and the user's
 * follow-ups. A composer at the bottom sends a follow-up to the same session, previewed
 * like any pin. P5: a pin Blocked on GitHub access offers the four ways out.
 */

import { shownLabel } from "../../status/pin-status";
import type { StoredPin } from "../../store/pins";
import { h } from "../../ui/dom";
import { icon, markup, type IconName } from "../../ui/icons";
import { renderMarkdown } from "../../ui/markdown";
import { squishFace } from "../../ui/squish";
import { clockTime, pullRequestLabel, shortUrl } from "../format";
import type { GitHubBlockView, GitHubChoice } from "../github-actions";
import type { PanelActions, PanelModel } from "../model";
import { buildThread, moodForPin, pinLine, pinState, type ThreadItem } from "../thread";
import { pinDot, stateChip } from "./pins";

export function threadView(
  model: PanelModel,
  actions: PanelActions,
  pin: StoredPin,
  number: number,
): HTMLElement[] {
  const tracking = model.statuses[pin.id];
  const state = pinState(tracking);
  const mood = moodForPin(tracking);
  const github = model.github(pin.id);
  const items = buildThread(pin, tracking);
  return [
    h("header", { className: "thread-top" }, [
      h(
        "button",
        {
          className: "icon-btn",
          attrs: { type: "button", "aria-label": "Back to all pins" },
          on: { click: actions.closePin },
        },
        [icon("back")],
      ),
      pinDot(state, number),
      h("b", { text: `Pin ${number}`, attrs: { style: "font-size: 15px" } }),
      stateChip(state, tracking === undefined ? "Draft" : shownLabel(tracking)),
      h("span", { className: "spacer" }),
      tracking !== undefined && h("span", { className: "who", text: tracking.sessionName }),
    ]),
    h("div", { className: "scroll" }, [
      h(
        "div",
        {
          className: "thread",
          attrs: { role: "log", "aria-label": `Conversation for pin ${number}` },
        },
        [
          model.editing
            ? editor(model, actions, pin)
            : h("p", { className: "ask", text: `“${pin.comment}”` }),
          contextCard(pin, actions),
          items.length > 1 && h("span", { className: "eyebrow", text: "What happened" }),
          h(
            "ol",
            { className: "convo" },
            items.slice(1).map((item) => h("li", {}, [threadItem(item, mood)])),
          ),
          h("div", { className: "msg" }, [
            h("span", { className: "face" }, [markup(squishFace(mood))]),
            h("div", {
              className: "bubble",
              text: pinLine(state, tracking?.sessionName ?? model.target?.name ?? null),
              attrs: { "aria-label": "Squish" },
            }),
          ]),
          github !== null &&
            state === "blocked" &&
            gitHubOptions(github, model.send.busy, (choice) => actions.gitHub(pin.id, choice)),
        ],
      ),
    ]),
    footer(model, actions, pin, number),
  ];
}

function threadItem(item: ThreadItem, mood: Parameters<typeof squishFace>[0]): HTMLElement {
  switch (item.kind) {
    case "comment":
    case "you":
      return h("div", { className: "msg you" }, [
        h("div", { className: "text", text: item.text, attrs: { "aria-label": "Your reply" } }),
      ]);
    case "reply":
      return h("div", { className: "msg" }, [
        h("span", { className: "face" }, [markup(squishFace(mood))]),
        h("div", {}, [
          h("div", { className: "from", text: `Claude · ${clockTime(item.at)}` }),
          h("div", { className: "text", attrs: { "aria-label": "Claude's reply" } }, [
            ...renderMarkdown(item.text),
            item.truncated && h("p", { className: "cut", text: "… (cut)" }),
          ]),
        ]),
      ]);
    case "event":
      return h("div", { className: "sys" }, [
        h("span", { className: `sd ${item.tone}` }),
        h("span", { className: "body" }, [
          h("span", {}, [
            h("b", { text: item.label }),
            h("span", { className: "when", text: ` · ${clockTime(item.at)}` }),
          ]),
          item.pullRequestUrl !== null &&
            h(
              "a",
              {
                className: "pr-card",
                attrs: {
                  href: item.pullRequestUrl,
                  target: "_blank",
                  rel: "noopener noreferrer",
                  "aria-label": "Pull request",
                },
              },
              [icon("pr"), h("b", { text: pullRequestLabel(item.pullRequestUrl) })],
            ),
        ]),
      ]);
  }
}

function contextCard(pin: StoredPin, actions: PanelActions): HTMLElement {
  const { context, screenshot } = pin;
  const source =
    context.source === undefined
      ? undefined
      : `${context.source.file}${context.source.line === undefined ? "" : `:${context.source.line}`}`;
  const rows: [string, string | undefined][] = [
    ["Page", shortUrl(pin.pageUrl)],
    ["Element", context.selector],
    ["Text", context.selectedText],
    ["Source", source],
    [
      "Screen",
      context.viewport === undefined
        ? undefined
        : `${context.viewport.width} × ${context.viewport.height}`,
    ],
  ];
  return h("section", { className: "context", attrs: { "aria-label": "What was pinned" } }, [
    screenshot !== undefined &&
      h("div", { className: "shot" }, [
        h("img", {
          attrs: {
            src: `data:${screenshot.type};base64,${screenshot.data}`,
            alt: "Screenshot of the pinned region",
          },
        }),
      ]),
    h(
      "dl",
      {},
      rows.flatMap(([term, value]) =>
        value === undefined || value === ""
          ? []
          : [h("dt", { text: term }), h("dd", { text: value })],
      ),
    ),
    screenshot !== undefined &&
      h("div", { className: "actions" }, [
        h("button", {
          className: "btn tiny",
          text: "Copy screenshot",
          attrs: { type: "button" },
          on: { click: () => actions.copyScreenshot(pin.id) },
        }),
      ]),
  ]);
}

function editor(model: PanelModel, actions: PanelActions, pin: StoredPin): HTMLElement {
  const { edit } = model.fields;
  return h("div", { attrs: { style: "display: flex; flex-direction: column; gap: 8px" } }, [
    h("label", { className: "sr-only", text: "Edit comment", attrs: { for: "edit-comment" } }),
    edit,
    h("div", { attrs: { style: "display: flex; gap: 8px" } }, [
      h("button", {
        className: "btn small",
        text: "Cancel",
        attrs: { type: "button" },
        on: { click: actions.cancelEdit },
      }),
      h("button", {
        className: "btn small primary",
        text: "Save",
        attrs: { type: "button" },
        on: { click: () => actions.saveEdit(pin.id) },
      }),
    ]),
  ]);
}

function footer(
  model: PanelModel,
  actions: PanelActions,
  pin: StoredPin,
  number: number,
): HTMLElement {
  const tracking = model.statuses[pin.id];
  if (tracking === undefined) return draftFooter(model, actions, pin, number);
  const resolved = tracking.resolved;
  const { reply } = model.fields;
  reply.onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      actions.reply(pin.id);
    }
  };
  return h("footer", { className: "foot" }, [
    h("label", { className: "sr-only", text: "Reply to Claude", attrs: { for: "reply" } }),
    h("div", { className: "composer" }, [
      reply,
      h("button", {
        className: "btn primary small",
        text: "Send",
        attrs: {
          type: "button",
          "aria-label": "Preview reply",
          ...(model.send.busy ? { disabled: "" } : {}),
        },
        on: { click: () => actions.reply(pin.id) },
      }),
    ]),
    h("div", { className: "row" }, [
      h("button", {
        className: "btn grow",
        text: "Copy",
        attrs: { type: "button", "aria-label": `Copy pin ${number}` },
        on: { click: () => actions.copyPin(pin.id) },
      }),
      h("button", {
        className: resolved ? "btn grow" : "btn dark grow",
        text: resolved ? "Reopen" : "Resolve",
        attrs: { type: "button", "aria-label": `${resolved ? "Reopen" : "Resolve"} pin ${number}` },
        on: { click: () => actions.resolve(pin.id, !resolved) },
      }),
    ]),
  ]);
}

function draftFooter(
  model: PanelModel,
  actions: PanelActions,
  pin: StoredPin,
  number: number,
): HTMLElement {
  const canSend = model.target !== null && !model.settings.copyOnly;
  return h("footer", { className: "foot" }, [
    h("div", { className: "row" }, [
      h("button", {
        className: "btn",
        text: "Delete",
        attrs: { type: "button", "aria-label": `Delete pin ${number}` },
        on: { click: () => actions.deletePin(pin.id) },
      }),
      h("button", {
        className: "btn",
        text: "Edit",
        attrs: { type: "button", "aria-label": `Edit pin ${number}` },
        on: { click: actions.startEdit },
      }),
      h("button", {
        className: "btn",
        text: "Copy",
        attrs: { type: "button", "aria-label": `Copy pin ${number}` },
        on: { click: () => actions.copyPin(pin.id) },
      }),
      canSend &&
        h("button", {
          className: "btn primary grow",
          text: "Send",
          title: `Preview it for claude@${model.target?.name ?? ""}`,
          attrs: {
            type: "button",
            "aria-label": `Send pin ${number}`,
            ...(model.send.busy ? { disabled: "" } : {}),
          },
          on: { click: () => actions.sendPin(pin.id) },
        }),
    ]),
  ]);
}

const OPTIONS: readonly [GitHubChoice, IconName, string, string][] = [
  [
    "fork",
    "fork",
    "Fork and open a PR",
    "Claude forks to your account and opens the PR from there.",
  ],
  [
    "login",
    "login",
    "Log in with another account",
    "Run gh auth login in your terminal, then retry.",
  ],
  ["patch", "copy", "Copy the patch", "The exact code change, ready to paste or email."],
  [
    "owner",
    "owner",
    "Ask the owner",
    "Copies a short note with the fix to send to whoever runs the repo.",
  ],
];

function gitHubOptions(
  block: GitHubBlockView,
  busy: boolean,
  onChoose: (choice: GitHubChoice) => void,
): HTMLElement {
  return h(
    "div",
    {
      attrs: {
        role: "group",
        "aria-label": "GitHub access",
        style: "display: flex; flex-direction: column; gap: 10px",
      },
    },
    [
      h("section", { className: "notice danger", attrs: { role: "alert" } }, [
        h("h2", { className: "title lg", attrs: { style: "color: var(--text)" } }, [
          "Claude made the fix, ",
          h("i", { text: "but can't push it" }),
        ]),
        h("p", {
          attrs: { style: "margin: 0; font-size: 13.5px; line-height: 1.5" },
          text:
            block.reason ??
            "Your GitHub login can't push to this repository. The change is safe on a local branch.",
        }),
      ]),
      h("span", { className: "eyebrow", text: "Pick one" }),
      ...OPTIONS.map(([choice, iconName, title, text], index) =>
        h(
          "button",
          {
            className: index === 0 ? "opt recommended" : "opt",
            attrs: { type: "button", "aria-label": title, ...(busy ? { disabled: "" } : {}) },
            on: { click: () => onChoose(choice) },
          },
          [
            h("span", { className: "ic" }, [icon(iconName)]),
            h("span", { className: "what" }, [
              h("b", {}, [
                title,
                index === 0 && h("span", { className: "chip accent", text: "Recommended" }),
              ]),
              h("span", { text }),
            ]),
          ],
        ),
      ),
      block.loginOpen &&
        h("div", { className: "notice", attrs: { style: "align-items: center" } }, [
          h("span", {
            className: "spacer",
            text: "Run `gh auth login` in a terminal, then press Retry.",
          }),
          h("button", {
            className: "btn small primary",
            text: "Retry",
            attrs: { type: "button", ...(busy ? { disabled: "" } : {}) },
            on: { click: () => onChoose("retry") },
          }),
        ]),
    ],
  );
}
