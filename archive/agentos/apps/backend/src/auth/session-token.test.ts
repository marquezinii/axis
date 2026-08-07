// apps/backend/src/auth/session-token.test.ts
import { describe, it, expect } from "vitest";
import { generateSessionToken } from "./session-token";

describe("generateSessionToken", () => {
  it("generates a 64-hex-char token, different each call", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
