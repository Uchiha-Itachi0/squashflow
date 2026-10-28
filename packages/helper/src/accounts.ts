/**
 * Claude accounts on this machine. Each account is a Claude Code config folder: the
 * default one (no `CLAUDE_CONFIG_DIR`: `~/.claude`, with its settings in `~/.claude.json`)
 * or any folder a session was started with (`CLAUDE_CONFIG_DIR=<dir>`, settings in
 * `<dir>/.claude.json`). Folder names are never assumed; they come from the sessions'
 * own environment, plus any the user lists in `SQUASHFLOW_CLAUDE_CONFIG_DIRS`.
 *
 * From an account's settings only `oauthAccount.emailAddress` and
 * `oauthAccount.organizationName` are read; tokens and every other field stay unread.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import {
  MAX_ACCOUNT_EMAIL_CHARS,
  MAX_ACCOUNT_LABEL_CHARS,
  type SessionAccount,
} from "@squashflow/shared";
import { z } from "zod";
import { cleanText } from "./session-detail.js";

/** A config folder, or null for the default account. */
export type ConfigDir = string | null;

/** The user's extra account folders: `SQUASHFLOW_CLAUDE_CONFIG_DIRS`, path-list separated. */
export const EXTRA_CONFIG_DIRS_VARIABLE = "SQUASHFLOW_CLAUDE_CONFIG_DIRS";

/** Claude Code's name for an account with no organisation of its own: "<email>'s Organization". */
const PERSONAL_ORGANISATION = /'s Organi[sz]ation$/i;

const accountFileSchema = z.object({
  oauthAccount: z
    .object({
      emailAddress: z.string().optional(),
      organizationName: z.string().optional(),
    })
    .optional(),
});

/** A config folder from an environment value: empty means the default account. */
export function configDirOf(value: string | undefined): ConfigDir {
  return value === undefined || value.trim() === "" ? null : resolve(value);
}

/** The account folders the user listed, plus the helper's own when it runs under one. */
export function configuredDirs(env: NodeJS.ProcessEnv): ConfigDir[] {
  const listed = (env[EXTRA_CONFIG_DIRS_VARIABLE] ?? "")
    .split(delimiter)
    .filter((entry) => entry.trim() !== "")
    .map((entry) => configDirOf(entry));
  return [configDirOf(env.CLAUDE_CONFIG_DIR), ...listed];
}

/** Where the account keeps its sessions' transcripts (`<folder>/projects`). */
export function accountFolder(dir: ConfigDir, home: string = homedir()): string {
  return dir ?? join(home, ".claude");
}

/** The environment that runs `claude` as this account. */
export function accountEnv(dir: ConfigDir, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(base).filter(([name]) => name !== "CLAUDE_CONFIG_DIR"),
  );
  return dir === null ? env : { ...env, CLAUDE_CONFIG_DIR: dir };
}

/** The account's label and email, or null when its settings cannot be read. */
export async function readAccount(
  dir: ConfigDir,
  home: string = homedir(),
): Promise<SessionAccount | null> {
  const file = dir === null ? join(home, ".claude.json") : join(dir, ".claude.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
  const parsed = accountFileSchema.safeParse(raw);
  if (!parsed.success) return null;
  return accountLabel(parsed.data.oauthAccount ?? {});
}

/**
 * A short label for the account: its organisation's name when it has a real one, else
 * its email's domain. Both untrusted, cleaned to one line and capped.
 */
export function accountLabel(account: {
  emailAddress?: string | undefined;
  organizationName?: string | undefined;
}): SessionAccount | null {
  const email = (account.emailAddress ?? "").trim();
  const validEmail =
    email.length <= MAX_ACCOUNT_EMAIL_CHARS && /^[^@\s\p{Cc}]+@[^@\s\p{Cc}]+$/u.test(email)
      ? email
      : null;
  const organisation = cleanText(account.organizationName ?? "", MAX_ACCOUNT_LABEL_CHARS);
  const domain =
    validEmail === null ? null : cleanText(validEmail.split("@")[1] ?? "", MAX_ACCOUNT_LABEL_CHARS);
  const label =
    organisation !== null && !PERSONAL_ORGANISATION.test(organisation) ? organisation : domain;
  return label === null ? null : { label, email: validEmail };
}
