import { describe, expect, it } from "vitest";
import {
  allocatePartialStepCoverageV1,
  classifyDistanceIntervalsV1,
  descriptiveWorkKm,
  displayedDailyStepsV1,
  fourCellTotalKm,
  knownEnergyCoverageV1,
  occupationalEnergyDurationHours,
  pendingPairCountsV1,
  selectManualStepperEnergyV1,
  selectStrengthEnergyV1,
  splitCrossMidnightDistanceV1,
  walkingEnergyEligibleKm,
} from "@/model/activity/canonical-activity-policy-v1";

describe("canonical activity policy v1", () => {
  it("keeps a pending pair at a minimum of one workout", () => {
    const counts = pendingPairCountsV1();
    expect(counts.minimumDistinctEventCount).toBe(1);
    expect(counts.maximumDistinctEventCount).toBe(2);
    expect(counts.eventCount).toBe(1);
    expect(counts.eventCountIsLowerBound).toBe(true);
    expect(counts.energyContributionCount).toBe(1);
  });

  it("adds manual steps during pending and marks possible duplication", () => {
    const steps = displayedDailyStepsV1({
      synchronizedSteps: 8000,
      manualSteps: 2000,
      superseded: false,
      unresolvedOverlap: true,
    });
    expect(steps.displayedSteps).toBe(10000);
    expect(steps.potentialDuplication).toBe(true);
  });

  it("drops manual steps only after supersession", () => {
    const steps = displayedDailyStepsV1({
      synchronizedSteps: 8000,
      manualSteps: 2000,
      superseded: true,
      unresolvedOverlap: false,
    });
    expect(steps.displayedSteps).toBe(8000);
    expect(steps.potentialDuplication).toBe(false);
  });

  it("does not publish strength BodyCast energy before completion", () => {
    const selected = selectStrengthEnergyV1({
      bodyCastKcal: 320,
      bodyCastFresh: true,
      sessionCompleted: false,
      garminKcal: 280,
    });
    expect(selected.source).toBe("garmin-fallback");
    expect(selected.selectedKcal).toBe(280);
  });

  it("prefers a fresh completed BodyCast strength estimate over Garmin", () => {
    const selected = selectStrengthEnergyV1({
      bodyCastKcal: 320,
      bodyCastFresh: true,
      sessionCompleted: true,
      garminKcal: 280,
    });
    expect(selected.source).toBe("bodycast-strength-estimate");
    expect(selected.selectedKcal).toBe(320);
  });

  it("keeps entered manual kcal and does not require a mechanical value", () => {
    const selected = selectManualStepperEnergyV1({
      manualKcal: 180,
      manualKcalPresent: true,
      mechanicalKcal: 400,
    });
    expect(selected.source).toBe("bodycast-stepper-mechanical");
    expect(selected.selectedKcal).toBe(400);
  });

  it("uses manual kcal before device only when the BodyCast estimate is unavailable", async () => {
    const { resolveEventEnergyV1 } = await import("@/model/activity/canonical-activity-policy-v1");
    const selected = resolveEventEnergyV1({
      classification: "stair-climbing", activeEnergyKcal: 260,
      manualActiveKcal: 180, manualActiveKcalPresent: true,
      mechanicalStepperKcal: null,
    });
    expect(selected.source).toBe("manual-kcal");
    expect(selected.selectedKcal).toBe(180);
  });

  it("uses the Strength MET fallback before manual and device values", async () => {
    const { selectStrengthEnergyV1 } = await import("@/model/activity/canonical-activity-policy-v1");
    const selected = selectStrengthEnergyV1({
      bodyCastKcal: null, bodyCastFresh: false, sessionCompleted: true,
      bodyCastMetKcal: 210, manualKcal: 180, manualKcalPresent: true, garminKcal: 260,
    });
    expect(selected.source).toBe("bodycast-strength-met-fallback");
    expect(selected.selectedKcal).toBe(210);
  });

  it("treats 200 plus unavailable as a known subtotal, not full coverage", () => {
    const coverage = knownEnergyCoverageV1([200, null]);
    expect(coverage.knownSubtotalKcal).toBe(200);
    expect(coverage.unknownEventCount).toBe(1);
    expect(coverage.fullCoverage).toBe(false);
  });

  it("keeps a valid zero distinct from unavailable", () => {
    const coverage = knownEnergyCoverageV1([0]);
    expect(coverage.knownSubtotalKcal).toBe(0);
    expect(coverage.unknownEventCount).toBe(0);
    expect(coverage.fullCoverage).toBe(true);
  });

  it("refuses a unique accepted distance for nested overlapping intervals", () => {
    const clusters = classifyDistanceIntervalsV1([
      { id: "wide", startMs: 0, endMs: 10 * 3_600_000, distanceKm: 10 },
      { id: "nested", startMs: 4 * 3_600_000, endMs: 6 * 3_600_000, distanceKm: 2 },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.status).toBe("source-conflicted");
    expect(clusters[0]?.acceptedDistanceKm).toBeNull();
    expect(clusters[0]?.rawSumKm).toBe(12);
  });

  it("counts an exact duplicate interval once", () => {
    const clusters = classifyDistanceIntervalsV1([
      { id: "a", startMs: 0, endMs: 3_600_000, distanceKm: 1 },
      { id: "b", startMs: 0, endMs: 3_600_000, distanceKm: 1 },
    ]);
    expect(clusters[0]?.status).toBe("accepted");
    expect(clusters[0]?.acceptedDistanceKm).toBe(1);
    expect(clusters[0]?.rawSumKm).toBe(2);
  });

  it("does not treat boundary-touching intervals as overlap", () => {
    const clusters = classifyDistanceIntervalsV1([
      { id: "a", startMs: 0, endMs: 3_600_000, distanceKm: 1 },
      { id: "b", startMs: 3_600_000, endMs: 7_200_000, distanceKm: 2 },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((cluster) => cluster.status === "accepted")).toBe(true);
  });

  it("assigns 1 km and 4 km for a 5 km interval with two covered hours", () => {
    const allocation = allocatePartialStepCoverageV1({
      durationHours: 10,
      coveredHours: 2,
      distanceKm: 5,
    });
    expect(allocation.coveredBudgetKm).toBeCloseTo(1);
    expect(allocation.uncoveredBudgetKm).toBeCloseTo(4);
    expect(allocation.totalKm).toBeCloseTo(5);
    expect(allocation.coveredMethod).toBe("step-reallocation-within-time-budget");
  });

  it("splits 4 km across midnight as 30/90 and 60/90", () => {
    const start = Date.parse("2026-09-23T21:30:00.000Z");
    const end = Date.parse("2026-09-23T23:00:00.000Z");
    const midnight = Date.parse("2026-09-23T22:00:00.000Z");
    const split = splitCrossMidnightDistanceV1({
      startMs: start,
      endMs: end,
      midnightMs: midnight,
      distanceKm: 4,
    });
    expect(split.firstDayKm).toBeCloseTo(4 * 30 / 90);
    expect(split.secondDayKm).toBeCloseTo(4 * 60 / 90);
    expect(split.totalKm).toBeCloseTo(4);
  });

  it("keeps descriptive work kilometers while walking energy excludes stepper", () => {
    const cells = {
      workWithoutStepperKm: 3,
      workWithStepperKm: 1,
      outsideWithoutStepperKm: 2,
      outsideWithStepperKm: 0,
    };
    expect(fourCellTotalKm(cells)).toBe(6);
    expect(descriptiveWorkKm(cells)).toBe(4);
    expect(walkingEnergyEligibleKm(cells)).toEqual({ workKm: 3, outsideKm: 2 });
    expect(occupationalEnergyDurationHours({
      workDurationHours: 8,
      stepperOverlapHours: 0.5,
    })).toBe(7.5);
  });
});
