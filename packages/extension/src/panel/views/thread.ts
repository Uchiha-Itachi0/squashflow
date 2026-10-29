/**
 * B4, one pin as a chat. On top, a card with what was pinned: the screenshot, the page
 * and the element, and the technical details behind its Details button. Then the
 * conversation: the user's comment and follow-ups as violet bubbles on the right,
 * Claude's replies (safe markdown, see markdown.ts) as white bubbles with Squish on the
 * left, and status changes as small centred lines. While Claude has the pin and has not
 * answered yet, an animated "Claude is squashing this" bubble stands where its reply
 * will land. A pin Blocked on GitHub access gets the dark "Needs you" card below the
 * newest message. The footer holds the composer and the pin's actions as a row of
 * buttons.
 */

import { shownLabel } from "../../status/pin-status";
import type { StoredPin } from "../../store/pins";
import { h, type Child } from "../../ui/dom";
import { icon, markup, type IconName } from "../../ui/icons";
import { renderMarkdown } from "../../ui/markdown";
import { squishFace } from "../../ui/squish";
import { clockTime, pullRequestLabel, shortUrl } from "../format";
import type { GitHubBlockView, GitHubChoice } from "../github-actions";
import type { PanelActions, PanelModel } from "../model";
import {
  buildThread,
  pinProgress,
  pinState,
  PROGRESS_LABELS,
  type PinProgress,
  type ThreadItem,
} from "../thread";
import { stateChip } from "./pins";
import { backHeader, sendLabel } from "./shell";

export function threadView(
  model: PanelModel,
  actions: PanelActions,
  pin: StoredPin,
  number: number,
): HTMLElement[] {
  const tracking = model.statuses[pin.id];
  const state = pinState(tracking);
  const github = state === "blocked" ? model.github(pin.id) : null;
  const progress = pinProgress(tracking);
  const items = buildThread(pin, tracking);
  return [
    backHeader(
      `Pin ${number}`,
      actions.closePin,
      stateChip(state, tracking === undefined ? "Not sent yet" : shownLabel(tracking)),
    ),
    h("div", { className: "scroll" }, [
      h(
        "div",
        {
          className: "thread",
          attrs: { role: "log", "aria-label": `Conversation for pin ${number}` },
        },
        [
          pinnedCard(model, actions, pin),
          model.editing ? editor(model, actions, pin) : yourPin(pin),
          h(
            "ol",
            { className: "convo" },
            items.slice(1).map((item) => h("li", {}, [threadItem(item)])),
          ),
          // Where Claude's answer will land, so the chat opens scrolled to it.
          progress !== null && working(progress),
          github !== null &&
            alertCard(github, model.send.busy, (choice) => actions.gitHub(pin.id, choice)),
        ],
      ),
    ]),
    footer(model, actions, pin, number, github !== null),
  ];
}

/** What was pinned: the screenshot, where it is, and the technical details on demand. */
function pinnedCard(model: PanelModel, actions: PanelActions, pin: StoredPin): HTMLElement {
  const { context, screenshot } = pin;
  // A Multi pin names how many elements it holds; Details lists each.
  const what =
    context.kind === "elements"
      ? `${1 + (context.elements ?? []).length} elements`
      : (context.selectedText ?? context.selector);
  return h("section", { className: "pinned", attrs: { "aria-label": "What you pinned" } }, [
    screenshot !== undefined &&
      h("div", { className: "shot-frame" }, [
        h("img", {
          className: "shot",
          attrs: {
            src: `data:${screenshot.type};base64,${screenshot.data}`,
            alt: "Screenshot of the pinned region",
          },
        }),
      ]),
    h("div", { className: "where" }, [
      h("span", { className: "where-text" }, [
        h("span", { className: "eyebrow", text: `Pinned on ${shortUrl(pin.pageUrl)}` }),
        what !== undefined && what !== "" && h("span", { className: "what mono", text: what }),
      ]),
      h(
        "button",
        {
          className: "act quiet",
          attrs: { type: "button", "aria-expanded": String(model.detailsOpen) },
          on: { click: actions.toggleDetails },
        },
        [icon("info"), model.detailsOpen ? "Hide details" : "Details"],
      ),
    ]),
    model.detailsOpen && details(pin, actions),
  ]);
}

/** The comment as the first message of the chat. */
function yourPin(pin: StoredPin): HTMLElement {
  return h("div", { className: "msg you" }, [
    h("div", { className: "text", text: pin.comment, attrs: { "aria-label": "Your pin" } }),
    h("span", { className: "from", text: `You · ${clockTime(pin.createdAt)}` }),
  ]);
}

function threadItem(item: ThreadItem): HTMLElement {
  switch (item.kind) {
    case "comment":
    case "you":
      return h("div", { className: "msg you" }, [
        h("div", { className: "text", text: item.text, attrs: { "aria-label": "Your reply" } }),
        h("span", { className: "from", text: `You · ${clockTime(item.at)}` }),
      ]);
    case "reply":
      return claudeSays(`Claude · ${clockTime(item.at)}`, [
        h("div", { className: "text", attrs: { "aria-label": "Claude's reply" } }, [
          ...renderMarkdown(item.text),
          item.truncated && h("p", { className: "cut", text: "… (cut)" }),
        ]),
      ]);
    case "event":
      return h("div", { className: "sys" }, [
        h("span", { className: "line" }, [
          h("span", { className: `sd ${item.tone}` }),
          item.label,
          h("span", { className: "when", text: `· ${clockTime(item.at)}` }),
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
      ]);
  }
}

/** A message on Claude's side of the chat, with Squish as its avatar. */
function claudeSays(
  from: string,
  body: Child[],
  mood: "waiting" | "working" = "waiting",
): HTMLElement {
  return h("div", { className: "msg claude" }, [
    h("span", { className: `avatar ${mood}` }, [markup(squishFace(mood))]),
    h("div", { className: "bubble" }, [h("span", { className: "from", text: from }), ...body]),
  ]);
}

/** Claude has the pin and has not answered yet: an animated bubble where its reply goes. */
function working(progress: PinProgress): HTMLElement {
  const label = PROGRESS_LABELS[progress];
  return h("div", { className: `in-progress ${progress}`, attrs: { "aria-live": "polite" } }, [
    claudeSays(
      "Claude",
      [
        h("div", { className: "text" }, [
          h("span", { text: label }),
          h("span", { className: "dots", attrs: { "aria-hidden": "true" } }, [
            h("i"),
            h("i"),
            h("i"),
          ]),
        ]),
      ],
      progress === "squashing" ? "working" : "waiting",
    ),
  ]);
}

/** What was pinned, for whoever wants the technical details. */
function details(pin: StoredPin, actions: PanelActions): HTMLElement {
  const { context, screenshot } = pin;
  const source =
    context.source === undefined
      ? undefined
      : `${context.source.file}${context.source.line === undefined ? "" : `:${context.source.line}`}`;
  const rows: [string, string | undefined][] = [
    ["Page", shortUrl(pin.pageUrl)],
    ...elementRows(context),
    ["Text", context.selectedText],
    ["Source", source],
    [
      "Screen",
      context.viewport === undefined
        ? undefined
        : `${context.viewport.width} × ${context.viewport.height}`,
    ],
  ];
  return h("section", { className: "context", attrs: { "aria-label": "Details" } }, [
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
        actionButton("copy", "Copy screenshot", "Copy screenshot", () =>
          actions.copyScreenshot(pin.id),
        ),
      ]),
  ]);
}

/** One row per element: a multi-element pin lists each, numbered as on the page. */
function elementRows(context: StoredPin["context"]): [string, string | undefined][] {
  if (context.kind !== "elements") return [["Element", context.selector]];
  return [context, ...(context.elements ?? [])].map((element, index) => [
    `Element ${index + 1}`,
    element.selector,
  ]);
}

function editor(model: PanelModel, actions: PanelActions, pin: StoredPin): HTMLElement {
  const { edit } = model.fields;
  return h("div", { className: "editor" }, [
    h("label", { className: "sr-only", text: "Edit comment", attrs: { for: "edit-comment" } }),
    edit,
    h("div", { className: "row" }, [
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
  needsYou: boolean,
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
  return h("footer", { className: "foot chat-foot" }, [
    actionBar([
      actionButton("copy", "Copy", `Copy pin ${number}`, () => actions.copyPin(pin.id)),
      actionButton(
        resolved ? "undo" : "check",
        resolved ? "Reopen" : "Mark done",
        `${resolved ? "Reopen" : "Mark done"} pin ${number}`,
        () => actions.resolve(pin.id, !resolved),
        resolved ? "" : "ok",
      ),
    ]),
    h("label", { className: "sr-only", text: "Reply to Claude", attrs: { for: "reply" } }),
    h("div", { className: "composer" }, [
      reply,
      h(
        "button",
        {
          // The "Needs you" card holds this screen's one primary button.
          className: needsYou ? "send-btn quiet" : "send-btn",
          attrs: {
            type: "button",
            "aria-label": "Preview reply",
            title: "Send (you see it first)",
            ...(model.send.busy ? { disabled: "" } : {}),
          },
          on: { click: () => actions.reply(pin.id) },
        },
        [icon("up", 2.4)],
      ),
    ]),
  ]);
}

function draftFooter(
  model: PanelModel,
  actions: PanelActions,
  pin: StoredPin,
  number: number,
): HTMLElement {
  const copyOnly = model.settings.copyOnly;
  return h("footer", { className: "foot chat-foot" }, [
    actionBar([
      actionButton("edit", "Edit", `Edit pin ${number}`, actions.startEdit),
      !copyOnly &&
        actionButton("copy", "Copy", `Copy pin ${number}`, () => actions.copyPin(pin.id)),
      actionButton(
        "trash",
        "Delete",
        `Delete pin ${number}`,
        () => actions.deletePin(pin.id),
        "danger",
      ),
    ]),
    h("button", {
      className: "btn primary",
      text: copyOnly ? "Copy 1 pin" : sendLabel(1),
      attrs: {
        type: "button",
        "aria-label": copyOnly ? `Copy pin ${number}` : `Send pin ${number}`,
        ...(model.send.busy && !copyOnly ? { disabled: "" } : {}),
      },
      on: { click: () => (copyOnly ? actions.copyPin(pin.id) : actions.sendPin(pin.id)) },
    }),
  ]);
}

/** A small labelled button: the pin's actions, in a row above the composer. */
function actionButton(
  name: IconName,
  text: string,
  label: string,
  onClick: () => void,
  tone = "",
): HTMLButtonElement {
  return h(
    "button",
    {
      className: tone === "" ? "act" : `act ${tone}`,
      attrs: { type: "button", "aria-label": label },
      on: { click: onClick },
    },
    [icon(name), text],
  );
}

function actionBar(buttons: readonly (HTMLButtonElement | false)[]): HTMLElement {
  return h(
    "div",
    { className: "act-bar", attrs: { role: "toolbar", "aria-label": "Pin actions" } },
    buttons,
  );
}

/** The ways out besides the card's button, as quiet links. */
const OTHER_WAYS: readonly [GitHubChoice, string][] = [
  ["fork", "open a PR from my fork"],
  ["login", "use another account"],
  ["patch", "copy the change"],
  ["owner", "ask the owner"],
];

/** C's dark card: Claude made the fix but cannot push it; the best way out, and the rest. */
function alertCard(
  block: GitHubBlockView,
  busy: boolean,
  onChoose: (choice: GitHubChoice) => void,
): HTMLElement {
  const disabled = busy ? { disabled: "" } : {};
  // Forking is the best fix; once the user chose to log in instead, Retry is.
  const main: GitHubChoice = block.loginOpen ? "retry" : "fork";
  const others = OTHER_WAYS.filter(([choice]) => choice !== (block.loginOpen ? "login" : "fork"));
  return h(
    "section",
    { className: "alert-card", attrs: { role: "group", "aria-label": "GitHub access" } },
    [
      h("span", { className: "eyebrow", text: "Needs you" }),
      h("h2", { text: "Claude fixed it but can't push to GitHub." }),
      h("p", {
        text: block.loginOpen
          ? "Run gh auth login in your terminal to use another account, then retry."
          : "Best fix: Claude opens the pull request from a copy under your account.",
      }),
      block.reason !== null && h("p", { className: "why", text: block.reason }),
      h("button", {
        className: "btn primary",
        text: main === "retry" ? "Retry" : "Open a PR from my fork",
        attrs: { type: "button", ...disabled },
        on: { click: () => onChoose(main) },
      }),
      h("span", { className: "others" }, [
        "Other ways: ",
        ...others.flatMap(([choice, text], index): Child[] => [
          index === 0 ? null : " · ",
          h("button", {
            className: "link-btn inline",
            text,
            attrs: { type: "button", ...disabled },
            on: { click: () => onChoose(choice) },
          }),
        ]),
      ]),
    ],
  );
}
