/**
 * B4, one pin as a chat: the user's comment (with its screenshot) first, then status
 * changes as small grey lines, Claude's replies as bubbles (safe markdown, see
 * markdown.ts), and the user's follow-ups. A composer at the bottom sends a follow-up to
 * the same session, previewed like any pin; rare actions are quiet links, and what was
 * pinned (selector, size, source) sits behind Details. A pin Blocked on GitHub access
 * gets the dark "Needs you" card, below the newest message, with the best way out and
 * the others as links.
 */

import { shownLabel } from "../../status/pin-status";
import type { StoredPin } from "../../store/pins";
import { h, type Child } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { renderMarkdown } from "../../ui/markdown";
import { clockTime, pullRequestLabel, shortUrl } from "../format";
import type { GitHubBlockView, GitHubChoice } from "../github-actions";
import type { PanelActions, PanelModel } from "../model";
import { buildThread, pinState, type ThreadItem } from "../thread";
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
          model.editing ? editor(model, actions, pin) : yourPin(pin),
          h(
            "ol",
            { className: "convo" },
            items.slice(1).map((item) => h("li", {}, [threadItem(item)])),
          ),
          // Last, like the newest message: the chat opens scrolled to it.
          github !== null &&
            alertCard(github, model.send.busy, (choice) => actions.gitHub(pin.id, choice)),
          model.detailsOpen && details(pin, actions),
        ],
      ),
    ]),
    footer(model, actions, pin, number, github !== null),
  ];
}

/** The comment as the first message of the chat, with the screenshot of what was pinned. */
function yourPin(pin: StoredPin): HTMLElement {
  const { screenshot } = pin;
  return h("div", { className: "msg you" }, [
    screenshot !== undefined &&
      h("img", {
        className: "shot",
        attrs: {
          src: `data:${screenshot.type};base64,${screenshot.data}`,
          alt: "Screenshot of the pinned region",
        },
      }),
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
      return h("div", { className: "msg" }, [
        h("span", { className: "from", text: `Claude · ${clockTime(item.at)}` }),
        h("div", { className: "text", attrs: { "aria-label": "Claude's reply" } }, [
          ...renderMarkdown(item.text),
          item.truncated && h("p", { className: "cut", text: "… (cut)" }),
        ]),
      ]);
    case "event":
      return h("div", { className: "sys" }, [
        h("span", { className: `sd ${item.tone}` }),
        h("span", { className: "body" }, [
          h("span", {}, [
            item.label,
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

/** What was pinned, for whoever wants the technical details. */
function details(pin: StoredPin, actions: PanelActions): HTMLElement {
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
    h("div", { attrs: { style: "display: flex; gap: 8px; justify-content: flex-end" } }, [
      h("button", {
        className: "btn small",
        text: "Cancel",
        attrs: { type: "button" },
        on: { click: actions.cancelEdit },
      }),
      h("button", {
        className: "btn small",
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
  return h("footer", { className: "foot" }, [
    h("label", { className: "sr-only", text: "Reply to Claude", attrs: { for: "reply" } }),
    h("div", { className: "composer" }, [
      reply,
      h("button", {
        // The "Needs you" card holds this screen's one primary button.
        className: needsYou ? "btn small" : "btn primary small",
        text: "Send",
        attrs: {
          type: "button",
          "aria-label": "Preview reply",
          ...(model.send.busy ? { disabled: "" } : {}),
        },
        on: { click: () => actions.reply(pin.id) },
      }),
    ]),
    quietLinks([
      linkButton("Copy", `Copy pin ${number}`, () => actions.copyPin(pin.id)),
      detailsLink(model, actions),
      linkButton(
        resolved ? "Reopen" : "Mark done",
        `${resolved ? "Reopen" : "Mark done"} pin ${number}`,
        () => actions.resolve(pin.id, !resolved),
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
  return h("footer", { className: "foot" }, [
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
    quietLinks([
      linkButton("Edit", `Edit pin ${number}`, actions.startEdit),
      !copyOnly && linkButton("Copy", `Copy pin ${number}`, () => actions.copyPin(pin.id)),
      detailsLink(model, actions),
      linkButton("Delete", `Delete pin ${number}`, () => actions.deletePin(pin.id)),
    ]),
  ]);
}

function detailsLink(model: PanelModel, actions: PanelActions): HTMLButtonElement {
  const link = linkButton(
    model.detailsOpen ? "Hide details" : "Details",
    "",
    actions.toggleDetails,
  );
  link.removeAttribute("aria-label");
  link.setAttribute("aria-expanded", String(model.detailsOpen));
  return link;
}

function linkButton(text: string, label: string, onClick: () => void): HTMLButtonElement {
  return h("button", {
    className: "link-btn inline",
    text,
    attrs: { type: "button", "aria-label": label },
    on: { click: onClick },
  });
}

/** Rare actions as a row of quiet links: "Copy · Details · Delete". */
function quietLinks(links: readonly (HTMLButtonElement | false)[]): HTMLElement {
  const shown = links.filter((link): link is HTMLButtonElement => link !== false);
  const children: Child[] = shown.flatMap((link, index) => (index === 0 ? [link] : [" · ", link]));
  return h("span", { className: "caption center links" }, children);
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
