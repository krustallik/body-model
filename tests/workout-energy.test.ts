import { describe, expect, it } from "vitest";
import { calculateStrengthActivity } from "@/model/activity/strength";
import {
  canonicalizeWorkoutType,
  classifyWorkoutType,
  hasExplicitStrengthWorkouts,
  resolveExplicitWorkoutActivityKcal,
  type ExplicitWorkoutActivityEvent,
} from "@/model/activity/workout-energy";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

const WEIGHT_KG = 76.85;
const RMR = 1_600;

function event(
  override: Partial<ExplicitWorkoutActivityEvent> & Pick<ExplicitWorkoutActivityEvent, "type">,
): ExplicitWorkoutActivityEvent {
  const canonical = canonicalizeWorkoutType(override.type);
  const {
    canonicalType: overrideCanonicalType,
    classification: overrideClassification,
    ...rest
  } = override;
  return {
    startAt: "2026-08-22T15:00:00.000Z",
    endAt: "2026-08-22T16:00:00.000Z",
    durationMinutes: 60,
    activeEnergyKcal: null,
    ...rest,
    type: override.type,
    canonicalType: overrideCanonicalType ?? canonical.canonicalType,
    classification: overrideClassification ?? canonical.classification,
  };
}

describe("canonicalizeWorkoutType / classifyWorkoutType", () => {
  it.each([
    ["Stair Climbing", STAIR_CLIMBING_TYPE, "stair-climbing"],
    ["stair Climbing", STAIR_CLIMBING_TYPE, "stair-climbing"],
    ["STAIR CLIMBING", STAIR_CLIMBING_TYPE, "stair-climbing"],
    ["  Stair Climbing  ", STAIR_CLIMBING_TYPE, "stair-climbing"],
    ["Traditional Strength Training", TRADITIONAL_STRENGTH_TRAINING_TYPE, "traditional-strength-training"],
    ["traditional Strength Training", TRADITIONAL_STRENGTH_TRAINING_TYPE, "traditional-strength-training"],
    [" TRADITIONAL STRENGTH TRAINING ", TRADITIONAL_STRENGTH_TRAINING_TYPE, "traditional-strength-training"],
    ["Running", null, "other"],
  ] as const)("maps raw %j → canonical %j / %s", (raw, canonicalType, classification) => {
    const result = canonicalizeWorkoutType(raw);
    expect(result.rawType).toBe(raw);
    expect(result.canonicalType).toBe(canonicalType);
    expect(result.classification).toBe(classification);
    expect(classifyWorkoutType(raw)).toBe(classification);
  });

  it("preserves raw provenance while classifying mixed-case strength", () => {
    const raw = "traditional Strength Training";
    const eventRow = event({ type: raw, activeEnergyKcal: 562 });
    expect(eventRow.type).toBe(raw);
    expect(eventRow.canonicalType).toBe(TRADITIONAL_STRENGTH_TRAINING_TYPE);
    expect(eventRow.classification).toBe("traditional-strength-training");
  });
});

describe("hasExplicitStrengthWorkouts", () => {
  it("detects traditional strength events only", () => {
    expect(hasExplicitStrengthWorkouts([
      event({ type: STAIR_CLIMBING_TYPE, activeEnergyKcal: 154 }),
    ])).toBe(false);
    expect(hasExplicitStrengthWorkouts([
      event({ type: STAIR_CLIMBING_TYPE, activeEnergyKcal: 154 }),
      event({ type: TRADITIONAL_STRENGTH_TRAINING_TYPE, activeEnergyKcal: 562 }),
    ])).toBe(true);
  });
});

describe("resolveExplicitWorkoutActivityKcal", () => {
  it("uses Garmin active kcal as-is without subtracting RMR", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      weightKg: WEIGHT_KG,
      rmrKcalPerDay: RMR,
      events: [
        event({ type: STAIR_CLIMBING_TYPE, activeEnergyKcal: 154, durationMinutes: 12 }),
        event({ type: STAIR_CLIMBING_TYPE, activeEnergyKcal: 18, durationMinutes: 5 }),
        event({
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          activeEnergyKcal: 562,
          durationMinutes: 75,
        }),
      ],
    });
    expect(result.deviceActiveEnergyKcal).toBe(154 + 18 + 562);
    expect(result.strengthMetFallbackKcal).toBe(0);
    expect(result.workoutActivityKcal).toBe(734);
    expect(result.perEvent.every((item) => item.source === "device-active-kcal")).toBe(true);
  });

  it("falls back to strength MET only when active kcal is missing", () => {
    const fallback = calculateStrengthActivity({
      weightKg: WEIGHT_KG,
      rmrKcalPerDay: RMR,
      durationMinutes: 60,
    })!;
    const result = resolveExplicitWorkoutActivityKcal({
      weightKg: WEIGHT_KG,
      rmrKcalPerDay: RMR,
      events: [
        event({
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          activeEnergyKcal: null,
          durationMinutes: 60,
        }),
        event({
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          activeEnergyKcal: 562,
          durationMinutes: 75,
        }),
      ],
    });
    expect(result.perEvent[0]).toEqual({
      classification: "traditional-strength-training",
      source: "strength-met-fallback",
      kcal: fallback,
    });
    expect(result.perEvent[1]).toEqual({
      classification: "traditional-strength-training",
      source: "device-active-kcal",
      kcal: 562,
    });
    expect(result.workoutActivityKcal).toBeCloseTo(fallback + 562, 12);
    expect(result.strengthMetFallbackKcal).toBeCloseTo(fallback, 12);
  });

  it("contributes 0 for stair climbing without inventing MET", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      weightKg: WEIGHT_KG,
      rmrKcalPerDay: RMR,
      events: [
        event({ type: STAIR_CLIMBING_TYPE, activeEnergyKcal: null, durationMinutes: 12 }),
        event({ type: STAIR_CLIMBING_TYPE, activeEnergyKcal: 0, durationMinutes: 8 }),
      ],
    });
    expect(result.workoutActivityKcal).toBe(0);
    expect(result.strengthMetFallbackKcal).toBe(0);
    expect(result.perEvent.map((item) => item.source)).toEqual(["none", "none"]);
  });

  it("does not invent MET for other workout types without active kcal", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      weightKg: WEIGHT_KG,
      rmrKcalPerDay: RMR,
      events: [event({ type: "Running", activeEnergyKcal: null, durationMinutes: 40 })],
    });
    expect(result).toMatchObject({
      workoutActivityKcal: 0,
      deviceActiveEnergyKcal: 0,
      strengthMetFallbackKcal: 0,
    });
    expect(result.perEvent[0]?.source).toBe("none");
  });

  it("rejects a separate EPOC kcal component without claiming EPOC physiology is zero", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      weightKg: WEIGHT_KG,
      rmrKcalPerDay: RMR,
      events: [event({ type: STAIR_CLIMBING_TYPE, activeEnergyKcal: 154, durationMinutes: 12 })],
    });
    expect(result.workoutActivityKcal).toBe(154);
    expect(result.recoveryEnergy.application).toBe("intentionally-not-applied");
    expect(result.recoveryEnergy.numericComponent).toBe("rejected");
    expect(result.recoveryEnergy.addedKcal).toBeNull();
    expect(result.recoveryEnergy.physiologyClaim).toBe("does-not-assert-epoc-is-physiologically-zero");
    expect(result.recoveryEnergy.researchAuthority).toBe("research-6.1");
  });
});
