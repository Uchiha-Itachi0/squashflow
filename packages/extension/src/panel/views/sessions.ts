/**
 * B2, who fixes it: a sheet over the inbox listing the Claude Code sessions running on
 * this laptop, from every Claude account, the ones on the site's remembered repository
 * first and marked "This site". Each card leads with the session's own name (its title,
 * else its terminal's label, else its folder), then the account, repository, branch and
 * whether it is ready. All of it is untrusted plain text. It opens on its own after
 * connecting, and from the header chip later.
 */

import { sessionDisplayName, type PublicSession } from "@squashflow/shared";
import { h } from "../../ui/dom";
import { shortPath, shortUrl, timeAgo } from "../format";
import type { PanelActions, PanelModel } from "../model";
import { bottomSheet } from "./shell";

export function sessionsSheet(model: PanelModel, actions: PanelActions): HTMLElement {
  const { send } = model;
  const site = model.page.kind === "on" ? shortUrl(new URL(model.page.url).origin) : null;
  const matching = new Set(send.matchingPids);
  const ordered = [
    ...send.sessions.filter((session) => matching.has(session.pid)),
    ...send.sessions.filter((session) => !matching.has(session.pid)),
  ];
  const chosen = model.target;
  return bottomSheet("Who fixes this site", actions.closeSessions, [
    h("h2", { className: "title lg" }, [
      "Who should fix ",
      h("i", { text: site === null ? "this page?" : `${site}?` }),
    ]),
    h(
      "div",
      {
        className: "ses-list",
        attrs: { role: "radiogroup", "aria-label": "Claude Code sessions" },
      },
      ordered.map((session) => sessionCard(session, model, actions, matching.has(session.pid))),
    ),
    send.note !== null && h("div", { className: "note", text: send.note }),
    h("p", { className: "caption", attrs: { style: "margin: 0" } }, [
      "Not here? Start Claude Code in your project, then ",
      h("button", {
        className: "link-btn inline",
        text: "refresh",
        attrs: { type: "button", ...(send.busy ? { disabled: "" } : {}) },
        on: { click: actions.refresh },
      }),
      ".",
    ]),
    rememberBox(model, actions),
    h("button", {
      className: "btn primary",
      text: chosen === null ? "Choose a session" : `Use ${sessionDisplayName(chosen)}`,
      attrs: { type: "button", ...(chosen === null ? { disabled: "" } : {}) },
      on: { click: actions.useSession },
    }),
  ]);
}

function sessionCard(
  session: PublicSession,
  model: PanelModel,
  actions: PanelActions,
  matches: boolean,
): HTMLElement {
  const selected = session.pid === model.send.selectedPid;
  const name = sessionDisplayName(session);
  const radio = h("input", {
    attrs: {
      type: "radio",
      name: "squashflow-session",
      value: String(session.pid),
      "aria-label": [name, session.terminal, session.account?.label].filter(Boolean).join(", "),
    },
    on: { change: () => actions.selectSession(session.pid) },
  });
  radio.checked = selected;
  const terminal = session.terminal !== null && session.terminal !== name ? session.terminal : null;
  const details = [
    session.account?.label ?? null,
    session.repo ?? (session.cwd === "" ? null : shortPath(session.cwd)),
    session.branch,
  ].filter((part) => part !== null);
  return h("label", { className: selected ? "ses selected" : "ses", title: cardTooltip(session) }, [
    radio,
    h("span", { className: "info" }, [
      h("span", { className: "name" }, [
        h("b", { text: name }),
        terminal !== null && h("span", { className: "term", text: terminal }),
        matches && h("span", { className: "chip accent", text: "This site" }),
      ]),
      details.length > 0 && h("span", { className: "where", text: details.join(" · ") }),
      stateLine(session, timeAgo(session.lastActiveAt, model.now)),
    ]),
  ]);
}

/** The folder and the account's email, on hover. */
function cardTooltip(session: PublicSession): string {
  return [session.cwd, session.account?.email ?? null]
    .filter((part) => part !== null && part !== "")
    .join("\n");
}

/** "Ready · 2m ago", coloured by state; a busy session reads pins between steps. */
function stateLine(session: PublicSession, active: string): HTMLElement {
  const label =
    session.status === "idle"
      ? "Ready"
      : session.status === "busy"
        ? "Busy. Reads pins between steps."
        : "Not sure if it's free";
  return h("span", { className: `state ${session.status}` }, [
    h("span", { className: `dot ${session.status}` }),
    active === "" ? label : `${label} · ${active}`,
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
