/**
 * The ordered request checks. Every request is rejected on the first failure:
 * 1. Host  2. Origin  3. Size  4. Token  5. Schema (after the body is read under the cap).
 */

import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { z } from "zod";
import { verifyToken } from "../pairing.js";

export interface CheckFailure {
  status: number;
  error: string;
}

export type CheckResult = CheckFailure | null;

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isExtensionOrigin(origin: string): boolean {
  return EXTENSION_ORIGIN.test(origin);
}

/** 1. Exactly `127.0.0.1:<port>`, which defeats DNS rebinding. */
export function checkHost(host: string | undefined, port: number): CheckResult {
  return host === `127.0.0.1:${port}` ? null : { status: 403, error: "Host not allowed" };
}

/**
 * 2. A present Origin must be the allowed one; state-changing requests must carry it.
 * `allowed` is the paired extension origin, or for pairing any extension origin.
 */
export function checkOrigin(
  method: string,
  origin: string | undefined,
  allowed: (origin: string) => boolean,
): CheckResult {
  if (origin === undefined) {
    return SAFE_METHODS.has(method) ? null : { status: 403, error: "Origin required" };
  }
  return allowed(origin) ? null : { status: 403, error: "Origin not allowed" };
}

/** 3. Declared size within the cap; bodies without a length are capped while streaming. */
export function checkDeclaredSize(headers: IncomingHttpHeaders, maxBytes: number): CheckResult {
  const declared = headers["content-length"];
  if (declared === undefined) return null;
  const length = Number(declared);
  if (!Number.isSafeInteger(length) || length < 0) {
    return { status: 400, error: "Invalid Content-Length" };
  }
  return length > maxBytes ? { status: 413, error: "Body too large" } : null;
}

/** 4. `Authorization: Bearer <token>`, compared in constant time against the stored hash. */
export function checkToken(
  authorization: string | undefined,
  tokenHash: string | null,
): CheckResult {
  if (tokenHash === null) return { status: 401, error: "Not paired" };
  const match = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(authorization ?? "");
  if (!match?.[1] || !verifyToken(match[1], tokenHash)) {
    return { status: 401, error: "Invalid token" };
  }
  return null;
}

export type BodyResult<T> = { ok: true; value: T } | ({ ok: false } & CheckFailure);

/** Read the body under the cap, then 5. validate it against a strict schema. */
export async function readJsonBody<T>(
  request: IncomingMessage,
  maxBytes: number,
  schema: z.ZodType<T>,
): Promise<BodyResult<T>> {
  const raw = await readCapped(request, maxBytes);
  if (raw === null) return { ok: false, status: 413, error: "Body too large" };
  if (raw.length === 0) return { ok: false, status: 400, error: "Body required" };
  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: "Body is not valid JSON" };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    return {
      ok: false,
      status: 400,
      error: `Invalid body${where}: ${issue?.message ?? "invalid"}`,
    };
  }
  return { ok: true, value: parsed.data };
}

function readCapped(request: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    request.on("data", (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        request.resume();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}
