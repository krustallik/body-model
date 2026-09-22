import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export const UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V1_REVISION =
  "unified-experimental-physiology-state-v1" as const;

export type UnifiedAvailabilityV1 = "available" | "partial" | "unavailable";
export type UnifiedGapSeverityV1 = "none" | "short-gap" | "large-gap" | "extended-gap";
export type UnifiedSourceQualityV1 = "observed" | "estimated" | "modeled-gap-bridge" | "missing";

export type UnifiedNumericEnvelopeV1 = {
  point: number | null;
  lower: number | null;
  upper: number | null;
  representation: "engineering-range";
};

export type UnifiedSlowTissueStateV1 = {
  availability: UnifiedAvailabilityV1;
  fatMassKg: number | null;
  slowNonFatKg: number | null;
  provenance: "fat-weight-shadow-v1" | "unavailable";
};

export type UnifiedGlycogenStateV1 = {
  availability: UnifiedAvailabilityV1;
  relativeDeviationKg: UnifiedNumericEnvelopeV1 | null;
  dailyDeltaKg: UnifiedNumericEnvelopeV1 | null;
  provenance: "experimental-glycogen-state-v2" | "unavailable";
};

export type UnifiedGlycogenWaterStateV1 = {
  availability: UnifiedAvailabilityV1;
  deltaKg: UnifiedNumericEnvelopeV1 | null;
  provenance: "experimental-glycogen-associated-water-v1" | "unavailable";
};

export type UnifiedTransientWaterStateV1 = {
  availability: UnifiedAvailabilityV1;
  relativeKg: UnifiedNumericEnvelopeV1 | null;
  provenance: "experimental-transient-exercise-water-v1" | "unavailable";
};

export type UnifiedRelativeMuscleDiagnosticV1 = {
  availability: UnifiedAvailabilityV1;
  cumulativeDeltaKg: UnifiedNumericEnvelopeV1 | null;
  supportStatus: "supported" | "degraded" | "outside-supported-domain";
  authoritativeUse: "forbidden";
  reason: string;
  provenance: "experimental-cessation-detraining-v1" | "unavailable";
};

export type UnifiedEcfContextV1 = {
  availability: UnifiedAvailabilityV1;
  deviationKg: number | null;
  provenance: "production-reference" | "unavailable";
};

export type UnifiedEnergyLedgerEntryV1 = {
  kind: "dynamic-rmr" | "tef" | "walking" | "occupational" | "workout" | "stepper"
    | "adaptive-thermogenesis" | "personal-offset" | "garmin-device" | "strength-shadow"
    | "stepper-shadow" | "epoc-context";
  status: "selected" | "reference" | "diagnostic" | "unavailable";
  valueKcal: number | null;
  source: string;
  replacesOrOverlaps: string[];
  reason: string | null;
};

export type UnifiedEnergyLedgerV1 = {
  selectedActivityKcal: number | null;
  productionTdeeKcal: number | null;
  entries: UnifiedEnergyLedgerEntryV1[];
  selectedDoseKeys: string[];
  quality: UnifiedAvailabilityV1;
};

export type UnifiedQualityV1 = {
  availability: UnifiedAvailabilityV1;
  gapSeverity: UnifiedGapSeverityV1;
  sourceQuality: UnifiedSourceQualityV1;
  missingFields: string[];
  reasons: string[];
  modeledGapBridge: boolean;
};

export type UnifiedUncertaintyV1 = {
  state: Record<string, UnifiedNumericEnvelopeV1 | null>;
  transition: Record<string, UnifiedNumericEnvelopeV1 | null>;
  observation: { scaleKg: UnifiedNumericEnvelopeV1 | null; bodyComposition: string[] };
  model: string[];
  gap: string[];
  dependencyNotes: string[];
};

export type UnifiedReconciliationV1 = {
  anchorDate: string | null;
  anchorWeightKg: number | null;
  observedWeightKg: number | null;
  observedChangeKg: number | null;
  modeledChangeSinceAnchorKg: UnifiedNumericEnvelopeV1 | null;
  unexplainedResidualKg: UnifiedNumericEnvelopeV1 | null;
  handling: "no-anchor" | "comparison-only" | "anchor-and-comparison";
  reason: string | null;
};

export type UnifiedSourceLineageV1 = {
  dailyHealthData: { id: number; updatedAt: string } | null;
  productionDailyState: { id: number; updatedAt: string; modelVersion: string } | null;
  workouts: Array<{ id: number; updatedAt: string; sourceFingerprint: string | null }>;
  diarySessions: Array<{ id: number; revision: number; updatedAt: string }>;
  childModelRevisions: Record<string, string>;
  sourceDate: string;
};

export type UnifiedDiagnosticsV1 = {
  componentComparisons: Record<string, unknown>;
  rejectedConversions: string[];
  notes: string[];
};

export type UnifiedExperimentalPhysiologyStateV1 = {
  slowTissue: UnifiedSlowTissueStateV1;
  glycogen: UnifiedGlycogenStateV1;
  glycogenWater: UnifiedGlycogenWaterStateV1;
  transientWater: UnifiedTransientWaterStateV1;
  relativeMuscle: UnifiedRelativeMuscleDiagnosticV1;
  ecfContext: UnifiedEcfContextV1;
};

export type UnifiedDailyDeltasV1 = {
  slowTissueKg: { fat: number | null; slowNonFat: number | null };
  glycogenKg: UnifiedNumericEnvelopeV1 | null;
  glycogenWaterKg: UnifiedNumericEnvelopeV1 | null;
  transientWaterKg: UnifiedNumericEnvelopeV1 | null;
  modeledChangeSinceAnchorKg: UnifiedNumericEnvelopeV1 | null;
};

export type UnifiedExperimentalPhysiologyDayResultV1 = {
  contractVersion: typeof UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V1_REVISION;
  profileId: number;
  date: string;
  priorStateFingerprint: string;
  sourceFingerprint: string;
  state: UnifiedExperimentalPhysiologyStateV1;
  deltas: UnifiedDailyDeltasV1;
  energyLedger: UnifiedEnergyLedgerV1;
  quality: UnifiedQualityV1;
  uncertainty: UnifiedUncertaintyV1;
  reconciliation: UnifiedReconciliationV1;
  sourceLineage: UnifiedSourceLineageV1;
  diagnostics: UnifiedDiagnosticsV1;
  resultFingerprint: string;
};

export function emptyUnifiedNumericEnvelopeV1(): UnifiedNumericEnvelopeV1 {
  return { point: null, lower: null, upper: null, representation: "engineering-range" };
}

export function assertFiniteUnifiedNumbers(value: unknown, path = "unified"): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${path} contains a non-finite number`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteUnifiedNumbers(item, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "skeletalMuscleKg") throw new Error("Unified V1 cannot persist absolute skeletalMuscleKg");
      assertFiniteUnifiedNumbers(item, `${path}.${key}`);
    }
  }
}

export function serializeUnifiedExperimentalPhysiologyV1(
  result: UnifiedExperimentalPhysiologyDayResultV1,
): UnifiedExperimentalPhysiologyDayResultV1 {
  assertFiniteUnifiedNumbers(result);
  return structuredClone(result);
}

export function unifiedResultFingerprint(result: Omit<UnifiedExperimentalPhysiologyDayResultV1, "resultFingerprint">): string {
  return stableSha256(result);
}
