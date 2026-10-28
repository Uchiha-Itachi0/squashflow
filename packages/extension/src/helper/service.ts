/**
 * The service worker's side of talking to the helper: pairing, the connection status,
 * sessions for a page, the remembered site-to-repository mapping, preview and send.
 * Requests from the pin mode script are validated here before anything is done.
 */

import { HelperClient, type FetchLike } from "./client";
import type { ConnectionStore } from "./connection";
import type { HelperResult } from "./errors";
import {
  workerRequestSchema,
  type ConnectionStatus,
  type WorkerReplies,
  type WorkerRequest,
} from "./messages";
import type { SiteRepoStore } from "./sites";

export interface HelperServiceOptions {
  fetch: FetchLike;
  connections: ConnectionStore;
  sites: SiteRepoStore;
}

type AnyReply = HelperResult<WorkerReplies[keyof WorkerReplies]>;

const BAD_REQUEST: AnyReply = {
  ok: false,
  failure: { kind: "rejected", message: "Squashflow sent itself a request it does not accept." },
};

export class HelperService {
  constructor(private readonly options: HelperServiceOptions) {}

  async handle(raw: unknown): Promise<AnyReply> {
    const parsed = workerRequestSchema.safeParse(raw);
    if (!parsed.success) return BAD_REQUEST;
    try {
      return await this.dispatch(parsed.data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      return { ok: false, failure: { kind: "rejected", message } };
    }
  }

  private async dispatch(request: WorkerRequest): Promise<AnyReply> {
    switch (request.type) {
      case "status":
        return { ok: true, value: await this.status() };
      case "pair":
        return this.pair(request.code, request.port);
      case "forget":
        await this.options.connections.forget();
        return { ok: true, value: await this.status() };
      case "sessions":
        return this.sessions(request.pageUrl);
      case "remember-site":
        await this.options.sites.set(request.pageUrl, request.repo);
        return { ok: true, value: null };
      case "preview":
        return (await this.client()).preview(request.outgoing);
      case "send":
        return (await this.client()).send(request.outgoing, request.pinId, request.digest);
    }
  }

  private async status(): Promise<ConnectionStatus> {
    const connection = await this.options.connections.load();
    if (connection === null) {
      return { state: "unpaired", port: await this.options.connections.port() };
    }
    const { port } = connection;
    const health = await new HelperClient(this.options.fetch, port, connection.token).health();
    if (health.ok) return { state: "paired", port, version: health.value.version };
    const { kind, message } = health.failure;
    return kind === "unreachable"
      ? { state: "unreachable", port, message }
      : { state: "unpaired", port, message };
  }

  private async pair(code: string, port: number): Promise<AnyReply> {
    const paired = await new HelperClient(this.options.fetch, port, null).pair(code);
    if (!paired.ok) return paired;
    await this.options.connections.save({ port, token: paired.value });
    return { ok: true, value: await this.status() };
  }

  private async sessions(pageUrl: string): Promise<AnyReply> {
    const sessions = await (await this.client()).sessions();
    if (!sessions.ok) return sessions;
    return {
      ok: true,
      value: { sessions: sessions.value, repo: await this.options.sites.get(pageUrl) },
    };
  }

  private async client(): Promise<HelperClient> {
    const connection = await this.options.connections.load();
    return new HelperClient(
      this.options.fetch,
      connection?.port ?? (await this.options.connections.port()),
      connection?.token ?? null,
    );
  }
}
