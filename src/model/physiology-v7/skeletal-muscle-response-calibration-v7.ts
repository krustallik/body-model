import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Scientific decision gate for any future v7 skeletal-muscle transition.
 * This is an evidence interpretation contract, not a physiology equation.
 */
export const SKELETAL_MUSCLE_RESPONSE_CALIBRATION_V7_VERSION =
  "bodycast-skeletal-muscle-response-calibration-v7-2" as const;

export type SkeletalMuscleResponseLevelV7 =
  | "level-0-source-evidence"
  | "level-1-qualitative-constraints"
  | "level-2-bounded-relative-response"
  | "level-3-quantitative-skeletal-muscle-kg";

export type SkeletalMuscleResponseCalibrationV7 = {
  contractVersion: typeof SKELETAL_MUSCLE_RESPONSE_CALIBRATION_V7_VERSION;
  /** The highest level currently defensible from the approved v7 record. */
  highestSupportedResponseLevel: "level-1-qualitative-constraints";
  quantitativeTransition: {
    availability: "unavailable";
    reason: "no-approved-whole-body-calibration";
    blockers: readonly [
      "no-direct-whole-body-skeletal-muscle-kg-outcome",
      "no-approved-dose-to-kg-calibration",
      "no-approved-protein-or-energy-composition-into-kg",
      "no-calibrated-training-status-or-detraining-transition",
      "v7-state-exposes-lean-tissue-not-skeletal-muscle-kg",
    ];
  };
  /** Population-level directional constraints; no personal score or multiplier. */
  qualitativeConstraints: readonly [
    "qualified-mapped-training-is-stimulus-evidence-not-muscle-kg",
    "missing-protein-is-unknown-not-zero",
    "missing-energy-balance-is-unknown-not-neutral",
    "higher-protein-within-studied-range-does-not-worsen-proxy-adaptation",
    "larger-sustained-deficit-does-not-improve-expected-training-mediated-gain",
    "deficit-does-not-make-recomposition-impossible",
    "maintenance-or-no-surplus-does-not-force-zero-gain",
    "surplus-does-not-create-unbounded-muscle-or-kcal-to-muscle-conversion",
    "deficit-and-surplus-have-no-symmetric-muscle-multiplier",
    "no-universal-set-cutoff-forces-zero-or-negative-expected-adaptation",
  ];
  approvedParameters: readonly [
    "P-A01", "P-A02", "P-A04", "P-B01", "P-C01", "P-C02",
    "P-D01", "P-D02", "P-E01", "P-E02", "P-L02", "P-L03",
  ];
  rejectedConversions: readonly [
    "local-or-ffm-proxy-to-whole-body-skeletal-muscle-kg",
    "acute-mps-to-chronic-skeletal-muscle-kg",
    "sets-times-nutrition-or-energy-multiplier-to-muscle-kg",
    "kcal-surplus-to-muscle-kg",
    "experience-or-retraining-to-muscle-kg-rate",
    "hr-tonnage-frequency-or-rir-to-numeric-muscle-multiplier",
    "universal-set-cutoff-to-zero-or-negative-hypertrophy",
  ];
};

const CALIBRATION: SkeletalMuscleResponseCalibrationV7 = {
  contractVersion: SKELETAL_MUSCLE_RESPONSE_CALIBRATION_V7_VERSION,
  highestSupportedResponseLevel: "level-1-qualitative-constraints",
  quantitativeTransition: {
    availability: "unavailable",
    reason: "no-approved-whole-body-calibration",
    blockers: [
      "no-direct-whole-body-skeletal-muscle-kg-outcome",
      "no-approved-dose-to-kg-calibration",
      "no-approved-protein-or-energy-composition-into-kg",
      "no-calibrated-training-status-or-detraining-transition",
      "v7-state-exposes-lean-tissue-not-skeletal-muscle-kg",
    ],
  },
  qualitativeConstraints: [
    "qualified-mapped-training-is-stimulus-evidence-not-muscle-kg",
    "missing-protein-is-unknown-not-zero",
    "missing-energy-balance-is-unknown-not-neutral",
    "higher-protein-within-studied-range-does-not-worsen-proxy-adaptation",
    "larger-sustained-deficit-does-not-improve-expected-training-mediated-gain",
    "deficit-does-not-make-recomposition-impossible",
    "maintenance-or-no-surplus-does-not-force-zero-gain",
    "surplus-does-not-create-unbounded-muscle-or-kcal-to-muscle-conversion",
    "deficit-and-surplus-have-no-symmetric-muscle-multiplier",
    "no-universal-set-cutoff-forces-zero-or-negative-expected-adaptation",
  ],
  approvedParameters: [
    "P-A01", "P-A02", "P-A04", "P-B01", "P-C01", "P-C02",
    "P-D01", "P-D02", "P-E01", "P-E02", "P-L02", "P-L03",
  ],
  rejectedConversions: [
    "local-or-ffm-proxy-to-whole-body-skeletal-muscle-kg",
    "acute-mps-to-chronic-skeletal-muscle-kg",
    "sets-times-nutrition-or-energy-multiplier-to-muscle-kg",
    "kcal-surplus-to-muscle-kg",
    "experience-or-retraining-to-muscle-kg-rate",
    "hr-tonnage-frequency-or-rir-to-numeric-muscle-multiplier",
    "universal-set-cutoff-to-zero-or-negative-hypertrophy",
  ],
};

/** Returns a fresh immutable-by-convention value for deterministic rebuilds. */
export function buildSkeletalMuscleResponseCalibrationV7(): SkeletalMuscleResponseCalibrationV7 {
  return structuredClone(CALIBRATION);
}

export function skeletalMuscleResponseCalibrationV7Fingerprint(
  calibration: SkeletalMuscleResponseCalibrationV7,
): string {
  return stableSha256(calibration);
}
