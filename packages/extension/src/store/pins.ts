/**
 * Pins stored per page in extension local storage, which web pages cannot read.
 * One key per page (origin and path); the value is that page's pins in pin order.
 * What is read back is validated, and entries that fail validation are dropped.
 */

import {
  MAX_COMMENT_CHARS,
  pageContextSchema,
  pageUrlSchema,
  screenshotSchema,
  type PageContext,
  type Screenshot,
} from "@squashflow/shared";
// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";
import { MAX_PINS_PER_PAGE } from "../constants";

const PIN_ID = /^sf-[0-9a-f]{12}$/;
const KEY_PREFIX = "pins:";

export const storedPinSchema = z.strictObject({
  id: z.string().regex(PIN_ID),
  comment: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
  context: pageContextSchema,
  /** A crop of the visible tab around the pin, when one could be taken. */
  screenshot: screenshotSchema.optional(),
  pageUrl: pageUrlSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type StoredPin = z.infer<typeof storedPinSchema>;

/** The subset of chrome.storage.StorageArea the store uses. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface NewPin {
  comment: string;
  context: PageContext;
  screenshot?: Screenshot | undefined;
}

/** The page URL a pin records, without its fragment. */
export function pinPageUrl(href: string): string {
  const url = new URL(href);
  url.hash = "";
  return url.href;
}

/** Pins are kept per origin and path; query strings and fragments share the page's pins. */
export function pageKey(href: string): string {
  const url = new URL(href);
  return `${KEY_PREFIX}${url.origin}${url.pathname}`;
}

export function newPinId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `sf-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export class PinStore {
  private readonly key: string;
  private readonly pageUrl: string;

  constructor(
    private readonly area: StorageAreaLike,
    href: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = pageKey(href);
    this.pageUrl = pinPageUrl(href);
  }

  async list(): Promise<StoredPin[]> {
    const raw = (await this.area.get(this.key))[this.key];
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry: unknown) => {
      const parsed = storedPinSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async add(pin: NewPin): Promise<StoredPin> {
    const pins = await this.list();
    if (pins.length >= MAX_PINS_PER_PAGE) {
      throw new Error(`A page can hold at most ${MAX_PINS_PER_PAGE} pins.`);
    }
    const time = this.now();
    const stored = storedPinSchema.parse({
      id: newPinId(),
      comment: pin.comment,
      context: pin.context,
      ...(pin.screenshot === undefined ? {} : { screenshot: pin.screenshot }),
      pageUrl: this.pageUrl,
      createdAt: time,
      updatedAt: time,
    });
    await this.write([...pins, stored]);
    return stored;
  }

  async update(id: string, comment: string): Promise<StoredPin> {
    const pins = await this.list();
    const existing = pins.find((pin) => pin.id === id);
    if (existing === undefined) throw new Error("That pin no longer exists.");
    const updated = storedPinSchema.parse({ ...existing, comment, updatedAt: this.now() });
    await this.write(pins.map((pin) => (pin.id === id ? updated : pin)));
    return updated;
  }

  async remove(id: string): Promise<void> {
    const remaining = (await this.list()).filter((pin) => pin.id !== id);
    await this.write(remaining);
  }

  private async write(pins: readonly StoredPin[]): Promise<void> {
    if (pins.length === 0) await this.area.remove(this.key);
    else await this.area.set({ [this.key]: pins });
  }
}
