/**
 * P2, pick a session: the Claude Code sessions running on this laptop as cards, the ones
 * on the site's remembered repository first and marked "Matches this site", each with
 * what the helper knows to tell them apart (title, folder, repository and branch, when
 * it was last active). Session names, titles and folders are untrusted plain text.
 */

import type { PublicSession } from "@squashflow/shared";
import { h } from "../../ui/dom";
import { sessionTimes, shortPath, shortUrl } from "../format";
import type { PanelActions, PanelModel } from "../model";
import { connectView } from "./connect";

export function sessionsView(model: PanelModel, actions: PanelActions): HTMLElement[] {
  const { send } = model;
  if (send.connection.state !== "paired") return connectView(model, actions);
  const site = model.page.kind === "on" ? shortUrl(new URL(model.page.url).origin) : null;
  const matching = new Set(send.matchingPids);
  const ordered = [
    ...send.sessions.filter((session) => matching.has(session.pid)),
    ...send.sessions.filter((session) => !matching.has(session.pid)),
  ];
  const chosen = model.target;
  return [
    h("div", { className: "scroll" }, [
      h("div", { className: "stack" }, [
        h(
          "div",
          {
            attrs: { style: "padding: 0 4px 4px; display: flex; flex-direction: column; gap: 4px" },
          },
          [
            h("h1", { className: "title lg" }, [
              "Who should fix ",
              h("i", { text: site === null ? "this page?" : `${site}?` }),
            ]),
            h("p", {
              className: "caption",
              attrs: { style: "margin: 0; font-size: 13px" },
              text: "Claude Code sessions running on this laptop",
            }),
          ],
        ),
        h(
          "div",
          {
            attrs: {
              role: "radiogroup",
              "aria-label": "Claude Code sessions",
              style: "display: flex; flex-direction: column; gap: 10px",
            },
          },
          ordered.map((session) => sessionCard(session, model, actions, matching.has(session.pid))),
        ),
        send.note !== null && h("div", { className: "notice warn", text: send.note }),
        h("div", { className: "row", attrs: { style: "display: flex; gap: 8px" } }, [
          h("button", {
            className: "btn small",
            text: "Refresh",
            attrs: { type: "button", ...(send.busy ? { disabled: "" } : {}) },
            on: { click: actions.refresh },
          }),
          rememberBox(model, actions),
        ]),
        h("div", { className: "or", text: "OR" }),
        repoLinkCard(model),
      ]),
    ]),
    h("footer", { className: "foot" }, [
      h("div", { className: "row" }, [
        h("button", {
          className: "btn grow",
          text: "Start new session",
          title: "Coming soon: start Claude Code from here",
          attrs: { type: "button", disabled: "" },
        }),
        h("button", {
          className: "btn primary grow",
          text: chosen === null ? "Pick a session" : `Use ${chosen.name}`,
          attrs: { type: "button", ...(chosen === null ? { disabled: "" } : {}) },
          on: { click: actions.useSession },
        }),
      ]),
      h("span", {
        className: "soon",
        text: "Starting a session from here is coming soon. Start Claude Code in your project, then press Refresh.",
      }),
    ]),
  ];
}

function sessionCard(
  session: PublicSession,
  model: PanelModel,
  actions: PanelActions,
  matches: boolean,
): HTMLElement {
  const selected = session.pid === model.send.selectedPid;
  const radio = h("input", {
    attrs: {
      type: "radio",
      name: "squashflow-session",
      value: String(session.pid),
      "aria-label": `${session.name}${session.title === null ? "" : `, ${session.title}`}`,
    },
    on: { change: () => actions.selectSession(session.pid) },
  });
  radio.checked = selected;
  const when = sessionTimes(session, model.now);
  const where = [shortPath(session.cwd), session.repo].filter(Boolean).join(" · ");
  return h("label", { className: selected ? "ses selected" : "ses", title: session.cwd }, [
    radio,
    h("span", { className: "info" }, [
      h("span", { className: "name" }, [
        h("b", { text: session.name }),
        matches && h("span", { className: "chip accent", text: "Matches this site" }),
      ]),
      session.title !== null && h("span", { className: "about", text: session.title }),
      h("span", { className: "where", text: where }),
      session.branch !== null &&
        h("span", { className: "where", text: `branch ${session.branch}` }),
      stateLine(session, when),
    ]),
  ]);
}

function stateLine(session: PublicSession, when: string): HTMLElement {
  const busy = session.status === "busy";
  const label = busy
    ? "Busy · picks it up between steps"
    : session.status === "idle"
      ? "Idle · ready"
      : "Status unknown";
  return h("span", { className: `state ${session.status}` }, [
    h("span", { className: `dot ${session.status}` }),
    when === "" ? label : `${label} · ${when}`,
  ]);
}

function rememberBox(model: PanelModel, actions: PanelActions): HTMLElement | null {
  const repo = model.target?.repo ?? null;
  if (repo === null || model.page.kind !== "on") return null;
  const box: HTMLInputElement = h("input", {
    attrs: { type: "checkbox" },
    on: { change: () => actions.rememberSite(box.checked) },
  });
  box.checked = model.send.repo?.toLowerCase() === repo.toLowerCase();
  return h("label", { className: "set-row", attrs: { style: "font-size: 13px" } }, [
    box,
    `Remember: this site's code is ${repo}`,
  ]);
}

/** Needs helper work not built yet: shown, disabled, and said so. */
function repoLinkCard(model: PanelModel): HTMLElement {
  const { repoLink } = model.fields;
  repoLink.disabled = true;
  return h("div", { className: "card", attrs: { style: "padding: 14px; gap: 10px" } }, [
    h("label", {
      text: "Paste a GitHub repo link",
      attrs: { for: "repo-link", style: "font-size: 14px; font-weight: 600" },
    }),
    h("div", { attrs: { style: "display: flex; gap: 8px" } }, [
      repoLink,
      h("button", {
        className: "btn small",
        text: "Find",
        attrs: { type: "button", disabled: "" },
      }),
    ]),
    h("p", {
      className: "soon",
      attrs: { style: "margin: 0" },
      text: "Coming soon: find a session or folder on this laptop with that repo, and start Claude there.",
    }),
  ]);
}
