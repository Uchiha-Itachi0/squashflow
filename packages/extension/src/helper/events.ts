/**
 * The helper's `GET /events` stream, read with a streaming `fetch` because `EventSource`
 * cannot send the Authorization header. Each `event: pin` carries a delivered pin's
 * record, validated before it is used.
 */

import { pinRecordSchema, type PinRecord } from "@squashflow/shared";
import type { FetchLike } from "./client";

/** A single event larger than this is dropped (records are capped well below it). */
const MAX_EVENT_CHARS = 512 * 1024;

/** Turns chunks of `text/event-stream` into pin records. */
export class PinEventParser {
  private buffer = "";

  constructor(private readonly onRecord: (record: PinRecord) => void) {}

  push(chunk: string): void {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    let end = this.buffer.indexOf("\n\n");
    while (end !== -1) {
      this.dispatch(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end + 2);
      end = this.buffer.indexOf("\n\n");
    }
    if (this.buffer.length > MAX_EVENT_CHARS) this.buffer = "";
  }

  private dispatch(block: string): void {
    let type = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (type !== "pin" || data.length === 0) return;
    let json: unknown;
    try {
      json = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    const parsed = pinRecordSchema.safeParse(json);
    if (parsed.success) this.onRecord(parsed.data);
  }
}

export interface PinEventHandlers {
  /** The stream is open: anything published before now must be read with `GET /pins/{id}`. */
  onOpen: () => void;
  onRecord: (record: PinRecord) => void;
}

/**
 * Read the event stream until it ends, fails or `signal` aborts. Resolves `true` when
 * the stream was opened, `false` when the helper could not be reached or refused it.
 */
export async function readPinEvents(
  fetchImpl: FetchLike,
  port: number,
  token: string,
  signal: AbortSignal,
  handlers: PinEventHandlers,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}/events`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    return false;
  }
  if (!response.ok || response.body === null) return false;
  handlers.onOpen();
  const parser = new PinEventParser(handlers.onRecord);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(value);
    }
  } catch {
    // Aborted, or the helper stopped; the caller decides whether to reconnect.
  } finally {
    reader.releaseLock();
  }
  return true;
}
