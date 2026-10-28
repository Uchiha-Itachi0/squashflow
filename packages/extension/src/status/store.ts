/**
 * Sent pins' statuses and threads in extension local storage, under one key, by the
 * extension's own pin id. Only the service worker writes it, one change at a time; the
 * pin mode script reads it and listens for changes. What is read back is validated,
 * and entries that fail validation are dropped.
 */

import type { StorageAreaLike } from "../store/pins";
import { pinTrackingSchema, type PinStatuses, type PinTracking } from "./pin-status";

export const PIN_STATUS_KEY = "pin-status";

/** Validate what storage holds, dropping anything malformed. */
export function readStatuses(raw: unknown): PinStatuses {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const statuses: Record<string, PinTracking> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!/^sf-[0-9a-f]{12}$/.test(id)) continue;
    const parsed = pinTrackingSchema.safeParse(entry);
    if (parsed.success) statuses[id] = parsed.data;
  }
  return statuses;
}

export class PinStatusStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageAreaLike) {}

  async list(): Promise<PinStatuses> {
    return readStatuses((await this.area.get(PIN_STATUS_KEY))[PIN_STATUS_KEY]);
  }

  /** Apply a change to the current statuses; changes run one after another. */
  update(change: (statuses: PinStatuses) => PinStatuses): Promise<PinStatuses> {
    const run = this.queue.then(async () => {
      const current = await this.list();
      const next = change(current);
      if (next !== current) await this.write(next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(statuses: PinStatuses): Promise<void> {
    if (Object.keys(statuses).length === 0) await this.area.remove(PIN_STATUS_KEY);
    else await this.area.set({ [PIN_STATUS_KEY]: statuses });
  }
}

/** Where the pin mode script reads statuses from, and hears about changes. */
export interface StatusSource {
  read(): Promise<PinStatuses>;
  watch(onChange: (statuses: PinStatuses) => void): () => void;
}

/** Statuses in `chrome.storage.local`, which web pages cannot read. */
export function chromeStatusSource(): StatusSource {
  const store = new PinStatusStore(chrome.storage.local);
  return {
    read: () => store.list(),
    watch: (onChange) => {
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        area: chrome.storage.AreaName,
      ): void => {
        const change = changes[PIN_STATUS_KEY];
        if (area === "local" && change !== undefined) onChange(readStatuses(change.newValue));
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}
