import { describe, expect, it } from "vitest";
import { calculateGlycogenAssociatedMassKg, reconstructBodyWeightKg } from "@/model/body-composition/state";
import { transitionUnifiedExperimentalPhysiologyV1 } from "@/model/unified-experimental-physiology-v1/transition";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";

const envelope = (point: number | null) => ({ point, lower: point, upper: point, representation: "engineering-range" as const });

function transition(input: {
  glycogenDelta: number | null;
  waterDelta: number | null;
  transientDelta: number | null;
  fatDelta?: number | null;
  relativeDeviation?: number;
}) {
  return transitionUnifiedExperimentalPhysiologyV1({
    contractVersion: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
    profileId: 1,
    modelEpisodeId: 10,
    date: "2071-01-01",
    boundaryAt: "2071-01-01T00:00:00.000Z",
    priorState: null,
    priorStateFingerprint: null,
    children: {
      slowTissue: {
        availability: "available", fatMassKg: 20, slowNonFatKg: 50,
        dailyFatDeltaKg: input.fatDelta ?? 0, dailySlowNonFatDeltaKg: 0, provenance: "fat-weight-shadow-v1",
      },
      glycogen: {
        availability: "available", relativeDeviationKg: envelope(input.relativeDeviation ?? 0),
        dailyDeltaKg: input.glycogenDelta === null ? null : envelope(input.glycogenDelta),
        provenance: "experimental-glycogen-state-v2", physicalKg: 0.5,
        physicalAvailability: "available", physicalProvenance: "production-daily-model-state",
      },
      glycogenWater: {
        availability: input.waterDelta === null ? "unavailable" : "available",
        deltaKg: input.waterDelta === null ? null : envelope(input.waterDelta),
        provenance: input.waterDelta === null ? "unavailable" : "physical-glycogen-water-v4-2p7",
        physicalKg: input.waterDelta === null ? null : 1.35,
        physicalProvenance: input.waterDelta === null ? "unavailable" : "production-daily-model-state",
      },
      transientWater: {
        availability: input.transientDelta === null ? "unavailable" : "available",
        levelKg: input.transientDelta === null ? null : envelope(0.4),
        activeImpulses: [], episodeId: 10, modelDate: "2071-01-01",
        boundaryInstant: "2071-01-01T00:00:00.000Z",
        relativeKg: input.transientDelta === null ? null : envelope(input.transientDelta),
        provenance: input.transientDelta === null ? "unavailable" : "experimental-transient-exercise-water-v2-impulse-ledger",
      },
      relativeMuscle: {
        availability: "available", dailyTrainingSignalKg: 1.7, cumulativeDiagnosticKg: 9.2,
        supportStatus: "supported", authoritativeUse: "forbidden", reason: "diagnostic only",
        dailySignalProvenance: "experimental-skeletal-muscle-delta-v2",
        cumulativeProvenance: "experimental-cessation-detraining-v2",
      },
      ecfContext: { availability: "available", deviationKg: 0, provenance: "production-reference" },
    } as never,
    energyLedger: { selectedActivityKcal: null, productionTdeeKcal: null, entries: [], selectedDoseKeys: [], quality: "unavailable" },
    quality: { availability: "available", gapSeverity: "none", sourceQuality: "observed", missingFields: [], reasons: [], modeledGapBridge: false },
    uncertainty: { state: {}, transition: {}, observation: { scaleKg: null, bodyComposition: [] }, model: [], gap: [], dependencyNotes: [] },
    reconciliation: { anchorDate: "2070-12-31", anchorWeightKg: 80, observedWeightKg: 80, reason: null },
    sourceLineage: { modelEpisodeId: 10, modelDate: "2071-01-01", boundaryAt: "2071-01-01T00:00:00.000Z", episodePartitionRevision: "test", dailyHealthData: null, productionDailyState: null, workouts: [], diarySessions: [], childModelRevisions: {}, sourceDate: "2071-01-01" },
  });
}

describe("Unified V4 exact-once physical mass", () => {
  it("uses G + 2.7G exactly once for unchanged, increased, decreased, and explicit-zero glycogen", () => {
    expect(calculateGlycogenAssociatedMassKg(0.5)).toBeCloseTo(1.85, 12);
    expect(calculateGlycogenAssociatedMassKg(0)).toBe(0);
    expect(transition({ glycogenDelta: 0, waterDelta: 0, transientDelta: 0.3 }).deltas.modeledChangeSinceAnchorKg?.point).toBeCloseTo(0.3, 12);
    expect(transition({ glycogenDelta: 0.2, waterDelta: 0.54, transientDelta: 0.3, fatDelta: 0.1 }).deltas.modeledChangeSinceAnchorKg?.point).toBeCloseTo(1.14, 12);
    expect(transition({ glycogenDelta: -0.2, waterDelta: -0.54, transientDelta: 0.3, fatDelta: -0.1 }).deltas.modeledChangeSinceAnchorKg?.point).toBeCloseTo(-0.54, 12);
    expect(transition({ glycogenDelta: -0.5, waterDelta: -1.35, transientDelta: 0.3 }).deltas.modeledChangeSinceAnchorKg?.point).toBeCloseTo(-1.55, 12);
  });

  it("keeps transient exercise water additive once and relative glycogen diagnostic-only", () => {
    const result = transition({ glycogenDelta: 0.2, waterDelta: 0.54, transientDelta: 0.3, relativeDeviation: 12 });
    expect(result.deltas.modeledChangeSinceAnchorKg?.point).toBeCloseTo(1.04, 12);
    expect(result.state.relativeMuscle.authoritativeUse).toBe("forbidden");
    expect(result.state.glycogen.relativeDeviationKg?.point).toBe(12);
    expect(reconstructBodyWeightKg({
      fatMassKg: 20, leanTissueKg: 50, glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 18, extracellularFluidDeviationLiters: 0,
    })).toBeCloseTo(20 + 50 + 0.5 + 1.35 + 18, 12);
  });

  it("nulls the dependent reconciliation and residual instead of publishing a partial mass sum", () => {
    const result = transition({ glycogenDelta: null, waterDelta: null, transientDelta: 0.3 });
    expect(result.deltas.modeledChangeSinceAnchorKg).toBeNull();
    expect(result.reconciliation.unexplainedResidualKg).toBeNull();
  });
});
