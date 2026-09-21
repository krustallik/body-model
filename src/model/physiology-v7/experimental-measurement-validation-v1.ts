import {
  estimateExperimentalGlycogenAssociatedWaterV1,
} from "./experimental-glycogen-associated-water-v1";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Measurement Validation V1 (shadow only).
 *
 * Classifies water observations and longitudinal measurement protocol
 * consistency. It never writes physiology state, turns an observation into a
 * compartment, or uses a scale/model residual as a composition sink.
 */
export const EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_REVISION =
  "experimental-measurement-validation-v1" as const;
export const EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PROVENANCE =
  "experimental-heuristic" as const;

export const EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PRIORS = {
  minimumCompatibleSeriesObservations: 3,
  compatibleSeriesUncertaintyWidthMultiplier: 0.85,
  mixedOrNonstandardUncertaintyWidthMultiplier: 1.25,
  classification: "engineering-measurement-protocol-consistency-prior" as const,
} as const;

export type WaterObservationKindV1 = "hydration-status" | "total-body-water" | "ecf";
export type WaterObservationTimingV1 = "contemporaneous-with-glycogen-evidence" | "unknown";
export type MeasurementEndpointV1 =
  | "scale-weight"
  | "bia-body-composition"
  | "dxa-body-composition"
  | "local-muscle-measurement";
export type MeasurementRoleV1 =
  | "body-weight-total-mass"
  | "aggregate-lean-context"
  | "local-hypertrophy-proxy";
export type ProtocolConditionV1 = "standardized" | "unknown" | "nonstandard";

export type WaterObservationV1 = {
  kind: WaterObservationKindV1;
  source: string;
  deviceId: string;
  observedAt: string;
  timing: WaterObservationTimingV1;
};

export type LongitudinalMeasurementObservationV1 = {
  id: string;
  observedAt: string;
  endpoint: MeasurementEndpointV1;
  source: string;
  deviceId: string;
  site: string | null;
  hydrationCondition: ProtocolConditionV1;
  acuteExerciseCondition: ProtocolConditionV1;
};

export type ExperimentalWaterObservationValidationResultV1 = {
  contractVersion: typeof EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_REVISION;
  provenance: typeof EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PROVENANCE;
  supportedDomain: "water-observation-attribution-shadow-validation";
  availability: "available" | "unavailable";
  classification: "unresolved" | "compatible-glycogen-context" | "missing-observation";
  observationRole: "hydration-context" | "total-body-water-context" | "ecf-context" | null;
  glycogenWaterDeltaKg: number | null;
  waterObservationAppliedToState: false;
  residualAllocation: "intentionally-rejected";
  reasons: string[];
};

export type ExperimentalMethodConsistencyResultV1 = {
  contractVersion: typeof EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_REVISION;
  provenance: typeof EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PROVENANCE;
  supportedDomain: "longitudinal-measurement-method-consistency-shadow-validation";
  availability: "available" | "unavailable";
  status: "missing-evidence" | "insufficient-compatible-series" | "compatible-same-method-series" | "mixed-or-nonstandard-series";
  uncertaintyWidthMultiplier: number | null;
  /** Raw imported rows may include replayed copies; only unique identities count. */
  inputObservationCount: number;
  duplicateObservationCount: number;
  observationCount: number;
  endpoint: MeasurementEndpointV1 | null;
  source: string | null;
  deviceId: string | null;
  measurementRole: MeasurementRoleV1 | null;
  latentStateApplication: "intentionally-not-applied";
  universalTruthMethod: "intentionally-not-defined";
  rejectedConversions: readonly [
    "bia-or-dxa-to-skeletal-muscle-kg",
    "local-measurement-to-whole-body-skeletal-muscle-kg",
    "scale-residual-allocation",
  ];
  reasons: string[];
};

function identity(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function waterRole(kind: WaterObservationKindV1): ExperimentalWaterObservationValidationResultV1["observationRole"] {
  if (kind === "hydration-status") return "hydration-context";
  if (kind === "total-body-water") return "total-body-water-context";
  return "ecf-context";
}

function measurementRole(endpoint: MeasurementEndpointV1): MeasurementRoleV1 {
  if (endpoint === "scale-weight") return "body-weight-total-mass";
  if (endpoint === "local-muscle-measurement") return "local-hypertrophy-proxy";
  return "aggregate-lean-context";
}

function rejectedConversions(): ExperimentalMethodConsistencyResultV1["rejectedConversions"] {
  return [
    "bia-or-dxa-to-skeletal-muscle-kg",
    "local-measurement-to-whole-body-skeletal-muscle-kg",
    "scale-residual-allocation",
  ] as const;
}

function measurementIdentity(observation: LongitudinalMeasurementObservationV1): string | null {
  const id = identity(observation.id);
  const source = identity(observation.source);
  const device = identity(observation.deviceId);
  if (id === null || source === null || device === null || !Number.isFinite(Date.parse(observation.observedAt))) return null;
  // The immutable measurement id handles normal replays.  The remaining
  // provenance dimensions make independently generated ids for an identical
  // import timestamp conservative too; no unavailable numeric value is used
  // to manufacture agreement.
  return [id, observation.observedAt, observation.endpoint, source, device, observation.site ?? "whole-body"].join("|");
}

/** Hydration, TBW, and ECF observations are context, not glycogenWaterKg. */
export function classifyExperimentalWaterObservationV1(input: {
  observation: WaterObservationV1 | null;
  glycogenDeltaKg: number | null;
}): ExperimentalWaterObservationValidationResultV1 {
  const observation = input.observation;
  if (observation === null) {
    return {
      contractVersion: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_REVISION,
      provenance: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PROVENANCE,
      supportedDomain: "water-observation-attribution-shadow-validation",
      availability: "unavailable",
      classification: "missing-observation",
      observationRole: null,
      glycogenWaterDeltaKg: null,
      waterObservationAppliedToState: false,
      residualAllocation: "intentionally-rejected",
      reasons: ["missing-water-observation-is-not-zero-or-glycogen-water"],
    };
  }
  const source = identity(observation.source);
  const deviceId = identity(observation.deviceId);
  if (source === null || deviceId === null || !Number.isFinite(Date.parse(observation.observedAt))) {
    return {
      contractVersion: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_REVISION,
      provenance: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PROVENANCE,
      supportedDomain: "water-observation-attribution-shadow-validation",
      availability: "unavailable",
      classification: "missing-observation",
      observationRole: waterRole(observation.kind),
      glycogenWaterDeltaKg: null,
      waterObservationAppliedToState: false,
      residualAllocation: "intentionally-rejected",
      reasons: ["water-observation-requires-provenance-and-method-identity"],
    };
  }
  const compatible = observation.kind === "total-body-water"
    && observation.timing === "contemporaneous-with-glycogen-evidence"
    && input.glycogenDeltaKg !== null;
  if (!compatible) {
    return {
      contractVersion: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_REVISION,
      provenance: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PROVENANCE,
      supportedDomain: "water-observation-attribution-shadow-validation",
      availability: "available",
      classification: "unresolved",
      observationRole: waterRole(observation.kind),
      glycogenWaterDeltaKg: null,
      waterObservationAppliedToState: false,
      residualAllocation: "intentionally-rejected",
      reasons: [
        "hydration-total-body-water-and-ecf-observations-are-not-direct-glycogen-water",
        "compatible-glycogen-change-evidence-required-for-associated-water-context",
        "ambiguous-water-observation-remains-unresolved",
        "scale-weight-residual-allocation-intentionally-rejected",
      ],
    };
  }
  const glycogenWater = estimateExperimentalGlycogenAssociatedWaterV1({
    glycogenDeltaKg: input.glycogenDeltaKg,
  });
  return {
    contractVersion: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_REVISION,
    provenance: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PROVENANCE,
    supportedDomain: "water-observation-attribution-shadow-validation",
    availability: "available",
    classification: "compatible-glycogen-context",
    observationRole: "total-body-water-context",
    glycogenWaterDeltaKg: glycogenWater.estimatedGlycogenWaterDeltaKg,
    waterObservationAppliedToState: false,
    residualAllocation: "intentionally-rejected",
    reasons: [
      "glycogen-water-estimate-comes-from-compatible-glycogen-change-not-water-observation-value",
      "total-body-water-is-compatible-context-not-direct-compartment-measurement",
      "no-hydration-or-ecf-observation-overwrites-latent-state",
      "scale-weight-residual-allocation-intentionally-rejected",
    ],
  };
}

/** Method consistency changes uncertainty only; all measurement endpoints retain their role. */
export function evaluateExperimentalMeasurementMethodConsistencyV1(input: {
  observations: readonly LongitudinalMeasurementObservationV1[];
}): ExperimentalMethodConsistencyResultV1 {
  const unique = new Map<string, LongitudinalMeasurementObservationV1>();
  for (const observation of input.observations) {
    const key = measurementIdentity(observation);
    if (key !== null && !unique.has(key)) unique.set(key, observation);
  }
  const valid = [...unique.values()]
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
  const duplicateObservationCount = input.observations.length - valid.length;
  const base = {
    contractVersion: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_REVISION,
    provenance: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PROVENANCE,
    supportedDomain: "longitudinal-measurement-method-consistency-shadow-validation" as const,
    latentStateApplication: "intentionally-not-applied" as const,
    universalTruthMethod: "intentionally-not-defined" as const,
    rejectedConversions: rejectedConversions(),
  };
  if (valid.length === 0) {
    return { ...base, availability: "unavailable", status: "missing-evidence", uncertaintyWidthMultiplier: null,
      inputObservationCount: input.observations.length, duplicateObservationCount,
      observationCount: 0, endpoint: null, source: null, deviceId: null, measurementRole: null,
      reasons: ["missing-or-unidentified-measurements-are-not-zero-uncertainty"] };
  }
  const keys = new Set(valid.map((item) => [item.endpoint, identity(item.source), identity(item.deviceId), item.site ?? "whole-body"].join("|")));
  const standardized = valid.every((item) => item.hydrationCondition === "standardized"
    && item.acuteExerciseCondition === "standardized");
  const first = valid[0]!;
  const compatible = keys.size === 1 && standardized;
  const fixed = { inputObservationCount: input.observations.length, duplicateObservationCount,
    observationCount: valid.length, endpoint: compatible ? first.endpoint : null,
    source: compatible ? identity(first.source) : null, deviceId: compatible ? identity(first.deviceId) : null,
    measurementRole: compatible ? measurementRole(first.endpoint) : null };
  if (!compatible) {
    return { ...base, availability: "available", status: "mixed-or-nonstandard-series",
      uncertaintyWidthMultiplier: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PRIORS.mixedOrNonstandardUncertaintyWidthMultiplier,
      ...fixed, reasons: ["mixed-method-device-site-or-protocol-series-widens-uncertainty", "no-method-is-universal-truth",
        ...(duplicateObservationCount > 0 ? ["duplicate-import-rows-do-not-count-as-independent-measurements"] : [])] };
  }
  if (valid.length < EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PRIORS.minimumCompatibleSeriesObservations) {
    return { ...base, availability: "available", status: "insufficient-compatible-series", uncertaintyWidthMultiplier: 1,
      ...fixed, reasons: ["same-method-series-needs-repeated-compatible-observations-before-narrowing", "no-method-is-universal-truth",
        ...(duplicateObservationCount > 0 ? ["duplicate-import-rows-do-not-count-as-independent-measurements"] : [])] };
  }
  return { ...base, availability: "available", status: "compatible-same-method-series",
    uncertaintyWidthMultiplier: EXPERIMENTAL_MEASUREMENT_VALIDATION_V1_PRIORS.compatibleSeriesUncertaintyWidthMultiplier,
    ...fixed, reasons: ["repeated-standardized-same-method-device-site-series-narrows-experimental-uncertainty", "no-method-is-universal-truth",
      ...(duplicateObservationCount > 0 ? ["duplicate-import-rows-do-not-count-as-independent-measurements"] : [])] };
}

/** Deterministic chronological rebuild; outputs validation only, never state transitions. */
export function rebuildExperimentalMeasurementValidationTrajectoryV1(input: {
  days: readonly { date: string; waterObservation: WaterObservationV1 | null; glycogenDeltaKg: number | null; measurements: readonly LongitudinalMeasurementObservationV1[] }[];
}): Array<{ date: string; water: ExperimentalWaterObservationValidationResultV1; method: ExperimentalMethodConsistencyResultV1 }> {
  const history: LongitudinalMeasurementObservationV1[] = [];
  return input.days.slice().sort((a, b) => a.date.localeCompare(b.date)).map((day) => {
    history.push(...day.measurements);
    return {
      date: day.date,
    water: classifyExperimentalWaterObservationV1({
      observation: day.waterObservation,
      glycogenDeltaKg: day.glycogenDeltaKg,
    }),
      method: evaluateExperimentalMeasurementMethodConsistencyV1({ observations: history }),
    };
  });
}

export function experimentalMeasurementValidationV1Fingerprint(result: unknown): string {
  return stableSha256(result);
}
