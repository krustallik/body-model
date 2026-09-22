import { describe, expect, it } from "vitest";
import {
  assertFiniteUnifiedNumbers,
  serializeUnifiedExperimentalPhysiologyV1,
  type UnifiedExperimentalPhysiologyDayResultV1,
} from "@/model/unified-experimental-physiology-v1";

function fixture(): UnifiedExperimentalPhysiologyDayResultV1 {
  const unavailable = { availability: "unavailable" as const, point: null, lower: null, upper: null, representation: "engineering-range" as const };
  const result = {
    contractVersion: "unified-experimental-physiology-state-v1" as const,
    profileId: 1,
    date: "2065-01-01",
    priorStateFingerprint: "prior",
    sourceFingerprint: "source",
    state: {
      slowTissue: { availability: "unavailable" as const, fatMassKg: null, slowNonFatKg: null, provenance: "unavailable" as const },
      glycogen: { availability: "unavailable" as const, relativeDeviationKg: null, dailyDeltaKg: null, provenance: "unavailable" as const },
      glycogenWater: { availability: "unavailable" as const, deltaKg: null, provenance: "unavailable" as const },
      transientWater: { availability: "unavailable" as const, relativeKg: null, provenance: "unavailable" as const },
      relativeMuscle: { availability: "unavailable" as const, cumulativeDeltaKg: null, supportStatus: "degraded" as const, authoritativeUse: "forbidden" as const, reason: "missing", provenance: "unavailable" as const },
      ecfContext: { availability: "unavailable" as const, deviationKg: null, provenance: "unavailable" as const },
    },
    deltas: { slowTissueKg: { fat: null, slowNonFat: null }, glycogenKg: unavailable, glycogenWaterKg: unavailable, transientWaterKg: unavailable, modeledChangeSinceAnchorKg: null },
    energyLedger: { selectedActivityKcal: null, productionTdeeKcal: null, entries: [], selectedDoseKeys: [], quality: "unavailable" as const },
    quality: { availability: "unavailable" as const, gapSeverity: "extended-gap" as const, sourceQuality: "missing" as const, missingFields: ["nutrition"], reasons: ["missing"], modeledGapBridge: false },
    uncertainty: { state: {}, transition: {}, observation: { scaleKg: null, bodyComposition: [] }, model: [], gap: ["missing"], dependencyNotes: [] },
    reconciliation: { anchorDate: null, anchorWeightKg: null, observedWeightKg: null, observedChangeKg: null, modeledChangeSinceAnchorKg: null, unexplainedResidualKg: null, handling: "no-anchor" as const, reason: "missing" },
    sourceLineage: { dailyHealthData: null, productionDailyState: null, workouts: [], diarySessions: [], childModelRevisions: {}, sourceDate: "2065-01-01" },
    diagnostics: { componentComparisons: {}, rejectedConversions: [], notes: [] },
    resultFingerprint: "result",
  };
  return result;
}

describe("UnifiedExperimentalPhysiologyStateV1 contract", () => {
  it("serializes finite structured state and has no absolute muscle compartment", () => {
    const value = serializeUnifiedExperimentalPhysiologyV1(fixture());
    expect(value).toEqual(fixture());
    expect(JSON.stringify(value)).not.toContain("skeletalMuscleKg");
  });

  it("rejects non-finite numbers and forbidden absolute skeletal muscle", () => {
    expect(() => assertFiniteUnifiedNumbers({ value: Number.NaN })).toThrow(/non-finite/);
    expect(() => assertFiniteUnifiedNumbers({ skeletalMuscleKg: 70 })).toThrow(/skeletalMuscleKg/);
  });
});
