import { describe, expect, it } from "vitest";
import { isValidApiKey } from "@/modules/health/auth";

const expected = "correct-long-secret";

describe("iOS Shortcut API key authentication", () => {
  it("accepts the correct API key", () => expect(isValidApiKey(expected, expected)).toBe(true));
  it("rejects an incorrect API key", () => expect(isValidApiKey("incorrect", expected)).toBe(false));
  it("rejects a missing API key", () => expect(isValidApiKey(null, expected)).toBe(false));
  it("rejects an empty API key", () => expect(isValidApiKey("", expected)).toBe(false));
  it("rejects whitespace without normalizing a secret", () => expect(isValidApiKey("   ", expected)).toBe(false));
});
