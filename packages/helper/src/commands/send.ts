/** `squashflow send`: the developer path. Same delivery code as POST /pins. */

import { createInterface } from "node:readline/promises";
import type { PinRecord } from "../delivery.js";
import { runCommand } from "../exec.js";
import { openDeliveryRuntime } from "../runtime.js";
import { pinSchema } from "../schemas.js";
import { findSession, listSessions } from "../sessions.js";
import type { Terminal } from "../terminal.js";
import { pageUrlSchema } from "../schemas.js";

export interface SendOptions {
  session: string;
  comment: string;
  url?: string | undefined;
  waitSeconds: number;
}

export async function sendCommand(term: Terminal, options: SendOptions): Promise<number> {
  const pin = pinSchema.safeParse({ comment: options.comment });
  if (!pin.success) throw new Error("The comment must be between 1 and 8000 characters.");
  if (options.url !== undefined && !pageUrlSchema.safeParse(options.url).success) {
    throw new Error("--url must be an http or https URL.");
  }
  const session = findSession(await listSessions(runCommand), options.session);
  const runtime = await openDeliveryRuntime();
  try {
    const draft = runtime.delivery.createDraft(session, "cli", options.url, [pin.data]);
    process.stdout.write(
      `${term.info(`message for claude@${session.name} (pid ${session.pid}):`)}\n\n`,
    );
    process.stdout.write(`${draft.message}\n\n`);
    if (!(await confirm("Send this message? [y/N] "))) {
      process.stdout.write(`${term.info("not sent")}\n`);
      return 1;
    }
    const record = await runtime.delivery.deliver(draft);
    process.stdout.write(`${term.arrow(`claude@${session.name}  pin ${record.number}  Sent`)}\n`);
    const final = await waitForSeen(
      term,
      runtime.delivery.subscribe.bind(runtime.delivery),
      record,
      options.waitSeconds,
    );
    return final === "seen" ? 0 : 2;
  } finally {
    await runtime.close();
  }
}

async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

type Subscribe = (listener: (pin: PinRecord) => void) => () => void;

function waitForSeen(
  term: Terminal,
  subscribe: Subscribe,
  record: PinRecord,
  waitSeconds: number,
): Promise<"seen" | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      process.stdout.write(
        `${term.warn(`no confirmation after ${waitSeconds}s; the pin is still Sent (a busy session handles it between steps)`)}\n`,
      );
      resolve("timeout");
    }, waitSeconds * 1000);
    const unsubscribe = subscribe((pin) => {
      if (pin.id !== record.id) return;
      if (pin.status === "approve-in-terminal") {
        process.stdout.write(
          `${term.warn(`pin ${pin.number}: approve it in the terminal of claude@${pin.sessionName}`)}\n`,
        );
      }
      if (pin.status === "seen") {
        clearTimeout(timer);
        unsubscribe();
        process.stdout.write(`${term.squashed(`squashed! pin ${pin.number} seen by Claude`)}\n`);
        resolve("seen");
      }
    });
  });
}
