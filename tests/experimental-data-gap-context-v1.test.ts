import { describe, expect, it } from "vitest";
import { rebuildExperimentalDataGapContextsV1 } from "@/model/physiology-v7/experimental-data-gap-context-v1";

const complete = { nutrition: "observed", training: "observed", weight: "observed", sleep: "observed" } as const;
const absent = { nutrition: "missing", training: "unresolved", weight: "missing", sleep: "missing" } as const;

describe("experimental multi-source data gap context", () => {
  it("classifies short, large, and extended gaps without changing raw sources", () => {
    const days = rebuildExperimentalDataGapContextsV1({ days: [
      { date: "2026-01-01", sources: complete },
      { date: "2026-01-02", sources: absent }, { date: "2026-01-03", sources: absent },
      { date: "2026-01-04", sources: absent }, { date: "2026-01-05", sources: absent },
      { date: "2026-01-06", sources: complete },
    ] });
    expect(days[2]).toMatchObject({ gapLengthDays: 2, gapSeverity: "short-data-gap", bridgeProvenance: "modeled-gap-bridge" });
    expect(days[4]).toMatchObject({ gapLengthDays: 4, gapSeverity: "large-data-gap", dataQuality: "degraded" });
    expect(days[5]).toMatchObject({ gapLengthDays: 0, dataQuality: "recovering", rawSourceMutationAllowed: false });
    expect(days[4]!.uncertaintyWidthMultiplier).toBeGreaterThan(days[2]!.uncertaintyWidthMultiplier);
    expect(days[5]!.uncertaintyWidthMultiplier).toBeGreaterThan(1);
    expect(days[1]!.sources.nutrition).toBe("missing");
  });
  it("is deterministic and never treats missing as rest or zero", () => {
    const input = { days: [{ date: "2026-01-01", sources: absent }] };
    expect(rebuildExperimentalDataGapContextsV1(input)).toEqual(rebuildExperimentalDataGapContextsV1(input));
  });
});
