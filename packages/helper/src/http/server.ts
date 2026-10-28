/** The helper's HTTP server: 127.0.0.1 only, paired extension only. */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { PublicSession } from "@squashflow/shared";
import { HELPER_VERSION, LOOPBACK_HOST } from "../constants.js";
import { DraftError, type DeliveryService, type DraftErrorReason } from "../delivery.js";
import { generateToken, hashToken, type PairingCodes } from "../pairing.js";
import {
  followUpRequestSchema,
  pairRequestSchema,
  pinsRequestSchema,
  type FollowUpRequest,
  type PinsRequest,
} from "../schemas.js";
import {
  findSession,
  SessionLookupError,
  type SessionInfo,
  type SessionLookupReason,
} from "../sessions.js";
import { SocketRefusedError } from "../socket.js";
import type { PairingRecord } from "../state.js";
import {
  checkDeclaredSize,
  checkHost,
  checkOrigin,
  checkToken,
  isExtensionOrigin,
  readJsonBody,
  type CheckFailure,
} from "./checks.js";

const SSE_KEEPALIVE_MS = 15_000;
const PIN_PATH = /^\/pins\/(sf-[0-9a-f]{12})$/;
const FOLLOW_UP_PATH = /^\/pins\/(sf-[0-9a-f]{12})\/follow-up$/;

export interface HelperLog {
  info(text: string): void;
  arrow(text: string): void;
  warn(text: string): void;
}

export interface HelperContext {
  port: number;
  maxBodyBytes: number;
  /** The larger cap for `POST /pins`, whose pins may carry region screenshots. */
  maxPinsBodyBytes: number;
  auth: { tokenHash: string | null; origin: string | null };
  pairing: PairingCodes;
  savePairing(record: PairingRecord): Promise<void>;
  delivery: DeliveryService;
  discover(): Promise<SessionInfo[]>;
  log: HelperLog;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/** Refuse any bind address other than 127.0.0.1. */
export function assertLoopbackHost(host: string): void {
  if (host !== LOOPBACK_HOST) {
    throw new Error(`Refusing to bind ${host}: the helper only listens on ${LOOPBACK_HOST}.`);
  }
}

export async function startServer(
  context: HelperContext,
  host = LOOPBACK_HOST,
): Promise<RunningServer> {
  assertLoopbackHost(host);
  const server = createServer((request, response) => {
    handle(context, request, response).catch((error: unknown) => {
      context.log.warn(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) send(response, 500, { error: "Internal error" });
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(context.port, host, () => {
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : context.port;
  context.port = port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

async function handle(
  context: HelperContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";
  const path = (request.url ?? "/").split("?")[0] ?? "/";
  const origin = request.headers.origin;
  const isPairing = path === "/pair";
  const allowedOrigin = (candidate: string): boolean =>
    isPairing ? isExtensionOrigin(candidate) : candidate === context.auth.origin;

  const early =
    checkHost(request.headers.host, context.port) ??
    checkOrigin(method, origin, allowedOrigin) ??
    checkDeclaredSize(request.headers, bodyCap(context, path));
  if (early) {
    fail(response, early);
    return;
  }
  if (origin !== undefined) setCors(response, origin);
  if (method === "OPTIONS") {
    preflight(response);
    return;
  }
  if (isPairing) {
    if (method === "POST") await pair(context, request, response, origin);
    else notAllowed(response);
    return;
  }

  const tokenFailure = checkToken(request.headers.authorization, context.auth.tokenHash);
  if (tokenFailure) {
    fail(response, tokenFailure);
    return;
  }
  await route(context, request, response, method, path);
}

function bodyCap(context: HelperContext, path: string): number {
  return path === "/pins" ? context.maxPinsBodyBytes : context.maxBodyBytes;
}

async function route(
  context: HelperContext,
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
): Promise<void> {
  if (path === "/health" && method === "GET") {
    send(response, 200, { ok: true, paired: true, version: HELPER_VERSION });
  } else if (path === "/sessions" && method === "GET") {
    await sessions(context, response);
  } else if (path === "/pins" && method === "POST") {
    await pins(context, request, response);
  } else if (path === "/events" && method === "GET") {
    events(context, response);
  } else if (FOLLOW_UP_PATH.test(path) && method === "POST") {
    await followUp(context, request, response, FOLLOW_UP_PATH.exec(path)?.[1] ?? "");
  } else {
    const pinId = PIN_PATH.exec(path)?.[1];
    const pin = pinId !== undefined && method === "GET" ? context.delivery.get(pinId) : undefined;
    if (pin) send(response, 200, { pin });
    else send(response, 404, { error: pinId === undefined ? "Not found" : "Unknown pin" });
  }
}

async function pair(
  context: HelperContext,
  request: IncomingMessage,
  response: ServerResponse,
  origin: string | undefined,
): Promise<void> {
  const body = await readJsonBody(request, context.maxBodyBytes, pairRequestSchema);
  if (!body.ok) {
    fail(response, body);
    return;
  }
  if (origin === undefined) {
    fail(response, { status: 403, error: "Origin required" });
    return;
  }
  const result = context.pairing.attempt(body.value.code);
  if (result === "none") {
    send(response, 409, { error: "No pairing code is active" });
    return;
  }
  if (result === "expired") {
    context.log.warn("pairing code expired; press Enter for a new one");
    send(response, 410, { error: "Pairing code expired" });
    return;
  }
  if (result === "locked") {
    context.log.warn("too many wrong pairing codes; press Enter for a new one");
    send(response, 429, { error: "Too many attempts" });
    return;
  }
  if (result === "invalid") {
    send(response, 401, { error: "Wrong pairing code" });
    return;
  }

  const token = generateToken();
  const record: PairingRecord = {
    tokenHash: hashToken(token),
    origin,
    pairedAt: new Date().toISOString(),
  };
  await context.savePairing(record);
  context.auth = { tokenHash: record.tokenHash, origin };
  context.log.info("paired with Chrome");
  send(response, 200, { token });
}

async function sessions(context: HelperContext, response: ServerResponse): Promise<void> {
  const list = await context.discover();
  send(response, 200, { sessions: list.map(publicSession) });
}

async function pins(
  context: HelperContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request, context.maxPinsBodyBytes, pinsRequestSchema);
  if (!body.ok) {
    fail(response, body);
    return;
  }
  const input = body.value;
  let session: SessionInfo;
  try {
    session = findSession(await context.discover(), String(input.session));
  } catch (error) {
    sendFailure(context, response, error, "session lookup");
    return;
  }
  if (input.preview === true) {
    const draft = context.delivery.createDraft(session, "browser", input.pageUrl, input.pins);
    send(response, 200, {
      pinId: draft.pinId,
      digest: draft.digest,
      message: draft.message,
    });
    return;
  }
  return deliverPreviewed(context, response, input, session);
}

async function deliverPreviewed(
  context: HelperContext,
  response: ServerResponse,
  input: PinsRequest,
  session: SessionInfo,
): Promise<void> {
  if (input.pinId === undefined || input.digest === undefined) {
    send(response, 400, {
      error: "Preview the message first, then send its pinId and digest",
    });
    return;
  }
  try {
    const { draft, screenshots } = context.delivery.verifyDraft(
      input.pinId,
      input.digest,
      input.pageUrl,
      input.pins,
    );
    if (draft.session.pid !== session.pid) {
      send(response, 409, { error: "The session changed since the preview; preview again" });
      return;
    }
    const pin = await context.delivery.deliver({ ...draft, session }, screenshots);
    context.log.arrow(`claude@${session.name}  pin ${pin.number}`);
    send(response, 202, { pin });
    return;
  } catch (error) {
    sendFailure(context, response, error, "delivery");
    return;
  }
}

/**
 * A follow-up to a pin blocked on GitHub access: preview it, then deliver it with the
 * preview's digest, to the same session the pin went to (same pid and session id).
 */
async function followUp(
  context: HelperContext,
  request: IncomingMessage,
  response: ServerResponse,
  pinId: string,
): Promise<void> {
  const body = await readJsonBody(request, context.maxBodyBytes, followUpRequestSchema);
  if (!body.ok) {
    fail(response, body);
    return;
  }
  try {
    const session = await followUpSession(context, pinId);
    if (body.value.preview === true) {
      const draft = context.delivery.createFollowUp(pinId, body.value.action);
      send(response, 200, { pinId, digest: draft.digest, message: draft.message });
      return;
    }
    await deliverFollowUp(context, response, pinId, body.value, session);
  } catch (error) {
    sendFailure(context, response, error, "follow-up");
  }
}

async function deliverFollowUp(
  context: HelperContext,
  response: ServerResponse,
  pinId: string,
  input: FollowUpRequest,
  session: SessionInfo,
): Promise<void> {
  if (input.digest === undefined) {
    send(response, 400, { error: "Preview the follow-up first, then send its digest" });
    return;
  }
  const draft = context.delivery.verifyFollowUp(pinId, input.action, input.digest);
  const pin = await context.delivery.deliverFollowUp(draft, session);
  context.log.arrow(`claude@${session.name}  pin ${pin.number} follow-up (${input.action})`);
  send(response, 202, { pin });
}

/** The running session the pin was delivered to, or a not-found failure. */
async function followUpSession(context: HelperContext, pinId: string): Promise<SessionInfo> {
  const original = context.delivery.sessionOf(pinId);
  if (original === undefined) throw new DraftError("unknown-pin", "No pin with that id.");
  const running = (await context.discover()).find(
    (session) => session.pid === original.pid && session.sessionId === original.sessionId,
  );
  if (running === undefined) {
    throw new SessionLookupError("not-found", "The pin's session is no longer running.");
  }
  return running;
}

function events(context: HelperContext, response: ServerResponse): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  const openedWith = context.auth.tokenHash;
  const write = (chunk: string): void => {
    if (context.auth.tokenHash === openedWith) response.write(chunk);
    else response.end();
  };
  write(": squashflow events\n\n");
  const unsubscribe = context.delivery.subscribe((pin) => {
    write(`event: pin\ndata: ${JSON.stringify(pin)}\n\n`);
  });
  const keepalive = setInterval(() => {
    write(": keepalive\n\n");
  }, SSE_KEEPALIVE_MS);
  response.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
}

export function publicSession(session: SessionInfo): PublicSession {
  return {
    pid: session.pid,
    name: session.name,
    status: session.status,
    cwd: session.cwd,
    repo: session.repo?.fullName ?? null,
    title: session.title,
    branch: session.branch,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
  };
}

function setCors(response: ServerResponse, origin: string): void {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
}

function preflight(response: ServerResponse): void {
  response.writeHead(204, {
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
  });
  response.end();
}

function notAllowed(response: ServerResponse): void {
  send(response, 405, { error: "Method not allowed" });
}

function fail(response: ServerResponse, failure: CheckFailure): void {
  send(response, failure.status, { error: failure.error });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

/**
 * Client-facing failures use fixed strings chosen by error kind, so no caught
 * error text (paths, command output, stack traces) reaches the HTTP response.
 * Unexpected errors are logged in the helper's terminal only.
 */
const SESSION_LOOKUP_FAILURES: Record<SessionLookupReason, CheckFailure> = {
  "not-found": { status: 404, error: "No running Claude Code session matches that session" },
  ambiguous: { status: 409, error: "Several sessions match that name; pick one by pid" },
};

const DRAFT_FAILURES: Record<DraftErrorReason, CheckFailure> = {
  missing: { status: 409, error: "No preview with that pin id; preview the message again" },
  changed: { status: 409, error: "The message changed since it was previewed; preview again" },
  "no-session-id": {
    status: 409,
    error: "That session has no session id, so delivery cannot be confirmed",
  },
  "unknown-pin": { status: 404, error: "Unknown pin" },
  "not-blocked": {
    status: 409,
    error: "Follow-ups are only for pins blocked on GitHub access and not in flight",
  },
};

const SOCKET_REFUSED: CheckFailure = {
  status: 409,
  error: "The session's inbox socket was refused (missing, not owned by you, or not mode 600)",
};

export const UNEXPECTED_FAILURE: CheckFailure = {
  status: 502,
  error: "The helper could not complete the request; see its terminal for details",
};

export function publicFailure(error: unknown): CheckFailure {
  if (error instanceof SessionLookupError) return SESSION_LOOKUP_FAILURES[error.reason];
  if (error instanceof DraftError) return DRAFT_FAILURES[error.reason];
  if (error instanceof SocketRefusedError) return SOCKET_REFUSED;
  return UNEXPECTED_FAILURE;
}

function sendFailure(
  context: HelperContext,
  response: ServerResponse,
  error: unknown,
  operation: string,
): void {
  const failure = publicFailure(error);
  if (failure === UNEXPECTED_FAILURE) {
    context.log.warn(
      `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  fail(response, failure);
}
