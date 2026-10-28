import { describe, expect, it } from "vitest";
import {
  generateToken,
  hashToken,
  normaliseCode,
  PairingCodes,
  verifyToken,
} from "../src/pairing.js";

function clock(start = 1_000_000): { now: () => number; advance(ms: number): void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe("PairingCodes", () => {
  it("accepts the issued code once, with or without dash and case", () => {
    const codes = new PairingCodes();
    const { code } = codes.issue();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(codes.attempt(code.toLowerCase().replace("-", ""))).toBe("ok");
    expect(codes.attempt(code)).toBe("none");
  });

  it("expires after the TTL", () => {
    const time = clock();
    const codes = new PairingCodes({ ttlMs: 1000, now: time.now });
    const { code } = codes.issue();
    time.advance(1000);
    expect(codes.attempt(code)).toBe("expired");
    expect(codes.attempt(code)).toBe("none");
  });

  it("locks after the attempt limit, even for the right code afterwards", () => {
    const codes = new PairingCodes({ maxAttempts: 3 });
    const { code } = codes.issue();
    expect(codes.attempt("AAAA-AAAA")).toBe("invalid");
    expect(codes.attempt("AAAA-AAAB")).toBe("invalid");
    expect(codes.attempt("AAAA-AAAC")).toBe("locked");
    expect(codes.attempt(code)).toBe("none");
  });

  it("replaces the previous code when a new one is issued", () => {
    const codes = new PairingCodes();
    const first = codes.issue().code;
    const second = codes.issue().code;
    if (first !== second) expect(codes.attempt(first)).toBe("invalid");
    expect(codes.attempt(second)).toBe("ok");
  });

  it("normalises codes", () => {
    expect(normaliseCode(" ab cd-ef ")).toBe("ABCDEF");
  });
});

describe("tokens", () => {
  it("are high entropy and verify only against their own hash", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyToken(token, hash)).toBe(true);
    expect(verifyToken(generateToken(), hash)).toBe(false);
    expect(verifyToken(token, "abcd")).toBe(false);
  });
});
