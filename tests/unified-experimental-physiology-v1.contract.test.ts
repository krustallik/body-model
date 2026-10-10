import { describe, expect, it } from "vitest";
import {
  assertFiniteUnifiedNumbers,
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
  serializeUnifiedExperimentalPhysiologyV1,
  type UnifiedExperimentalPhysiologyDayResultV1,
} from "@/model/unified-experimental-physiology-v1";
import { TRANSIENT_EPISODE_PARTITION_V2_REVISION } from "@/modules/model-episodes/transient-exercise-water-episode-time-v2";

function fixture(): UnifiedExperimentalPhysiologyDayResultV1 {
  const unavailable = { availability: "unavailable" as const, point: null, lower: null, upper: null, representation: "engineering-range" as const };
  const result = {
    contractVersion: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
    profileId: 1,
    modelEpisodeId: 1,
    date: "2065-01-01",
    boundaryAt: "2065-01-01T00:00:00.000Z",
    priorStateFingerprint: "prior",
    sourceFingerprint: "source",
    state: {
      slowTissue: { availability: "unavailable" as const, fatMassKg: null, slowNonFatKg: null, provenance: "unavailable" as const },
      glycogen: { availability: "unavailable" as const, relativeDeviationKg: null, dailyDeltaKg: null, provenance: "unavailable" as const },
      glycogenWater: { availability: "unavailable" as const, deltaKg: null, provenance: "unavailable" as const },
      transientWater: { availability: "unavailable" as const, relativeKg: null, provenance: "unavailable" as const },
      relativeMuscle: { availability: "unavailable" as const, dailyTrainingSignalKg: null, cumulativeDiagnosticKg: null, supportStatus: "outside-supported-domain" as const, authoritativeUse: "forbidden" as const, reason: "missing", dailySignalProvenance: "unavailable" as const, cumulativeProvenance: "unavailable" as const },
      ecfContext: { availability: "unavailable" as const, deviationKg: null, provenance: "unavailable" as const },
    },
    deltas: { slowTissueKg: { fat: null, slowNonFat: null }, glycogenKg: unavailable, glycogenWaterKg: unavailable, transientWaterKg: unavailable, modeledChangeSinceAnchorKg: null },
    energyLedger: { selectedActivityKcal: null, productionTdeeKcal: null, entries: [], selectedDoseKeys: [], quality: "unavailable" as const },
    quality: { availability: "unavailable" as const, gapSeverity: "extended-gap" as const, sourceQuality: "missing" as const, missingFields: ["nutrition"], reasons: ["missing"], modeledGapBridge: false },
    uncertainty: { state: {}, transition: {}, observation: { scaleKg: null, bodyComposition: [] }, model: [], gap: ["missing"], dependencyNotes: [] },
    reconciliation: { anchorDate: null, anchorWeightKg: null, observedWeightKg: null, observedChangeKg: null, modeledChangeSinceAnchorKg: null, unexplainedResidualKg: null, handling: "no-anchor" as const, reason: "missing" },
    sourceLineage: { modelEpisodeId: 1, modelDate: "2065-01-01", boundaryAt: "2065-01-01T00:00:00.000Z", episodePartitionRevision: TRANSIENT_EPISODE_PARTITION_V2_REVISION, dailyHealthData: null, productionDailyState: null, workouts: [], diarySessions: [], childModelRevisions: {}, sourceDate: "2065-01-01" },
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
