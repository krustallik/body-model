/**
 * Stage 12 longitudinal shadow validation.
 * Pure diagnostics over already-computed v7 / FatWeightShadowV1 outputs.
 * Never writes sources, never feeds forecast/TDEE, never invents physiology.
 */

export type V7ShadowStatus = "current" | "stale" | "missing" | "failure";

export type V7ShadowDaySample = {
  date: string;
  v7Status: V7ShadowStatus;
  executionStatus: "success" | "failure";
  observedWeightKg: number | null;
  reconstructedModelMassKg: number | null;
  compartmentCounts: { known: number; carried: number; unavailable: number };
  resultFingerprint: string | null;
  /** Legacy vs v7 numeric comparison is unavailable until semantics match. */
  comparisonAvailability: "unavailable" | "comparable";
  divergenceKg: number | null;
  runtimeDurationMs: number | null;
  reasonCodes: string[];
};

export type FatShadowDaySample = {
  date: string;
  availability: "available" | "unavailable";
  fatMassKg: number | null;
  slowNonFatKg: number | null;
  energyBalanceKcal: number | null;
  observedWeightKg: number | null;
  observedBodyFatPercent: number | null;
  reasons: string[];
  fingerprint: string;
  observationHandling: "noisy-not-state-overwrite" | string;
};

export type EnergyRegime = "deficit" | "maintenance" | "surplus" | "unknown";

const MAINTENANCE_BAND_KCAL = 150;
const SMALL_ENERGY_PERTURBATION_KCAL = 25;
const FAT_DISCONTINUITY_KG = 0.75;
const LARGE_OBS_RECON_GAP_KG = 5;

export function classifyEnergyRegime(energyBalanceKcal: number | null): EnergyRegime {
  if (energyBalanceKcal === null || !Number.isFinite(energyBalanceKcal)) return "unknown";
  if (energyBalanceKcal < -MAINTENANCE_BAND_KCAL) return "deficit";
  if (energyBalanceKcal > MAINTENANCE_BAND_KCAL) return "surplus";
  return "maintenance";
}

export function summarizeV7ShadowCoverage(days: readonly V7ShadowDaySample[]) {
  const total = days.length;
  const byStatus = {
    current: days.filter((day) => day.v7Status === "current").length,
    stale: days.filter((day) => day.v7Status === "stale").length,
    missing: days.filter((day) => day.v7Status === "missing").length,
    failure: days.filter((day) => day.v7Status === "failure").length,
  };
  const executionFailures = days.filter((day) => day.executionStatus === "failure").length;
  const known = days.reduce((sum, day) => sum + day.compartmentCounts.known, 0);
  const carried = days.reduce((sum, day) => sum + day.compartmentCounts.carried, 0);
  const unavailable = days.reduce((sum, day) => sum + day.compartmentCounts.unavailable, 0);
  const compartmentTotal = known + carried + unavailable;
  const observedVsReconstructed = days.map((day) => {
    if (day.observedWeightKg === null || day.reconstructedModelMassKg === null) {
      return {
        date: day.date,
        status: "unavailable" as const,
        gapKg: null,
        note: "Reconstruction requires all compartments numeric; missing ≠ 0.",
      };
    }
    const gapKg = day.observedWeightKg - day.reconstructedModelMassKg;
    return {
      date: day.date,
      status: Math.abs(gapKg) >= LARGE_OBS_RECON_GAP_KG ? "large-gap" as const : "finite-gap" as const,
      gapKg,
      note: "Scale weight is noisy observation; gap is diagnostic only, not residual allocation.",
    };
  });
  const comparableDivergenceDays = days.filter((day) => day.comparisonAvailability === "comparable");
  const runtimes = days
    .map((day) => day.runtimeDurationMs)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    dayCount: total,
    coverageRates: {
      current: rate(byStatus.current, total),
      stale: rate(byStatus.stale, total),
      missing: rate(byStatus.missing, total),
      failure: rate(byStatus.failure, total),
      executionFailure: rate(executionFailures, total),
    },
    statusCounts: byStatus,
    compartmentRates: {
      known: rate(known, compartmentTotal),
      carried: rate(carried, compartmentTotal),
      unavailable: rate(unavailable, compartmentTotal),
    },
    compartmentCounts: { known, carried, unavailable },
    observedVsReconstructed,
    legacyDivergence: {
      comparableDayCount: comparableDivergenceDays.length,
      policy: "legacy-and-v7-output-semantics-not-compatible",
      note: "Numeric divergence is withheld until lean/fat/glycogen roles are comparable.",
    },
    runtime: {
      sampleCount: runtimes.length,
      maxMs: runtimes.length === 0 ? null : Math.max(...runtimes),
      meanMs: runtimes.length === 0
        ? null
        : runtimes.reduce((sum, value) => sum + value, 0) / runtimes.length,
    },
  };
}

export function summarizeFatWeightShadowCoverage(days: readonly FatShadowDaySample[]) {
  const total = days.length;
  const available = days.filter((day) => day.availability === "available").length;
  const unavailable = total - available;
  const stickyUnavailable = days.some((day, index) => {
    if (index === 0) return false;
    return days[index - 1]!.availability === "unavailable" && day.availability === "available";
  });
  const residualAllocationAttempts = days.filter((day) => {
    if (day.fatMassKg === null || day.slowNonFatKg === null || day.observedWeightKg === null) {
      return false;
    }
    const reconstructed = day.fatMassKg + day.slowNonFatKg;
    return Math.abs(reconstructed - day.observedWeightKg) < 1e-9
      && day.observationHandling !== "noisy-not-state-overwrite";
  });
  const observationOverwrite = days.filter((day) => day.observationHandling !== "noisy-not-state-overwrite");
  const regimes = days.map((day) => ({
    date: day.date,
    regime: classifyEnergyRegime(day.energyBalanceKcal),
    energyBalanceKcal: day.energyBalanceKcal,
  }));
  const fatSeries = days
    .map((day) => day.fatMassKg)
    .filter((value): value is number => value !== null);
  const maxAbsStep = maxAdjacentAbsDelta(fatSeries);
  return {
    dayCount: total,
    availabilityRates: {
      available: rate(available, total),
      unavailable: rate(unavailable, total),
    },
    availabilityCounts: { available, unavailable },
    stickyUnavailableViolation: stickyUnavailable,
    residualAllocationCount: residualAllocationAttempts.length,
    observationOverwriteCount: observationOverwrite.length,
    energyRegimes: summarizeRegimes(regimes.map((row) => row.regime)),
    regimeSeries: regimes,
    fatTrajectory: {
      availablePointCount: fatSeries.length,
      maxAbsDayStepKg: maxAbsStep,
      stable: maxAbsStep === null || maxAbsStep < FAT_DISCONTINUITY_KG,
      discontinuityThresholdKg: FAT_DISCONTINUITY_KG,
    },
  };
}

/** Rebuild determinism: identical input fingerprints must match; edits must change fingerprints. */
export function evaluateRebuildDeterminism(input: {
  firstPassFingerprints: readonly (string | null)[];
  secondPassFingerprints: readonly (string | null)[];
  afterHistoricalEditFingerprints?: readonly (string | null)[];
}) {
  const sameLength = input.firstPassFingerprints.length === input.secondPassFingerprints.length;
  const identical = sameLength && input.firstPassFingerprints.every(
    (value, index) => value !== null && value === input.secondPassFingerprints[index],
  );
  const editChanged = input.afterHistoricalEditFingerprints === undefined
    ? null
    : input.afterHistoricalEditFingerprints.some((value, index) => value !== input.firstPassFingerprints[index]);
  return {
    deterministic: identical,
    historicalEditDetected: editChanged,
    note: "Determinism is fingerprint equality only; it does not certify scientific accuracy.",
  };
}

/**
 * Small energy perturbations must not create discontinuous fat jumps beyond the
 * partition response scale. Uses local closed-form Hall/Forbes deltas only.
 */
export function evaluateSmallInputContinuity(samples: readonly {
  baselineFatKg: number;
  perturbedFatKg: number;
  energyPerturbationKcal: number;
}[]) {
  const violations = samples.filter((sample) => {
    const expectedScale = Math.abs(sample.energyPerturbationKcal) / 9_500;
    const jump = Math.abs(sample.perturbedFatKg - sample.baselineFatKg);
    return jump > expectedScale + 0.05;
  });
  return {
    sampleCount: samples.length,
    violationCount: violations.length,
    continuous: violations.length === 0,
    perturbationKcalReference: SMALL_ENERGY_PERTURBATION_KCAL,
  };
}

export function detectUnsupportedDomainCases(input: {
  v7Days: readonly V7ShadowDaySample[];
  fatDays: readonly FatShadowDaySample[];
}) {
  const cases: Array<{ code: string; detail: string }> = [];
  if (input.v7Days.some((day) => day.compartmentCounts.unavailable > 0)) {
    cases.push({
      code: "v7-unavailable-compartments",
      detail: "Skeletal muscle / glycogen / water remain unavailable or carried; not production compartments.",
    });
  }
  if (input.v7Days.every((day) => day.comparisonAvailability === "unavailable")) {
    cases.push({
      code: "legacy-v7-semantics-incomparable",
      detail: "Legacy lean/fat/glycogen roles are not numerically comparable to v7 compartment semantics.",
    });
  }
  if (input.fatDays.some((day) => day.availability === "unavailable")) {
    cases.push({
      code: "fat-shadow-unavailable",
      detail: "FatWeightShadowV1 stays unavailable without defensible init/energy; unavailable ≠ 0.",
    });
  }
  if (input.fatDays.some((day) => day.reasons.includes("missing-energy-balance"))) {
    cases.push({
      code: "missing-energy-balance",
      detail: "Historical gaps / delayed sync without energy balance block fat transitions.",
    });
  }
  return cases;
}

export type ShadowRolloutRecommendation = "remain-shadow" | "controlled-rollout-candidate";

export function recommendShadowRollout(input: {
  v7Coverage: ReturnType<typeof summarizeV7ShadowCoverage>;
  fatCoverage: ReturnType<typeof summarizeFatWeightShadowCoverage>;
  determinism: ReturnType<typeof evaluateRebuildDeterminism>;
  continuity: ReturnType<typeof evaluateSmallInputContinuity>;
  unsupportedDomainCases: ReturnType<typeof detectUnsupportedDomainCases>;
}) {
  const blockers: string[] = [];
  if (input.v7Coverage.coverageRates.current < 0.95) {
    blockers.push("v7 current coverage below 95%");
  }
  if (input.v7Coverage.coverageRates.executionFailure > 0) {
    blockers.push("v7 shadow execution failures present");
  }
  if (input.v7Coverage.compartmentRates.unavailable > 0.5) {
    blockers.push("majority of v7 compartments unavailable");
  }
  if (input.v7Coverage.legacyDivergence.comparableDayCount === 0) {
    blockers.push("legacy↔v7 divergence still semantically unavailable");
  }
  if (input.fatCoverage.availabilityRates.available < 0.9) {
    blockers.push("FatWeightShadowV1 availability below 90%");
  }
  if (input.fatCoverage.stickyUnavailableViolation) {
    blockers.push("fat shadow recovered after unavailable day");
  }
  if (input.fatCoverage.residualAllocationCount > 0) {
    blockers.push("residual allocation into fat/weight detected");
  }
  if (!input.determinism.deterministic) {
    blockers.push("rebuild fingerprints are not deterministic");
  }
  if (!input.continuity.continuous) {
    blockers.push("small input changes caused discontinuous fat jumps");
  }
  if (input.unsupportedDomainCases.length > 0) {
    blockers.push(`${input.unsupportedDomainCases.length} unsupported-domain case class(es)`);
  }
  const recommendation: ShadowRolloutRecommendation = blockers.length === 0
    ? "controlled-rollout-candidate"
    : "remain-shadow";
  return {
    recommendation,
    blockers,
    note: recommendation === "remain-shadow"
      ? "Keep v7 and FatWeightShadowV1 off production forecast/TDEE until blockers clear and a measurement oracle exists."
      : "Candidate for controlled shadow-adjacent rollout only after product review; still not production truth.",
  };
}

function rate(count: number, total: number): number {
  if (total <= 0) return 0;
  return count / total;
}

function maxAdjacentAbsDelta(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  let max = 0;
  for (let index = 1; index < values.length; index += 1) {
    max = Math.max(max, Math.abs(values[index]! - values[index - 1]!));
  }
  return max;
}

function summarizeRegimes(regimes: readonly EnergyRegime[]) {
  return {
    deficitDays: regimes.filter((value) => value === "deficit").length,
    maintenanceDays: regimes.filter((value) => value === "maintenance").length,
    surplusDays: regimes.filter((value) => value === "surplus").length,
    unknownDays: regimes.filter((value) => value === "unknown").length,
  };
}
