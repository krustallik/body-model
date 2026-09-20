import type { CanonicalExerciseStableKey } from "./canonical-exercise-identity";
import { CANONICAL_EXERCISE_IDENTITIES } from "./canonical-exercise-identity";

/**
 * Versioned ordinary external-load accounting for diary tonnage.
 * Scientific dose does not use these factors.
 */
export const EXTERNAL_LOAD_ACCOUNTING_V1_VERSION =
  "bodycast-external-load-accounting-v1" as const;

export type ExternalLoadAccountingV1 =
  | {
      entryBasis: "per-implement";
      setExecution: "bilateral-simultaneous";
      ordinaryTonnageFactor: 2;
    }
  | {
      entryBasis: "per-side";
      setExecution: "unilateral-both-sides";
      ordinaryTonnageFactor: 2;
    }
  | {
      entryBasis: "total-external-load";
      setExecution: "single-total-load";
      ordinaryTonnageFactor: 1;
    }
  | {
      entryBasis: "not-applicable";
      setExecution: "n/a";
      ordinaryTonnageFactor: null;
    };

type RegistryEntry = {
  stableKey: CanonicalExerciseStableKey;
  accounting: ExternalLoadAccountingV1;
};

const bilateralPerImplement: ExternalLoadAccountingV1 = {
  entryBasis: "per-implement",
  setExecution: "bilateral-simultaneous",
  ordinaryTonnageFactor: 2,
};

const unilateralBothSides: ExternalLoadAccountingV1 = {
  entryBasis: "per-side",
  setExecution: "unilateral-both-sides",
  ordinaryTonnageFactor: 2,
};

const notApplicable: ExternalLoadAccountingV1 = {
  entryBasis: "not-applicable",
  setExecution: "n/a",
  ordinaryTonnageFactor: null,
};

/**
 * Registry keyed ONLY by stableKey. Display names / SERIAL ids must never resolve this.
 */
const REGISTRY_ENTRIES: readonly RegistryEntry[] = [
  { stableKey: "incline_dumbbell_press_30deg", accounting: bilateralPerImplement },
  { stableKey: "flat_dumbbell_fly", accounting: bilateralPerImplement },
  { stableKey: "pushup_handles", accounting: notApplicable },
  { stableKey: "seated_dumbbell_press", accounting: bilateralPerImplement },
  { stableKey: "one_arm_lateral_raise", accounting: unilateralBothSides },
  { stableKey: "one_arm_cable_triceps_extension", accounting: unilateralBothSides },
  { stableKey: "bent_over_one_arm_dumbbell_triceps_extension", accounting: unilateralBothSides },
  { stableKey: "one_arm_seated_cable_row", accounting: unilateralBothSides },
  { stableKey: "pull_up", accounting: notApplicable },
  { stableKey: "hyperextension", accounting: notApplicable },
  { stableKey: "one_arm_concentration_curl", accounting: unilateralBothSides },
  { stableKey: "incline_seated_rotating_dumbbell_curl", accounting: bilateralPerImplement },
  { stableKey: "supported_dumbbell_wrist_curl", accounting: unilateralBothSides },
] as const;

export const EXTERNAL_LOAD_ACCOUNTING_REGISTRY_V1: ReadonlyMap<
  CanonicalExerciseStableKey,
  ExternalLoadAccountingV1
> = new Map(
  REGISTRY_ENTRIES.map((entry) => [entry.stableKey, entry.accounting] as const),
);

export function lookupExternalLoadAccountingV1(
  stableKey: string | null | undefined,
): ExternalLoadAccountingV1 | null {
  if (stableKey == null || stableKey === "") return null;
  return EXTERNAL_LOAD_ACCOUNTING_REGISTRY_V1.get(stableKey as CanonicalExerciseStableKey) ?? null;
}

export function ordinaryTonnageFactorForStableKey(
  stableKey: string | null | undefined,
): number | null {
  const accounting = lookupExternalLoadAccountingV1(stableKey);
  if (!accounting) return null;
  return accounting.ordinaryTonnageFactor;
}

export function approvedExternalLoadAccountingCoverageV1(): {
  expected: number;
  mapped: number;
  missingStableKeys: CanonicalExerciseStableKey[];
} {
  const missingStableKeys = CANONICAL_EXERCISE_IDENTITIES
    .map((exercise) => exercise.stableKey)
    .filter((stableKey) => !EXTERNAL_LOAD_ACCOUNTING_REGISTRY_V1.has(stableKey));
  return {
    expected: CANONICAL_EXERCISE_IDENTITIES.length,
    mapped: EXTERNAL_LOAD_ACCOUNTING_REGISTRY_V1.size,
    missingStableKeys,
  };
}

/** UI weight-entry wording derived from load-accounting semantics (not display names). */
export function externalWeightEntryLabel(
  stableKey: string | null | undefined,
  uk: boolean,
): string {
  const accounting = lookupExternalLoadAccountingV1(stableKey);
  if (accounting?.entryBasis === "per-implement") {
    return uk ? "Вага на гантелю, кг" : "Weight per dumbbell, kg";
  }
  if (accounting?.entryBasis === "per-side") {
    return uk ? "Вага на сторону, кг" : "Weight per side, kg";
  }
  if (accounting?.entryBasis === "total-external-load") {
    return uk ? "Загальна зовнішня вага, кг" : "Total external weight, kg";
  }
  return uk ? "Вага, кг" : "Weight, kg";
}
