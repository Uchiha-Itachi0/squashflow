/** Pairing: a short single-use code in the terminal, exchanged for a high-entropy token. */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TOKEN_BYTES,
} from "./constants.js";

/** No 0/O, 1/I/L or U, so codes survive being read aloud or retyped. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export type PairingAttempt = "ok" | "invalid" | "expired" | "locked" | "none";

export interface IssuedCode {
  code: string;
  expiresAt: number;
}

export interface PairingCodeOptions {
  ttlMs?: number;
  maxAttempts?: number;
  now?: () => number;
}

interface ActiveCode {
  normalised: string;
  expiresAt: number;
  attemptsLeft: number;
}

export class PairingCodes {
  private active: ActiveCode | null = null;
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;

  constructor({
    ttlMs = PAIRING_CODE_TTL_MS,
    maxAttempts = PAIRING_MAX_ATTEMPTS,
    now = Date.now,
  }: PairingCodeOptions = {}) {
    this.ttlMs = ttlMs;
    this.maxAttempts = maxAttempts;
    this.now = now;
  }

  /** Issue a fresh code, replacing any previous one. */
  issue(): IssuedCode {
    let normalised = "";
    for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
      normalised += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
    }
    const expiresAt = this.now() + this.ttlMs;
    this.active = { normalised, expiresAt, attemptsLeft: this.maxAttempts };
    return { code: formatCode(normalised), expiresAt };
  }

  /** Check a submitted code. A correct code is consumed; too many wrong ones lock it. */
  attempt(submitted: string): PairingAttempt {
    const active = this.active;
    if (!active) return "none";
    if (this.now() >= active.expiresAt) {
      this.active = null;
      return "expired";
    }
    if (constantTimeEqual(normaliseCode(submitted), active.normalised)) {
      this.active = null;
      return "ok";
    }
    active.attemptsLeft -= 1;
    if (active.attemptsLeft <= 0) {
      this.active = null;
      return "locked";
    }
    return "invalid";
  }
}

export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

function formatCode(normalised: string): string {
  const half = normalised.length / 2;
  return `${normalised.slice(0, half)}-${normalised.slice(half)}`;
}

export function generateToken(): string {
  return randomBytes(PAIRING_TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time check of a presented token against the stored SHA-256 hash. */
export function verifyToken(presented: string, storedHash: string): boolean {
  const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
  const storedDigest = Buffer.from(storedHash, "hex");
  if (storedDigest.length !== presentedDigest.length) return false;
  return timingSafeEqual(presentedDigest, storedDigest);
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}
