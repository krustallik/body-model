/** Frozen Stage 00 contracts consumed by later analytics work. */
export const TRAINING_ANALYTICS_CONTRACT_VERSION = "bodycast-training-analytics-contract-v1" as const;
export const LOAD_ACCOUNTING_CONTRACT_VERSION = "bodycast-load-accounting-contract-v1" as const;
export const RIR_INTERPRETATION_CONTRACT_VERSION = "bodycast-rir-interpretation-v1" as const;

/**
 * Historical entry semantics approved for every existing production set.
 * This describes units and entry basis only; Stage 02 owns calculation code.
 */
export const HISTORICAL_LOAD_ENTRY_CONTRACT_V1 = {
  externalWeight: {
    recordedBasis: "per-hand",
    repetitionsBasis: "per-hand",
    bilateralVolumeMultiplier: 2,
    unit: "kg-repetitions",
  },
  hyperextension: {
    recordedBasis: "full-recorded-weight",
    repetitionsBasis: "set-repetitions",
    volumeMultiplier: 1,
    unit: "kg-repetitions",
  },
  resistanceBand: {
    recordedBasis: "nominal-resistance-per-hand",
    repetitionsBasis: "per-hand",
    bilateralVolumeMultiplier: 2,
    unit: "nominal-kg-repetitions",
  },
  bodyweight: {
    unit: "sets-and-repetitions",
    separateFromExternalWeight: true,
  },
} as const;

export type RirBucketV1 = "0-1" | "2-3" | "4+" | "unknown";

/** Descriptive grouping of a raw self-report; it is not a hypertrophy score. */
export function rirBucketV1(rir: number | null | undefined): RirBucketV1 {
  if (rir == null || !Number.isInteger(rir) || rir < 0 || rir > 10) return "unknown";
  if (rir <= 1) return "0-1";
  if (rir <= 3) return "2-3";
  return "4+";
}
