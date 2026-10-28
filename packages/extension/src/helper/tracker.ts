/**
 * The service worker's follow-up on sent pins. It stores each sent pin's status and
 * thread, keeps the helper's `/events` stream open while any pin is in flight, and
 * re-reads `GET /pins/{id}` whenever it (re)starts, because a Manifest V3 service worker
 * is stopped when idle and loses its stream; the side panel asks it to sync while it is
 * open and a pin is in flight.
 */

import type { PinRecord } from "@squashflow/shared";
import {
  applyRecord,
  forgetPin,
  inFlightMessages,
  setResolved,
  stopFollowing,
  trackSent,
  type PinStatuses,
} from "../status/pin-status";
import type { PinStatusStore } from "../status/store";
import { HelperClient, type FetchLike } from "./client";
import type { Connection, ConnectionStore } from "./connection";
import { readPinEvents } from "./events";

const RECONNECT_MS = 3000;

export type PinMark = "resolve" | "reopen" | "forget";

export interface StatusTrackerOptions {
  fetch: FetchLike;
  connections: ConnectionStore;
  store: PinStatusStore;
  now?: () => number;
  reconnectMs?: number;
}

export class StatusTracker {
  private stream: AbortController | null = null;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: StatusTrackerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Start following the pins just delivered together in one message, or a follow-up. */
  async sent(
    localPinIds: readonly string[],
    record: PinRecord,
    followUp: string | null = null,
  ): Promise<void> {
    await this.change((statuses) => trackSent(statuses, localPinIds, record, this.now(), followUp));
    await this.follow();
  }

  /** A follow-up was delivered: apply the helper's record and follow the message again. */
  async followedUp(record: PinRecord): Promise<void> {
    await this.change((statuses) => applyRecord(statuses, record, this.now()));
    await this.follow();
  }

  /** The helper's id for the message that carried one of the extension's pins. */
  async messageIdOf(localPinId: string): Promise<string | null> {
    return (await this.options.store.list())[localPinId]?.messageId ?? null;
  }

  /** Re-read every in-flight pin from the helper, then keep the stream open if needed. */
  async sync(): Promise<PinStatuses> {
    await this.refresh();
    await this.follow();
    return this.options.store.list();
  }

  async mark(pinId: string, mark: PinMark): Promise<PinStatuses> {
    const now = this.now();
    return this.change((statuses) =>
      mark === "forget"
        ? forgetPin(statuses, pinId)
        : setResolved(statuses, pinId, mark === "resolve", now),
    );
  }

  close(): void {
    clearTimeout(this.reconnect);
    this.stream?.abort();
    this.stream = null;
  }

  private async refresh(): Promise<void> {
    const connection = await this.options.connections.load();
    if (connection === null) return;
    const client = new HelperClient(this.options.fetch, connection.port, connection.token);
    for (const id of inFlightMessages(await this.options.store.list())) {
      const result = await client.pin(id);
      if (result.ok) await this.apply(result.value);
      else if (result.failure.kind === "gone") {
        // The helper restarted and no longer knows this message: stop asking.
        await this.change((statuses) => stopFollowing(statuses, id));
      }
    }
  }

  /** Open the event stream while anything is in flight; close it when nothing is. */
  private async follow(): Promise<void> {
    const inFlight = inFlightMessages(await this.options.store.list()).length > 0;
    if (!inFlight) {
      this.close();
      return;
    }
    if (this.isStreaming()) return;
    const connection = await this.options.connections.load();
    // Another call may have opened the stream while the connection was loading.
    if (connection === null || this.isStreaming()) return;
    this.open(connection);
  }

  private isStreaming(): boolean {
    return this.stream !== null;
  }

  private open(connection: Connection): void {
    const controller = new AbortController();
    this.stream = controller;
    void readPinEvents(this.options.fetch, connection.port, connection.token, controller.signal, {
      onOpen: () => void this.refresh(),
      onRecord: (record) => void this.apply(record),
    }).then(() => {
      if (this.stream !== controller) return;
      this.stream = null;
      clearTimeout(this.reconnect);
      this.reconnect = setTimeout(() => void this.sync(), this.options.reconnectMs ?? RECONNECT_MS);
    });
  }

  private async apply(record: PinRecord): Promise<void> {
    const next = await this.change((statuses) => applyRecord(statuses, record, this.now()));
    if (inFlightMessages(next).length === 0) this.close();
  }

  private change(update: (statuses: PinStatuses) => PinStatuses): Promise<PinStatuses> {
    return this.options.store.update(update);
  }
}
