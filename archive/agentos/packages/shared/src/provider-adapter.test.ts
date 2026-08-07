import { describe, it, expect } from "vitest";
import { PROVIDER_ERROR_CODES } from "./provider-adapter";

describe("PROVIDER_ERROR_CODES", () => {
  it("contains exactly the eight categories defined in the spec", () => {
    expect([...PROVIDER_ERROR_CODES].sort()).toEqual(
      [
        "AUTH_EXPIRED",
        "CANCELLED",
        "CONTEXT_EXCEEDED",
        "PROVIDER_UNAVAILABLE",
        "QUOTA_EXCEEDED",
        "RATE_LIMITED",
        "TOOL_ERROR",
        "UNKNOWN",
      ].sort()
    );
  });
});
