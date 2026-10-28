/**
 * The helper's HTTP API, called only from the service worker. Requests and responses
 * use the shared schemas the helper itself validates with. The token goes only in the
 * Authorization header; nothing is sent with cookies or followed through redirects.
 */

import {
  deliveredResponseSchema,
  type FollowUpAction,
  type FollowUpRequest,
  errorResponseSchema,
  healthResponseSchema,
  pairResponseSchema,
  previewResponseSchema,
  sessionsResponseSchema,
  type HealthResponse,
  type PinRecord,
  type PinsRequest,
  type PreviewResponse,
  type PublicSession,
} from "@squashflow/shared";
import type * as z from "zod";
import {
  apiFailure,
  INVALID_RESPONSE,
  NOT_PAIRED,
  pairingFailure,
  UNREACHABLE,
  type HelperFailure,
  type HelperResult,
} from "./errors";

/** Session discovery runs `claude agents` and `git` per session, so allow it some time. */
const REQUEST_TIMEOUT_MS = 20_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** What to send for one message: the session's pid, the page and the pins. */
export type OutgoingPins = Pick<PinsRequest, "pageUrl" | "pins"> & { session: number };

export class HelperClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly port: number,
    private readonly token: string | null,
  ) {}

  async pair(code: string): Promise<HelperResult<string>> {
    const result = await this.call("POST", "/pair", pairResponseSchema, { code }, pairingFailure);
    return result.ok ? { ok: true, value: result.value.token } : result;
  }

  health(): Promise<HelperResult<HealthResponse>> {
    return this.authed("GET", "/health", healthResponseSchema);
  }

  async sessions(): Promise<HelperResult<PublicSession[]>> {
    const result = await this.authed("GET", "/sessions", sessionsResponseSchema);
    return result.ok ? { ok: true, value: result.value.sessions } : result;
  }

  /** Build the exact message without delivering it. */
  preview(outgoing: OutgoingPins): Promise<HelperResult<PreviewResponse>> {
    return this.authed("POST", "/pins", previewResponseSchema, { ...outgoing, preview: true });
  }

  /** Deliver the previewed message; the helper refuses anything that differs from it. */
  async send(
    outgoing: OutgoingPins,
    pinId: string,
    digest: string,
  ): Promise<HelperResult<PinRecord>> {
    const body: PinsRequest = { ...outgoing, pinId, digest };
    const result = await this.authed("POST", "/pins", deliveredResponseSchema, body);
    return result.ok ? { ok: true, value: result.value.pin } : result;
  }

  /** Build the exact follow-up for a pin blocked on GitHub access, without delivering it. */
  followUpPreview(
    messageId: string,
    action: FollowUpAction,
  ): Promise<HelperResult<PreviewResponse>> {
    const body: FollowUpRequest = { action, preview: true };
    return this.authed("POST", `/pins/${messageId}/follow-up`, previewResponseSchema, body);
  }

  /** Deliver the previewed follow-up; the helper refuses anything that differs from it. */
  async followUp(
    messageId: string,
    action: FollowUpAction,
    digest: string,
  ): Promise<HelperResult<PinRecord>> {
    const body: FollowUpRequest = { action, digest };
    const result = await this.authed(
      "POST",
      `/pins/${messageId}/follow-up`,
      deliveredResponseSchema,
      body,
    );
    return result.ok ? { ok: true, value: result.value.pin } : result;
  }

  /** A delivered pin's current status and thread. */
  async pin(id: string): Promise<HelperResult<PinRecord>> {
    const result = await this.authed("GET", `/pins/${id}`, deliveredResponseSchema);
    return result.ok ? { ok: true, value: result.value.pin } : result;
  }

  private authed<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<HelperResult<T>> {
    if (this.token === null) return Promise.resolve({ ok: false, failure: NOT_PAIRED });
    return this.call(method, path, schema, body, apiFailure);
  }

  private async call<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body: unknown,
    describe: (status: number, helperError: string | undefined) => HelperFailure,
  ): Promise<HelperResult<T>> {
    const headers: Record<string, string> = {};
    if (this.token !== null) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await this.fetchImpl(`http://127.0.0.1:${this.port}${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, failure: UNREACHABLE };
    }
    const json = await readJson(response);
    if (!response.ok) {
      const error = errorResponseSchema.safeParse(json);
      return { ok: false, failure: describe(response.status, error.data?.error) };
    }
    const parsed = schema.safeParse(json);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, failure: INVALID_RESPONSE };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
