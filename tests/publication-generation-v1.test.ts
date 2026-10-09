import { describe, expect, it } from "vitest";
import { isProductionGenerationCurrentV1, isUnifiedGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";

describe("Active Energy publication generation gates", () => {
  const published = {
    invalidationGeneration: 12,
    productionStaleFromDate: null,
    productionPublishedGeneration: 12,
    unifiedPublishedGeneration: 12,
  };

  it("allows each layer only when its published pointer equals the current generation", () => {
    expect(isProductionGenerationCurrentV1(published)).toBe(true);
    expect(isUnifiedGenerationCurrentV1(published)).toBe(true);
  });

  it("rejects source mutation, dirty production, failed production, and stale Unified publication", () => {
    expect(isProductionGenerationCurrentV1({ ...published, invalidationGeneration: 13 })).toBe(false);
    expect(isProductionGenerationCurrentV1({ ...published, productionStaleFromDate: "2026-09-30" })).toBe(false);
    expect(isProductionGenerationCurrentV1({ ...published, productionPublishedGeneration: null })).toBe(false);
    expect(isUnifiedGenerationCurrentV1({ ...published, unifiedPublishedGeneration: 11 })).toBe(false);
    expect(isUnifiedGenerationCurrentV1({ ...published, unifiedPublishedGeneration: null })).toBe(false);
  });
});
