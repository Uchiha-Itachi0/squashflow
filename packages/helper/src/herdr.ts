/**
 * Terminal labels from herdr (a terminal workspace manager): a session started in herdr
 * carries `HERDR_WORKSPACE_ID` and `HERDR_SOCKET_PATH`, and herdr names its workspaces
 * (`~vma`, `~squashflow`). One read-only `herdr workspace list` per herdr server, fixed
 * argv; when herdr is not installed or not running the label is simply left out.
 */

import { MAX_TERMINAL_LABEL_CHARS } from "@squashflow/shared";
import { z } from "zod";
import type { RunCommand } from "./exec.js";
import { cleanText } from "./session-detail.js";

export interface HerdrPlace {
  socketPath: string;
  workspaceId: string;
}

const workspaceListSchema = z.object({
  result: z.object({
    workspaces: z.array(z.object({ workspace_id: z.string(), label: z.string() })),
  }),
});

/** Where a session sits in herdr, from its environment; null outside herdr. */
export function herdrPlace(env: Readonly<Record<string, string>>): HerdrPlace | null {
  const socketPath = env.HERDR_SOCKET_PATH;
  const workspaceId = env.HERDR_WORKSPACE_ID;
  if (socketPath === undefined || socketPath === "" || workspaceId === undefined) return null;
  if (workspaceId === "") return null;
  return { socketPath, workspaceId };
}

/**
 * The workspace label for each place, keyed `<socket>\n<workspace>`. Places whose herdr
 * cannot be asked are missing from the result.
 */
export async function herdrLabels(
  run: RunCommand,
  places: readonly HerdrPlace[],
  base: NodeJS.ProcessEnv = process.env,
): Promise<Map<string, string>> {
  const sockets = [...new Set(places.map((place) => place.socketPath))];
  const labels = new Map<string, string>();
  await Promise.all(
    sockets.map(async (socketPath) => {
      for (const [workspaceId, label] of await workspaceLabels(run, socketPath, base)) {
        labels.set(placeKey({ socketPath, workspaceId }), label);
      }
    }),
  );
  return labels;
}

export function placeKey(place: HerdrPlace): string {
  return `${place.socketPath}\n${place.workspaceId}`;
}

async function workspaceLabels(
  run: RunCommand,
  socketPath: string,
  base: NodeJS.ProcessEnv,
): Promise<[string, string][]> {
  try {
    const output = await run("herdr", ["workspace", "list"], {
      env: { ...base, HERDR_SOCKET_PATH: socketPath },
    });
    const parsed = workspaceListSchema.safeParse(JSON.parse(output));
    if (!parsed.success) return [];
    return parsed.data.result.workspaces.flatMap(({ workspace_id, label }) => {
      const text = cleanText(label, MAX_TERMINAL_LABEL_CHARS);
      return text === null ? [] : [[workspace_id, text] as [string, string]];
    });
  } catch {
    return [];
  }
}
