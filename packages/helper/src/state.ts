/** Helper state on disk: a single JSON file readable and writable only by the user. */

import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const STATE_FILE_MODE = 0o600;
const STATE_DIR_MODE = 0o700;

const pairingRecordSchema = z
  .object({
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    origin: z.string().min(1),
    pairedAt: z.string(),
  })
  .strict();

const stateSchema = z
  .object({
    version: z.literal(1),
    pairing: pairingRecordSchema.nullable(),
  })
  .strict();

export type PairingRecord = z.infer<typeof pairingRecordSchema>;
export type HelperState = z.infer<typeof stateSchema>;

export const EMPTY_STATE: HelperState = { version: 1, pairing: null };

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SQUASHFLOW_HOME;
  if (override !== undefined && override !== "") return override;
  return join(homedir(), ".squashflow");
}

export class StateStore {
  readonly file: string;

  constructor(readonly dir: string) {
    this.file = join(dir, "state.json");
  }

  async load(): Promise<HelperState> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if (isNotFound(error)) return EMPTY_STATE;
      throw error;
    }
    const info = await stat(this.file);
    if ((info.mode & 0o777) !== STATE_FILE_MODE) await chmod(this.file, STATE_FILE_MODE);
    const parsed = stateSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Error(`State file ${this.file} is not valid; delete it to start over.`);
    }
    return parsed.data;
  }

  async save(state: HelperState): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: STATE_DIR_MODE });
    await chmod(this.dir, STATE_DIR_MODE);
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: STATE_FILE_MODE });
    await chmod(temp, STATE_FILE_MODE);
    await rename(temp, this.file);
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
