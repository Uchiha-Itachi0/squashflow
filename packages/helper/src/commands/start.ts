/** `squashflow` / `squashflow start`: run the helper in the foreground. */

import { createInterface } from "node:readline";
import { MAX_BODY_BYTES } from "../constants.js";
import { runCommand } from "../exec.js";
import { startServer, type HelperContext } from "../http/server.js";
import { PairingCodes } from "../pairing.js";
import { openDeliveryRuntime } from "../runtime.js";
import { listSessions } from "../sessions.js";
import { defaultStateDir, StateStore } from "../state.js";
import type { Terminal } from "../terminal.js";

export interface StartOptions {
  port: number;
  forcePair: boolean;
}

export async function startCommand(term: Terminal, options: StartOptions): Promise<number> {
  const out = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  const store = new StateStore(defaultStateDir());
  const state = await store.load();
  const pairing = new PairingCodes();
  const runtime = await openDeliveryRuntime();
  const context: HelperContext = {
    port: options.port,
    maxBodyBytes: MAX_BODY_BYTES,
    auth: { tokenHash: state.pairing?.tokenHash ?? null, origin: state.pairing?.origin ?? null },
    pairing,
    savePairing: (record) => store.save({ ...state, pairing: record }),
    delivery: runtime.delivery,
    discover: () => listSessions(runCommand),
    log: {
      info: (text) => out(term.info(text)),
      arrow: (text) => out(term.arrow(text)),
      warn: (text) => out(term.warn(text)),
    },
  };
  const seen = new Map<string, { status: string; replies: number }>();
  runtime.delivery.subscribe((pin) => {
    const before = seen.get(pin.id);
    seen.set(pin.id, { status: pin.status, replies: pin.thread.length });
    if (pin.thread.length > (before?.replies ?? 0)) {
      out(term.arrow(`claude@${pin.sessionName} replied to pin ${pin.number}`));
    }
    if (pin.status === before?.status) return;
    if (pin.status === "seen") out(term.squashed(`squashed! pin ${pin.number} seen by Claude`));
    if (pin.status === "fixed") out(term.squashed(`squashed! pin ${pin.number} fixed`));
    if (pin.status === "approve-in-terminal") {
      out(term.warn(`pin ${pin.number}: approve it in the terminal of claude@${pin.sessionName}`));
    }
    if (pin.status === "blocked") {
      out(term.warn(`pin ${pin.number}: claude@${pin.sessionName} never picked it up`));
    }
  });

  const server = await startServer(context);
  out(term.banner());
  out(term.info(`listening on http://127.0.0.1:${server.port}`));
  const showCode = (): void => {
    const issued = pairing.issue();
    const minutes = Math.round((issued.expiresAt - Date.now()) / 60_000);
    out(term.info(`pairing code ${issued.code}  (expires in ${minutes} min, single use)`));
  };
  if (state.pairing === null || options.forcePair) showCode();
  else out(term.info("already paired; run with --pair to pair a different browser"));
  const keys = process.stdin.isTTY ? createInterface({ input: process.stdin }) : null;
  if (keys) {
    out(term.dim("press Enter for a new pairing code, Ctrl+C to stop"));
    keys.on("line", showCode);
  }

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  out(term.info("stopping"));
  keys?.close();
  await server.close();
  await runtime.close();
  return 0;
}
