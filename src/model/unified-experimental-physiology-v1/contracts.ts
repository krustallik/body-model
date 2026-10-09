import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export const UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V1_REVISION =
  "unified-experimental-physiology-state-v1-active-energy-canonical" as const;

export const UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION =
  "unified-experimental-physiology-state-v2-episode-boundary-transient-water-impulse-ledger" as const;

export const UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION =
  "unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics" as const;

export const UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION =
  "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once" as const;

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
  /** V4-only physical authority; relativeDeviationKg remains diagnostic. */
  physicalKg?: number | null;
  physicalAvailability?: "available" | "blocked" | "unavailable";
  physicalProvenance?: "production-daily-model-state" | "episode-initial-state" | "current-production-null" | "unavailable";
  explicitPhysicalZero?: boolean;
  physicalDeltaProvenance?: "production-daily-model-state" | "episode-initial-state" | "unavailable";
};

export type UnifiedGlycogenWaterStateV1 = {
  availability: UnifiedAvailabilityV1;
  deltaKg: UnifiedNumericEnvelopeV1 | null;
  provenance: "experimental-glycogen-associated-water-v1" | "physical-glycogen-water-v4-2p7" | "unavailable";
  /** V4-only canonical absolute water derived from physical glycogen. */
  physicalKg?: number | null;
  physicalProvenance?: "production-daily-model-state" | "episode-initial-state" | "current-production-null" | "unavailable";
};

export type UnifiedTransientWaterStateV1 = {
  availability: UnifiedAvailabilityV1;
  /** Absolute end-of-model-day point and coherent branch levels (kg). */
  levelKg?: UnifiedNumericEnvelopeV1 | null;
  /** Active per-session impulse ledger, including each impulse's own age and horizons. */
  activeImpulses?: unknown[];
  episodeId?: number | null;
  modelDate?: string | null;
  boundaryInstant?: string | null;
  /** Legacy-shaped property retained for payload compatibility; V2 means daily delta only. */
  relativeKg: UnifiedNumericEnvelopeV1 | null;
  provenance: "experimental-transient-exercise-water-v1" | "experimental-transient-exercise-water-v2-impulse-ledger" | "unavailable";
};

export type UnifiedRelativeMuscleDiagnosticV1 = {
  availability: UnifiedAvailabilityV1;
  /** Daily training-response diagnostic, kg per episode model day. */
  dailyTrainingSignalKg: number | null;
  /** Episode-local cumulative diagnostic; not a physical tissue mass. */
  cumulativeDiagnosticKg: number | null;
  supportStatus: "supported" | "degraded" | "outside-supported-domain";
  authoritativeUse: "forbidden";
  reason: string;
  dailySignalProvenance: "experimental-skeletal-muscle-delta-v2" | "unavailable";
  cumulativeProvenance: "experimental-cessation-detraining-v2" | "unavailable";
};

export type UnifiedEcfContextV1 = {
  availability: UnifiedAvailabilityV1;
  deviationKg: number | null;
  provenance: "production-reference" | "unavailable";
};

export type UnifiedEnergyLedgerEntryV1 = {
  kind: "dynamic-rmr" | "tef" | "walking" | "occupational" | "workout" | "stepper"
    | "adaptive-thermogenesis" | "personal-offset" | "garmin-device" | "strength-shadow"
    | "stepper-shadow" | "canonical-active-energy" | "epoc-context";
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
  modelEpisodeId: number;
  modelDate: string;
  boundaryAt: string;
  episodePartitionRevision: string;
  dailyHealthData: { id: number; updatedAt: string } | null;
  productionDailyState: { id: number; updatedAt: string; modelVersion: string } | null;
  workouts: Array<{ id: number; updatedAt: string; sourceFingerprint: string | null }>;
  diarySessions: Array<{ id: number; revision: number; updatedAt: string }>;
  childModelRevisions: Record<string, string>;
  childOutputs?: Array<{ kind: string; id: number; updatedAt: string; sourceFingerprint: string }>;
  transientWaterBoundaries?: Array<{ episodeId: number; modelDate: string; boundaryInstant: string }>;
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
  contractVersion: typeof UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION | typeof UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION;
  profileId: number;
  modelEpisodeId: number;
  date: string;
  boundaryAt: string;
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
