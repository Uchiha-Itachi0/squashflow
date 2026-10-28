/**
 * The user's choices that both the side panel and the on-page toolbar show: send each
 * pin as it is saved or batch them until Go, how much detail Copy includes, and whether
 * the user chose to copy and paste instead of connecting the helper. Kept in extension
 * local storage under one key; what is read back is validated, with defaults for
 * anything missing or malformed.
 */

import { DETAIL_LEVELS } from "@squashflow/shared";
// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";
import type { StorageAreaLike } from "./store/pins";

export const SETTINGS_KEY = "settings";

export const SEND_MODES = ["now", "batch"] as const;
export type SendMode = (typeof SEND_MODES)[number];

const settingsSchema = z.object({
  sendMode: z.enum(SEND_MODES).catch("batch"),
  level: z.enum(DETAIL_LEVELS).catch("standard"),
  /** The user skipped connecting: pins are copied, never sent, until they connect. */
  copyOnly: z.boolean().catch(false),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = { sendMode: "batch", level: "standard", copyOnly: false };

export function readSettings(raw: unknown): Settings {
  const parsed = settingsSchema.safeParse(
    typeof raw === "object" && raw !== null ? raw : DEFAULT_SETTINGS,
  );
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export class SettingsStore {
  constructor(private readonly area: StorageAreaLike) {}

  async read(): Promise<Settings> {
    return readSettings((await this.area.get(SETTINGS_KEY))[SETTINGS_KEY]);
  }

  async change(patch: Partial<Settings>): Promise<Settings> {
    const next = readSettings({ ...(await this.read()), ...patch });
    await this.area.set({ [SETTINGS_KEY]: next });
    return next;
  }
}

/** Hear about changes to the settings in `chrome.storage.local`. */
export function watchSettings(onChange: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ): void => {
    const change = changes[SETTINGS_KEY];
    if (area === "local" && change !== undefined) onChange(readSettings(change.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
