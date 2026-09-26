/**
 * Canonical activity policy v1.
 * Pure contracts for events, energy selection, steps, and distance.
 * Estimator formulas live elsewhere and are not redefined here.
 */

export const ACTIVE_ENERGY_SELECTION_POLICY_V1 = "bodycast-active-energy-selection-v1" as const;
export const DISTANCE_ALLOCATION_POLICY_V1 = "step-weighted-distance-allocation-v1" as const;
export const RECONCILIATION_POLICY_V1 = "stepper-reconciliation-v1" as const;
export const FORECAST_SCENARIO_STRENGTH_MET = "forecast-scenario-strength-met" as const;

export type FiniteNonNegative = number;

export function finiteNonNegative(value: number | null | undefined): FiniteNonNegative | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Object.is(value, -0) ? 0 : value;
}

export type EnergySourceKind =
  | "bodycast-strength-estimate"
  | "bodycast-stepper-mechanical"
  | "garmin-fallback"
  | "manual-kcal"
  | "unavailable";

export type SelectedEnergyV1 = {
  policyVersion: typeof ACTIVE_ENERGY_SELECTION_POLICY_V1;
  selectedKcal: number | null;
  source: EnergySourceKind;
  provisional: boolean;
  fullCoverage: boolean;
};

export function selectStrengthEnergyV1(input: {
  bodyCastKcal: number | null;
  bodyCastFresh: boolean;
  sessionCompleted: boolean;
  garminKcal: number | null;
}): SelectedEnergyV1 {
  const bodyCast = finiteNonNegative(input.bodyCastKcal);
  if (input.sessionCompleted && input.bodyCastFresh && bodyCast !== null) {
    return {
      policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
      selectedKcal: bodyCast,
      source: "bodycast-strength-estimate",
      provisional: false,
      fullCoverage: true,
    };
  }
  const garmin = finiteNonNegative(input.garminKcal);
  if (garmin !== null) {
    return {
      policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
      selectedKcal: garmin,
      source: "garmin-fallback",
      provisional: false,
      fullCoverage: true,
    };
  }
  return {
    policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
    selectedKcal: null,
    source: "unavailable",
    provisional: false,
    fullCoverage: false,
  };
}

export function selectManualStepperEnergyV1(input: {
  manualKcal: number | null;
  manualKcalPresent: boolean;
  mechanicalKcal: number | null;
}): SelectedEnergyV1 {
  if (input.manualKcalPresent) {
    const manual = finiteNonNegative(input.manualKcal);
    if (manual === null) {
      return {
        policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
        selectedKcal: null,
        source: "unavailable",
        provisional: false,
        fullCoverage: false,
      };
    }
    return {
      policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
      selectedKcal: manual,
      source: "manual-kcal",
      provisional: false,
      fullCoverage: true,
    };
  }
  const mechanical = finiteNonNegative(input.mechanicalKcal);
  if (mechanical !== null) {
    return {
      policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
      selectedKcal: mechanical,
      source: "bodycast-stepper-mechanical",
      provisional: false,
      fullCoverage: true,
    };
  }
  return {
    policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
    selectedKcal: null,
    source: "unavailable",
    provisional: false,
    fullCoverage: false,
  };
}

export type EventCountBoundsV1 = {
  sourceRecordCount: number;
  minimumDistinctEventCount: number;
  maximumDistinctEventCount: number;
  confirmedDistinctEventCount: number | null;
  unresolvedRelationshipCount: number;
  energyContributionCount: number;
  /** Legacy integer. Equals the minimum. A lower bound when unresolved. */
  eventCount: number;
  eventCountIsLowerBound: boolean;
};

export function pendingPairCountsV1(): EventCountBoundsV1 {
  return {
    sourceRecordCount: 2,
    minimumDistinctEventCount: 1,
    maximumDistinctEventCount: 2,
    confirmedDistinctEventCount: null,
    unresolvedRelationshipCount: 1,
    energyContributionCount: 1,
    eventCount: 1,
    eventCountIsLowerBound: true,
  };
}

export function displayedDailyStepsV1(input: {
  synchronizedSteps: number | null;
  manualSteps: number;
  superseded: boolean;
  unresolvedOverlap: boolean;
}): {
  displayedSteps: number | null;
  synchronizedKnown: boolean;
  potentialDuplication: boolean;
} {
  const manual = input.superseded ? 0 : input.manualSteps;
  if (!Number.isInteger(manual) || manual < 0) {
    throw new RangeError("manual steps must be a nonnegative integer");
  }
  if (input.synchronizedSteps === null) {
    return {
      displayedSteps: manual > 0 ? manual : null,
      synchronizedKnown: false,
      potentialDuplication: input.unresolvedOverlap && !input.superseded,
    };
  }
  const synced = finiteNonNegative(input.synchronizedSteps);
  if (synced === null || !Number.isInteger(synced)) {
    throw new RangeError("synchronized steps must be a nonnegative integer or null");
  }
  return {
    displayedSteps: synced + manual,
    synchronizedKnown: true,
    potentialDuplication: input.unresolvedOverlap && !input.superseded && manual > 0,
  };
}

export type DistanceIntervalV1 = {
  id: string;
  startMs: number;
  endMs: number;
  distanceKm: number;
};

export type SourceClusterStatus = "accepted" | "source-conflicted";

export type ClassifiedDistanceClusterV1 = {
  status: SourceClusterStatus;
  intervalIds: string[];
  acceptedDistanceKm: number | null;
  rawSumKm: number;
};

function overlaps(left: DistanceIntervalV1, right: DistanceIntervalV1): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

/** Half-open intervals that only touch at a boundary do not overlap. */
export function classifyDistanceIntervalsV1(
  intervals: readonly DistanceIntervalV1[],
): ClassifiedDistanceClusterV1[] {
  const usable = intervals.filter((interval) => {
    const distance = finiteNonNegative(interval.distanceKm);
    return distance !== null && interval.endMs > interval.startMs;
  });
  const parent = usable.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor]!;
    return cursor;
  };
  const unite = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      if (overlaps(usable[i]!, usable[j]!)) unite(i, j);
    }
  }
  const groups = new Map<number, DistanceIntervalV1[]>();
  usable.forEach((interval, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(interval);
    groups.set(root, list);
  });
  return [...groups.values()].map((group) => {
    const rawSumKm = group.reduce((sum, interval) => sum + interval.distanceKm, 0);
    const first = group[0]!;
    const exactDuplicates = group.every((interval) =>
      interval.startMs === first.startMs
      && interval.endMs === first.endMs
      && interval.distanceKm === first.distanceKm);
    const conflict = group.length > 1 && !exactDuplicates;
    return {
      status: conflict ? "source-conflicted" : "accepted",
      intervalIds: group.map((interval) => interval.id),
      acceptedDistanceKm: conflict ? null : first.distanceKm,
      rawSumKm,
    };
  });
}

export type DistanceMethodV1 =
  | "fully-step-supported"
  | "coarse-step-boundary-assumed"
  | "step-reallocation-within-time-budget"
  | "time-weighted-missing-steps"
  | "observed-zero-steps"
  | "source-conflicted";

export type PartialCoverageAllocationV1 = {
  coveredBudgetKm: number;
  uncoveredBudgetKm: number;
  totalKm: number;
  coveredMethod: DistanceMethodV1;
  uncoveredMethod: DistanceMethodV1;
};

/**
 * Time-budget split. Steps may redistribute only the covered budget.
 * They never pull distance out of the uncovered portion.
 */
export function allocatePartialStepCoverageV1(input: {
  durationHours: number;
  coveredHours: number;
  distanceKm: number;
}): PartialCoverageAllocationV1 {
  const distance = finiteNonNegative(input.distanceKm);
  if (distance === null) throw new RangeError("distance must be finite and nonnegative");
  if (!(input.durationHours > 0) || input.coveredHours < 0 || input.coveredHours > input.durationHours) {
    throw new RangeError("coverage hours must lie inside the interval");
  }
  const coveredBudgetKm = distance * (input.coveredHours / input.durationHours);
  const uncoveredBudgetKm = distance - coveredBudgetKm;
  return {
    coveredBudgetKm,
    uncoveredBudgetKm,
    totalKm: coveredBudgetKm + uncoveredBudgetKm,
    coveredMethod: input.coveredHours === input.durationHours
      ? "fully-step-supported"
      : "step-reallocation-within-time-budget",
    uncoveredMethod: "time-weighted-missing-steps",
  };
}

export function splitCrossMidnightDistanceV1(input: {
  startMs: number;
  endMs: number;
  midnightMs: number;
  distanceKm: number;
}): { firstDayKm: number; secondDayKm: number; totalKm: number } {
  const distance = finiteNonNegative(input.distanceKm);
  if (distance === null) throw new RangeError("distance must be finite and nonnegative");
  const duration = input.endMs - input.startMs;
  if (!(duration > 0)) throw new RangeError("interval must have positive duration");
  if (input.midnightMs <= input.startMs || input.midnightMs >= input.endMs) {
    throw new RangeError("midnight must lie strictly inside the interval");
  }
  const firstDayKm = distance * ((input.midnightMs - input.startMs) / duration);
  const secondDayKm = distance - firstDayKm;
  return { firstDayKm, secondDayKm, totalKm: firstDayKm + secondDayKm };
}

export type FourCellDistanceV1 = {
  workWithoutStepperKm: number;
  workWithStepperKm: number;
  outsideWithoutStepperKm: number;
  outsideWithStepperKm: number;
};

export function fourCellTotalKm(cells: FourCellDistanceV1): number {
  return cells.workWithoutStepperKm
    + cells.workWithStepperKm
    + cells.outsideWithoutStepperKm
    + cells.outsideWithStepperKm;
}

export function descriptiveWorkKm(cells: FourCellDistanceV1): number {
  return cells.workWithoutStepperKm + cells.workWithStepperKm;
}

export function walkingEnergyEligibleKm(cells: FourCellDistanceV1): {
  workKm: number;
  outsideKm: number;
} {
  return {
    workKm: cells.workWithoutStepperKm,
    outsideKm: cells.outsideWithoutStepperKm,
  };
}

/** Clock hours removed from occupational energy when stepper already contributes. */
export function occupationalEnergyDurationHours(input: {
  workDurationHours: number;
  stepperOverlapHours: number;
}): number {
  if (input.workDurationHours < 0 || input.stepperOverlapHours < 0) {
    throw new RangeError("durations must be nonnegative");
  }
  return Math.max(0, input.workDurationHours - input.stepperOverlapHours);
}

export type KnownEnergyCoverageV1 = {
  knownSubtotalKcal: number;
  unknownEventCount: number;
  fullCoverage: boolean;
};

export function knownEnergyCoverageV1(
  values: readonly Array<number | null>,
): KnownEnergyCoverageV1 {
  let knownSubtotalKcal = 0;
  let unknownEventCount = 0;
  for (const value of values) {
    if (value === null) {
      unknownEventCount += 1;
      continue;
    }
    const finite = finiteNonNegative(value);
    if (finite === null) throw new RangeError("invalid energy value");
    knownSubtotalKcal += finite;
  }
  return {
    knownSubtotalKcal,
    unknownEventCount,
    fullCoverage: unknownEventCount === 0,
  };
}
