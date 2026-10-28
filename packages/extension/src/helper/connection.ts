/**
 * The pairing with the helper: its port and the pairing token. Kept in the service
 * worker's IndexedDB, which belongs to the extension's own origin: web pages cannot
 * read it, and neither can the pin mode script, which runs in the page's origin.
 * (`chrome.storage.local` would be readable from the pin mode script.)
 */

import { DEFAULT_HELPER_PORT } from "@squashflow/shared";
// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";

const CONNECTION_KEY = "helper-connection";

export const portSchema = z.number().int().min(1).max(65535);

const connectionSchema = z.strictObject({
  port: portSchema,
  token: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
});

export type Connection = z.infer<typeof connectionSchema>;

/** A small key-value store for values only the service worker may read. */
export interface SecretArea {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export class ConnectionStore {
  constructor(private readonly area: SecretArea) {}

  /** The saved pairing, or null when there is none or it is unreadable. */
  async load(): Promise<Connection | null> {
    const parsed = connectionSchema.safeParse(await this.area.get(CONNECTION_KEY));
    return parsed.success ? parsed.data : null;
  }

  async save(connection: Connection): Promise<void> {
    await this.area.set(CONNECTION_KEY, connectionSchema.parse(connection));
  }

  async forget(): Promise<void> {
    await this.area.delete(CONNECTION_KEY);
  }

  /** The port to suggest when pairing: the saved one, else the helper's default. */
  async port(): Promise<number> {
    return (await this.load())?.port ?? DEFAULT_HELPER_PORT;
  }
}

const DB_NAME = "squashflow";
const STORE_NAME = "secrets";

/** A SecretArea in IndexedDB, for the service worker. */
export function indexedDbArea(factory: IDBFactory = indexedDB): SecretArea {
  let opened: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    opened ??= new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
    return opened;
  };
  const run = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = action(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  };
  return {
    get: (key) => run<unknown>("readonly", (store) => store.get(key)),
    set: async (key, value) => {
      await run("readwrite", (store) => store.put(value, key));
    },
    delete: async (key) => {
      await run("readwrite", (store) => store.delete(key));
    },
  };
}
