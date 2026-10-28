/** Run external programs with fixed argument lists. Never through a shell. */

import { execFile } from "node:child_process";
import { COMMAND_TIMEOUT_MS } from "./constants.js";

export interface RunOptions {
  cwd?: string;
  /** The whole environment for the program; the helper's own when absent. */
  env?: NodeJS.ProcessEnv;
}

export type RunCommand = (
  file: string,
  args: readonly string[],
  options?: RunOptions,
) => Promise<string>;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export const runCommand: RunCommand = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(new Error(`${file} failed: ${error.message}`, { cause: error }));
          return;
        }
        resolve(stdout);
      },
    );
  });
