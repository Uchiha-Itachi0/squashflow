/**
 * The panel's Claude Code section (pairing, connection state, session picker, site
 * mapping) and the message preview dialog. Rendering only; SendFlow owns the state.
 */

import type { PublicSession } from "@squashflow/shared";
import type { PendingPreview, SendState } from "../pin-mode/send-flow";
import { h } from "./dom";

export interface SendHandlers {
  onOpenPairing: () => void;
  onClosePairing: () => void;
  onPair: (code: string, port: number) => void;
  onForget: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onSelect: (pid: number) => void;
  onRemember: (remember: boolean) => void;
}

/**
 * The pairing inputs live across renders, so a re-render (a status line, Squish's
 * mood) never clears what the user is typing.
 */
export interface PairingFields {
  code: HTMLInputElement;
  port: HTMLInputElement;
}

export function pairingFields(): PairingFields {
  return {
    code: h("input", {
      attrs: {
        "aria-label": "Pairing code",
        placeholder: "ABCD-EFGH",
        autocomplete: "off",
        spellcheck: "false",
        maxlength: "32",
      },
    }),
    port: h("input", {
      attrs: { "aria-label": "Helper port", type: "number", min: "1", max: "65535" },
    }),
  };
}

const CHIPS: Record<SendState["connection"]["state"], string> = {
  checking: "Checking…",
  paired: "Paired",
  unpaired: "Not paired",
  unreachable: "Helper not running",
};

export interface SendSectionProps {
  state: SendState;
  /** The chosen session, when pins can be sent to it. */
  target: PublicSession | null;
  fields: PairingFields;
  handlers: SendHandlers;
}

export function sendSection({ state, target, fields, handlers }: SendSectionProps): HTMLElement {
  const { connection } = state;
  const disabled = state.busy ? { disabled: "" } : {};
  const button = (text: string, onClick: () => void, className = ""): HTMLButtonElement =>
    h("button", { text, className, attrs: disabled, on: { click: onClick } });
  const body: (Node | null)[] = [];

  if (state.pairingOpen) {
    body.push(pairingForm(state, fields, handlers));
  } else if (connection.state === "unpaired") {
    body.push(
      note(connection.message ?? "Pair with the helper to send pins straight to a session."),
      h("div", { className: "row" }, [
        button("Pair with helper", handlers.onOpenPairing, "primary"),
      ]),
    );
  } else if (connection.state === "unreachable") {
    body.push(
      note(connection.message),
      h("div", { className: "row" }, [
        button("Try again", handlers.onRetry),
        button("Forget pairing", handlers.onForget, "danger"),
      ]),
    );
  } else if (connection.state === "paired") {
    body.push(
      h("div", { className: "row" }, [
        button("Refresh", handlers.onRefresh),
        h("span", { className: "spacer" }),
        button("Re-pair", handlers.onOpenPairing),
        button("Forget", handlers.onForget, "danger"),
      ]),
      sessionList(state, handlers),
      siteLine(state, target, handlers),
      state.note === null ? null : note(state.note),
    );
  }

  return h("div", { className: "send", attrs: { "aria-label": "Claude Code session" } }, [
    h("div", { className: "send-head" }, [
      h("span", { className: "send-title", text: "Send to Claude Code" }),
      h("span", { className: `chip ${connection.state}`, text: CHIPS[connection.state] }),
    ]),
    ...body,
  ]);
}

function pairingForm(state: SendState, fields: PairingFields, handlers: SendHandlers): HTMLElement {
  if (fields.port.value === "") fields.port.value = String(state.connection.port);
  const submit = (): void => {
    const code = fields.code.value.trim();
    const port = Number(fields.port.value);
    if (code === "" || !Number.isInteger(port)) return;
    fields.code.value = "";
    handlers.onPair(code, port);
  };
  fields.code.onkeydown = (event) => {
    if (event.key === "Enter") submit();
  };
  return h("div", { className: "pairing" }, [
    note("Run `npx squashflow` in a terminal and enter the code it prints."),
    h("div", { className: "row" }, [fields.code, fields.port]),
    h("div", { className: "row" }, [
      h("span", { className: "spacer" }),
      h("button", { text: "Cancel", on: { click: handlers.onClosePairing } }),
      h("button", {
        className: "primary",
        text: "Pair",
        attrs: state.busy ? { disabled: "" } : {},
        on: { click: submit },
      }),
    ]),
  ]);
}

function sessionList(state: SendState, handlers: SendHandlers): HTMLElement | null {
  if (state.sessions.length === 0) return null;
  const matching = new Set(state.matchingPids);
  const ordered = [
    ...state.sessions.filter((session) => matching.has(session.pid)),
    ...state.sessions.filter((session) => !matching.has(session.pid)),
  ];
  return h(
    "div",
    { className: "sessions", attrs: { role: "radiogroup", "aria-label": "Claude Code sessions" } },
    ordered.map((session) => {
      const radio = h("input", {
        attrs: { type: "radio", name: "squashflow-session", value: String(session.pid) },
        on: { change: () => handlers.onSelect(session.pid) },
      });
      radio.checked = session.pid === state.selectedPid;
      const when = sessionTimes(session, Date.now());
      return h("label", { className: "session", title: session.cwd }, [
        radio,
        h("span", { className: "who" }, [
          h("span", { className: "name", text: session.name }),
          h("span", { className: `state ${session.status}`, text: session.status }),
          matching.has(session.pid) && h("span", { className: "tag", text: "this site" }),
        ]),
        session.title !== null && h("span", { className: "about", text: session.title }),
        h("span", {
          className: "where",
          text: [session.repo ?? "no repository", session.branch].filter(Boolean).join(" · "),
        }),
        when !== "" && h("span", { className: "where", text: when }),
        h("span", { className: "where", text: session.cwd }),
      ]);
    }),
  );
}

/** "started 3h ago · active 2m ago", from what the helper knows; empty when it knows neither. */
export function sessionTimes(session: PublicSession, now: number): string {
  const started = timeAgo(session.startedAt, now);
  const active = timeAgo(session.lastActiveAt, now);
  return [started && `started ${started}`, active && `active ${active}`]
    .filter(Boolean)
    .join(" · ");
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function timeAgo(iso: string | null, now: number): string {
  if (iso === null) return "";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

function siteLine(
  state: SendState,
  target: PublicSession | null,
  handlers: SendHandlers,
): HTMLElement | null {
  const targetRepo = target?.repo ?? null;
  if (targetRepo === null) {
    if (state.repo === null) return null;
    return h("div", { className: "row site" }, [
      h("span", { className: "spacer", text: `This site: ${state.repo}` }),
      h("button", { text: "Forget site", on: { click: () => handlers.onRemember(false) } }),
    ]);
  }
  const box: HTMLInputElement = h("input", {
    attrs: { type: "checkbox" },
    on: { change: () => handlers.onRemember(box.checked) },
  });
  box.checked = state.repo?.toLowerCase() === targetRepo.toLowerCase();
  return h("label", { className: "site" }, [box, ` Remember: this site's code is ${targetRepo}`]);
}

function note(text: string): HTMLElement {
  return h("div", { className: "note", text });
}

export interface PreviewProps {
  preview: PendingPreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function previewDialog({ preview, busy, onConfirm, onCancel }: PreviewProps): HTMLElement {
  const to = `claude@${preview.sessionName}`;
  return h(
    "section",
    { className: "preview", attrs: { role: "dialog", "aria-label": "Message preview" } },
    [
      h("div", { className: "what", text: `Exactly what ${to} will receive:` }),
      h("pre", { className: "message", text: preview.message }),
      h("div", { className: "row" }, [
        h("span", { className: "spacer" }),
        h("button", { text: "Cancel", on: { click: onCancel } }),
        h("button", {
          className: "primary",
          text: `Send to ${to}`,
          attrs: busy ? { disabled: "" } : {},
          on: { click: onConfirm },
        }),
      ]),
    ],
  );
}
