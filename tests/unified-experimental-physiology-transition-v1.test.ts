import { describe, expect, it } from "vitest";
import { transitionUnifiedExperimentalPhysiologyV1, type UnifiedChildTransitionsV1 } from "@/model/unified-experimental-physiology-v1";

const unavailableEnvelope = { point: null, lower: null, upper: null, representation: "engineering-range" as const };
const availableEnvelope = (point: number) => ({ point, lower: point, upper: point, representation: "engineering-range" as const });

function children(): UnifiedChildTransitionsV1 {
  return {
    slowTissue: { availability: "available", fatMassKg: 20.1, slowNonFatKg: 60.2, provenance: "fat-weight-shadow-v1", dailyFatDeltaKg: -0.02, dailySlowNonFatDeltaKg: 0.01 },
    glycogen: { availability: "available", relativeDeviationKg: availableEnvelope(-0.2), dailyDeltaKg: availableEnvelope(-0.1), provenance: "experimental-glycogen-state-v2" },
    glycogenWater: { availability: "available", deltaKg: availableEnvelope(-0.3), provenance: "experimental-glycogen-associated-water-v1" },
    transientWater: { availability: "available", relativeKg: availableEnvelope(0.2), provenance: "experimental-transient-exercise-water-v1" },
    relativeMuscle: { availability: "partial", cumulativeDeltaKg: availableEnvelope(0.01), supportStatus: "degraded", authoritativeUse: "forbidden", reason: "no-defensible-personal-quantitative-supported-domain", provenance: "experimental-cessation-detraining-v1" },
    ecfContext: { availability: "unavailable", deviationKg: null, provenance: "unavailable" },
  };
}

const ledger = { selectedActivityKcal: 500, productionTdeeKcal: 2_900, entries: [], selectedDoseKeys: [], quality: "available" as const };
const quality = { availability: "available" as const, gapSeverity: "none" as const, sourceQuality: "observed" as const, missingFields: [], reasons: [], modeledGapBridge: false };
const uncertainty = { state: {}, transition: {}, observation: { scaleKg: null, bodyComposition: [] }, model: [], gap: [], dependencyNotes: [] };
const lineage = { dailyHealthData: null, productionDailyState: null, workouts: [], diarySessions: [], childModelRevisions: {}, sourceDate: "2065-01-01" };

describe("Unified V1 pure transition", () => {
  it("composes slow and fast change without adding relative muscle", () => {
    const result = transitionUnifiedExperimentalPhysiologyV1({
      profileId: 1, date: "2065-01-01", priorState: null, priorStateFingerprint: null,
      children: children(), energyLedger: ledger, quality, uncertainty,
      reconciliation: { anchorDate: "2064-12-31", anchorWeightKg: 80, observedWeightKg: 79.8, reason: null },
      sourceLineage: lineage,
    });
    expect(result.deltas.modeledChangeSinceAnchorKg?.point).toBeCloseTo(-0.21);
    expect(result.state.relativeMuscle.authoritativeUse).toBe("forbidden");
    expect(JSON.stringify(result)).not.toContain("skeletalMuscleKg");
  });

  it("does not invent total change when a required component is unavailable", () => {
    const input = children();
    input.glycogen.dailyDeltaKg = unavailableEnvelope;
    const result = transitionUnifiedExperimentalPhysiologyV1({ profileId: 1, date: "2065-01-01", priorState: null, priorStateFingerprint: null, children: input, energyLedger: ledger, quality, uncertainty, reconciliation: { anchorDate: null, anchorWeightKg: null, observedWeightKg: null, reason: null }, sourceLineage: lineage });
    expect(result.deltas.modeledChangeSinceAnchorKg).toBeNull();
    expect(result.reconciliation.unexplainedResidualKg).toBeNull();
  });
});
