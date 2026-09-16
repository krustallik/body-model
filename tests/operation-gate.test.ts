import { describe, expect, it } from "vitest";
import { tryAcquireOperation } from "@/lib/operation-gate";

describe("operation gate", () => {
  it("rejects overlap and permits a later request after release", () => {
    const release = tryAcquireOperation("forecast-test");
    expect(release).toBeTypeOf("function");
    expect(tryAcquireOperation("forecast-test")).toBeNull();
    release?.();
    expect(tryAcquireOperation("forecast-test")).toBeTypeOf("function");
  });
});
