import { describe, expect, it } from "vitest";
import {
  buildWalkingSegments,
  reconstructStairWalkingOverlap,
  type SnapshotPoint,
  type StairWorkoutWindow,
  type WorkIntervalWindow,
} from "@/model/activity/stair-walking-overlap";
import {
  canonicalizeWorkoutType,
  resolveExplicitWorkoutActivityKcal,
} from "@/model/activity/workout-energy";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import type { BodyCompositionState } from "@/model/body-composition/state";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bodyComposition: BodyCompositionState = {
  fatMassKg: 20,
  leanTissueKg: 40,
  glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15,
  extracellularFluidDeviationLiters: 0,
};

const rmrParameters = createDynamicRmrParameters({
  initialRmrKcalPerDay: 1_600,
  initialFatMassKg: 20,
  initialLeanTissueKg: 40,
});

describe("workout activity invariants", () => {
  it("never emits NaN from randomized workout energy resolution", () => {
    const random = mulberry32(42);
    for (let i = 0; i < 200; i += 1) {
      const events = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, index) => {
        const isStrength = random() > 0.4;
        const type = isStrength ? TRADITIONAL_STRENGTH_TRAINING_TYPE : STAIR_CLIMBING_TYPE;
        const hasKcal = random() > 0.35;
        return {
          type,
          canonicalType: canonicalizeWorkoutType(type).canonicalType,
          classification: canonicalizeWorkoutType(type).classification,
          startAt: `2026-08-22T${String(8 + index).padStart(2, "0")}:00:00.000Z`,
          endAt: `2026-08-22T${String(8 + index).padStart(2, "0")}:30:00.000Z`,
          durationMinutes: 10 + Math.floor(random() * 80),
          activeEnergyKcal: hasKcal ? Math.round(random() * 700) : null,
        };
      });
      const resolved = resolveExplicitWorkoutActivityKcal({
        events,
        weightKg: 60 + random() * 40,
        rmrKcalPerDay: 1_400 + random() * 500,
      });
      expect(Number.isFinite(resolved.workoutActivityKcal)).toBe(true);
      expect(Number.isNaN(resolved.workoutActivityKcal)).toBe(false);
      expect(resolved.workoutActivityKcal).toBeGreaterThanOrEqual(0);
    }
  });

  it("never double-claims walking segments across randomized stair windows", () => {
    const random = mulberry32(7);
    for (let trial = 0; trial < 80; trial += 1) {
      let distance = 0;
      const snapshots: SnapshotPoint[] = [];
      for (let index = 0; index < 8; index += 1) {
        distance += random() * 0.4;
        snapshots.push({
          timestamp: new Date(Date.UTC(2026, 7, 22, 6 + index, Math.floor(random() * 50))),
          walkingDistanceKm: distance,
          steps: Math.floor(distance * 1_400),
        });
      }
      snapshots.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
      const segments = buildWalkingSegments(snapshots);
      const stairWorkouts: StairWorkoutWindow[] = Array.from(
        { length: 1 + Math.floor(random() * 3) },
        () => {
          const startIndex = Math.floor(random() * (snapshots.length - 2));
          const startAt = snapshots[startIndex]!.timestamp;
          const endAt = new Date(startAt.getTime() + (5 + Math.floor(random() * 20)) * 60_000);
          return {
            startAt,
            endAt,
            activeEnergyKcal: 20 + Math.floor(random() * 200),
          };
        },
      );
      const workIntervals: WorkIntervalWindow[] = random() > 0.5
        ? [{
          startAt: snapshots[1]!.timestamp,
          endAt: snapshots[Math.min(4, snapshots.length - 1)]!.timestamp,
        }]
        : [];
      const result = reconstructStairWalkingOverlap({
        snapshots,
        stairWorkouts,
        workIntervals,
      });
      expect(new Set(result.claimedSegmentIndexes).size)
        .toBe(result.claimedSegmentIndexes.length);
      for (const claimed of result.claimedSegmentIndexes) {
        expect(segments.some((segment) => segment.index === claimed && segment.valid)).toBe(true);
      }
      expect(result.overlapDistanceKm).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.overlapDistanceKm)).toBe(true);
    }
  });

  it("keeps remaining outside-work walking nonnegative after stair subtraction", () => {
    const random = mulberry32(99);
    for (let trial = 0; trial < 100; trial += 1) {
      const dailyWalking = random() * 8;
      const workWalking = random() * dailyWalking;
      const stairOverlap = random() * 2;
      const remaining = Math.max(0, dailyWalking - workWalking - stairOverlap);
      expect(remaining).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(remaining)).toBe(true);

      const expenditure = calculateDynamicDailyExpenditure({
        bodyComposition,
        rmrParameters,
        macros: { proteinG: 120, carbsG: 180, fatG: 60 },
        outsideWorkWalking: {
          distanceKm: remaining,
          averageSpeedKmh: remaining === 0 ? null : 4 + random() * 2,
        },
        strength: { durationMinutes: 0 },
        workoutActivity: {
          events: [{
            type: STAIR_CLIMBING_TYPE,
            canonicalType: STAIR_CLIMBING_TYPE,
            classification: "stair-climbing",
            startAt: "2026-08-22T10:00:00.000Z",
            endAt: "2026-08-22T10:10:00.000Z",
            durationMinutes: 10,
            activeEnergyKcal: Math.round(random() * 200),
          }],
        },
        occupational: { category: null, durationHours: 0 },
        adaptiveThermogenesisKcalPerDay: 0,
      });
      expect(expenditure.outsideWorkWalkingActivityKcalPerDay).not.toBeNull();
      expect(Number.isFinite(expenditure.outsideWorkWalkingActivityKcalPerDay!)).toBe(true);
      expect(expenditure.outsideWorkWalkingActivityKcalPerDay!).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(expenditure.workoutActivityKcalPerDay!)).toBe(true);
    }
  });
});
