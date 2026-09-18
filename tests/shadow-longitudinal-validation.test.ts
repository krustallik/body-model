import { describe, expect, it } from "vitest";
import { partitionEnergyBalance } from "@/model/body-composition/partition";
import {
  transitionFatWeightShadowV1,
  type FatWeightShadowStateV1,
} from "@/model/physiology-v7/fat-weight-shadow-v1";
import {
  detectUnsupportedDomainCases,
  evaluateRebuildDeterminism,
  evaluateSmallInputContinuity,
  recommendShadowRollout,
  summarizeFatWeightShadowCoverage,
  summarizeV7ShadowCoverage,
  type FatShadowDaySample,
  type V7ShadowDaySample,
} from "@/modules/model-episodes/shadow-longitudinal-validation";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";

const prior: FatWeightShadowStateV1 = {
  fatMassKg: 18,
  slowNonFatKg: 54,
  availability: "available",
  provenance: "episode-bia-derived-estimate",
  uncertainty: "personal-unavailable",
};

function datesFrom(start: string, count: number): string[] {
  const values: string[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(addCalendarDays(start, index));
  }
  return values;
}

function runFatSeries(input: {
  start: string;
  energy: readonly (number | null)[];
  weights?: readonly (number | null)[];
  bodyFat?: readonly (number | null)[];
  initial?: FatWeightShadowStateV1;
}): FatShadowDaySample[] {
  const days = datesFrom(input.start, input.energy.length);
  let state = input.initial ?? prior;
  return days.map((date, index) => {
    const result = transitionFatWeightShadowV1({
      prior: state,
      energyBalanceKcal: input.energy[index] ?? null,
      observedWeightKg: input.weights?.[index] ?? 80 - index * 0.05,
      observedBodyFatPercent: input.bodyFat?.[index] ?? 20,
    });
    state = result.state;
    return {
      date,
      availability: result.state.availability,
      fatMassKg: result.state.fatMassKg,
      slowNonFatKg: result.state.slowNonFatKg,
      energyBalanceKcal: input.energy[index] ?? null,
      observedWeightKg: input.weights?.[index] ?? 80 - index * 0.05,
      observedBodyFatPercent: input.bodyFat?.[index] ?? 20,
      reasons: result.reasons,
      fingerprint: result.fingerprint,
      observationHandling: result.observation.handling,
    };
  });
}

function v7UnavailableMonth(): V7ShadowDaySample[] {
  return datesFrom("2026-01-01", 42).map((date, index) => ({
    date,
    v7Status: index === 40 ? "stale" : index === 41 ? "missing" : "current",
    executionStatus: "success" as const,
    observedWeightKg: 80,
    reconstructedModelMassKg: null,
    compartmentCounts: { known: 0, carried: 2, unavailable: 5 },
    resultFingerprint: `fp-${date}`,
    comparisonAvailability: "unavailable" as const,
    divergenceKg: null,
    runtimeDurationMs: 12 + (index % 3),
    reasonCodes: ["v7-unavailable-compartments"],
  }));
}

describe("Stage 12 longitudinal shadow validation", () => {
  it("summarizes multi-week v7 current/stale/missing coverage and compartment rates", () => {
    const coverage = summarizeV7ShadowCoverage(v7UnavailableMonth());
    expect(coverage.dayCount).toBe(42);
    expect(coverage.statusCounts.current).toBe(40);
    expect(coverage.statusCounts.stale).toBe(1);
    expect(coverage.statusCounts.missing).toBe(1);
    expect(coverage.compartmentRates.unavailable).toBeGreaterThan(0.5);
    expect(coverage.compartmentRates.carried).toBeGreaterThan(0);
    expect(coverage.legacyDivergence.comparableDayCount).toBe(0);
    expect(coverage.observedVsReconstructed.every((row) => row.status === "unavailable")).toBe(true);
  });

  it("keeps observed vs reconstructed gaps diagnostic without residual allocation", () => {
    const days: V7ShadowDaySample[] = [{
      date: "2026-02-01",
      v7Status: "current",
      executionStatus: "success",
      observedWeightKg: 82,
      reconstructedModelMassKg: 80.5,
      compartmentCounts: { known: 7, carried: 0, unavailable: 0 },
      resultFingerprint: "a",
      comparisonAvailability: "unavailable",
      divergenceKg: null,
      runtimeDurationMs: 8,
      reasonCodes: [],
    }];
    const coverage = summarizeV7ShadowCoverage(days);
    expect(coverage.observedVsReconstructed[0]).toMatchObject({
      status: "finite-gap",
      gapKg: 1.5,
    });
    expect(coverage.observedVsReconstructed[0]!.note).toMatch(/not residual allocation/i);
  });

  it("covers deficit, maintenance, and surplus fat trajectories without discontinuities", () => {
    const energy = [
      ...Array.from({ length: 14 }, () => -400),
      ...Array.from({ length: 14 }, () => 0),
      ...Array.from({ length: 14 }, () => 350),
    ];
    const series = runFatSeries({ start: "2026-03-01", energy });
    const coverage = summarizeFatWeightShadowCoverage(series);
    expect(coverage.energyRegimes.deficitDays).toBe(14);
    expect(coverage.energyRegimes.maintenanceDays).toBe(14);
    expect(coverage.energyRegimes.surplusDays).toBe(14);
    expect(coverage.availabilityRates.available).toBe(1);
    expect(coverage.fatTrajectory.stable).toBe(true);
    expect(coverage.residualAllocationCount).toBe(0);
    expect(coverage.observationOverwriteCount).toBe(0);
    const deficitFat = series[13]!.fatMassKg!;
    const surplusFat = series[41]!.fatMassKg!;
    expect(deficitFat).toBeLessThan(18);
    expect(surplusFat).toBeGreaterThan(deficitFat);
  });

  it("treats gaps and delayed sync as unavailable rather than inventing zero tissue change", () => {
    const series = runFatSeries({
      start: "2026-04-01",
      energy: [-300, null, -300, -300],
    });
    const coverage = summarizeFatWeightShadowCoverage(series);
    expect(series[1]!.availability).toBe("unavailable");
    expect(series[2]!.availability).toBe("unavailable");
    expect(series[3]!.availability).toBe("unavailable");
    expect(coverage.stickyUnavailableViolation).toBe(false);
    expect(coverage.availabilityRates.unavailable).toBe(0.75);
  });

  it("detects historical-edit fingerprint changes and rebuild determinism", () => {
    const baseline = runFatSeries({
      start: "2026-05-01",
      energy: [-200, -200, -200],
    });
    const rebuild = runFatSeries({
      start: "2026-05-01",
      energy: [-200, -200, -200],
    });
    const edited = runFatSeries({
      start: "2026-05-01",
      energy: [-200, -500, -200],
    });
    const determinism = evaluateRebuildDeterminism({
      firstPassFingerprints: baseline.map((day) => day.fingerprint),
      secondPassFingerprints: rebuild.map((day) => day.fingerprint),
      afterHistoricalEditFingerprints: edited.map((day) => day.fingerprint),
    });
    expect(determinism.deterministic).toBe(true);
    expect(determinism.historicalEditDetected).toBe(true);
  });

  it("keeps small energy perturbations continuous under Hall/Forbes partition", () => {
    const baseline = transitionFatWeightShadowV1({
      prior, energyBalanceKcal: -300, observedWeightKg: 80, observedBodyFatPercent: 20,
    });
    const perturbed = transitionFatWeightShadowV1({
      prior, energyBalanceKcal: -275, observedWeightKg: 140, observedBodyFatPercent: 5,
    });
    const expected = partitionEnergyBalance({ fatMassKg: 18, availableEnergyKcal: -275 });
    expect(perturbed.state.fatMassKg).toBeCloseTo(18 + expected.deltaFatMassKg, 10);
    const continuity = evaluateSmallInputContinuity([{
      baselineFatKg: baseline.state.fatMassKg!,
      perturbedFatKg: perturbed.state.fatMassKg!,
      energyPerturbationKcal: 25,
    }]);
    expect(continuity.continuous).toBe(true);
    expect(Math.abs(perturbed.state.fatMassKg! - baseline.state.fatMassKg!)).toBeLessThan(0.05);
  });

  it("never allocates scale residual into fat/slow-non-fat state", () => {
    const result = transitionFatWeightShadowV1({
      prior, energyBalanceKcal: -400, observedWeightKg: 120, observedBodyFatPercent: 8,
    });
    const partition = partitionEnergyBalance({ fatMassKg: 18, availableEnergyKcal: -400 });
    expect(result.state.fatMassKg).toBeCloseTo(18 + partition.deltaFatMassKg, 10);
    expect(result.state.fatMassKg! + result.state.slowNonFatKg!).not.toBe(120);
    expect(result.observation.handling).toBe("noisy-not-state-overwrite");
  });

  it("reports unsupported-domain cases and recommends remain-shadow for current v7/fat reality", () => {
    const v7Days = v7UnavailableMonth();
    const fatDays = runFatSeries({
      start: "2026-06-01",
      energy: [-250, null, ...Array.from({ length: 26 }, () => -100)],
    });
    const v7Coverage = summarizeV7ShadowCoverage(v7Days);
    const fatCoverage = summarizeFatWeightShadowCoverage(fatDays);
    const determinism = evaluateRebuildDeterminism({
      firstPassFingerprints: fatDays.map((day) => day.fingerprint),
      secondPassFingerprints: fatDays.map((day) => day.fingerprint),
    });
    const continuity = evaluateSmallInputContinuity([]);
    const unsupported = detectUnsupportedDomainCases({ v7Days, fatDays });
    const rollout = recommendShadowRollout({
      v7Coverage, fatCoverage, determinism, continuity, unsupportedDomainCases: unsupported,
    });
    expect(unsupported.map((item) => item.code)).toEqual(expect.arrayContaining([
      "v7-unavailable-compartments",
      "legacy-v7-semantics-incomparable",
      "fat-shadow-unavailable",
      "missing-energy-balance",
    ]));
    expect(rollout.recommendation).toBe("remain-shadow");
    expect(rollout.blockers.length).toBeGreaterThan(0);
  });
});
