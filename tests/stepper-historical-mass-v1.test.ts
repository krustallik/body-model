import { describe, expect, it } from "vitest";
import { resolveStepperHistoricalMassV1, stepperMassCandidateDependsOnReplayV1, STEPPER_HISTORICAL_MASS_POLICY_V1 } from "@/model/activity/stepper-historical-mass-v1";

const workoutAt = new Date("2026-03-29T12:00:00.000Z");
const workoutDate = "2026-03-29";

function obs(sourceId: string, date: string, valueKg: number, timestamp: string | null = null, sourceType: "health-metric-sample" | "daily-health-data" = "health-metric-sample") {
  return { sourceId, date, valueKg, sourceType, timestamp: timestamp === null ? null : new Date(timestamp) } as const;
}

describe("Stepper historical mass policy v1", () => {
  it("selects the nearest observed measurement in the inclusive seven-day window", () => {
    const result = resolveStepperHistoricalMassV1({
      workoutAt, workoutDate, timeZone: "Europe/Bratislava",
      observations: [obs("far", "2026-03-21", 70), obs("boundary", "2026-04-05", 74)],
    });
    expect(result.massKg).toBe(74);
    expect(result.provenance.dayDistance).toBe(7);
    expect(result.provenance.sourceId).toBe("boundary");
  });

  it("prefers the before date for an equal-distance tie", () => {
    const result = resolveStepperHistoricalMassV1({
      workoutAt, workoutDate, timeZone: "Europe/Bratislava",
      observations: [obs("after", "2026-03-30", 74), obs("before", "2026-03-28", 72)],
    });
    expect(result.massKg).toBe(72);
    expect(result.provenance.sourceId).toBe("before");
  });

  it("prefers timestamped evidence over date-only evidence on the same local date", () => {
    const result = resolveStepperHistoricalMassV1({
      workoutAt, workoutDate, timeZone: "Europe/Bratislava",
      observations: [
        obs("daily", workoutDate, 71, null, "daily-health-data"),
        obs("timestamped", workoutDate, 73, "2026-03-29T11:30:00.000Z"),
      ],
    });
    expect(result.massKg).toBe(73);
    expect(result.provenance.sourceType).toBe("health-metric-sample");
  });

  it("uses nearest timestamp, then earlier timestamp, when records normalize to the same date", () => {
    const result = resolveStepperHistoricalMassV1({
      workoutAt, workoutDate, timeZone: "Europe/Bratislava",
      observations: [
        obs("later", workoutDate, 75, "2026-03-29T12:30:00.000Z"),
        obs("near", workoutDate, 73, "2026-03-29T11:30:00.000Z"),
      ],
    });
    expect(result.massKg).toBe(73);
    expect(result.provenance.sourceId).toBe("near");
  });

  it("uses stable source/id order for equivalent date-only records", () => {
    const result = resolveStepperHistoricalMassV1({
      workoutAt, workoutDate, timeZone: "Europe/Bratislava",
      observations: [obs("z", workoutDate, 74, null, "daily-health-data"), obs("a", workoutDate, 72, null, "daily-health-data")],
    });
    expect(result.massKg).toBe(72);
    expect(result.provenance.sourceId).toBe("a");
    expect(result.provenance.policyVersion).toBe(STEPPER_HISTORICAL_MASS_POLICY_V1);
  });

  it("uses the date-specific model estimate only when no observed value is in range", () => {
    const result = resolveStepperHistoricalMassV1({
      workoutAt, workoutDate, timeZone: "Europe/Bratislava",
      observations: [obs("outside", "2026-04-06", 75)],
      modelEstimate: {
        valueKg: 72.5, episodeId: 9, modelVersion: "v7", sourceKind: "predecessor-model",
        sourceId: "daily-model-state:42", sourceDate: "2026-03-28",
        stateUpdatedAt: new Date("2026-03-29T23:00:00Z"), generation: 7,
      },
    });
    expect(result.massKg).toBe(72.5);
    expect(result.provenance.status).toBe("model-estimated");
    expect(result.provenance.normalizedLocalDate).toBe("2026-03-28");
    expect(result.provenance.modelSourceKind).toBe("predecessor-model");
    expect(result.provenance.modelGeneration).toBe(7);
  });

  it("uses episode initial mass on the first model day and records frozen provenance", () => {
    const result = resolveStepperHistoricalMassV1({
      workoutAt, workoutDate, timeZone: "Europe/Bratislava", observations: [],
      modelEstimate: {
        valueKg: 71.5, episodeId: 9, modelVersion: "v7", sourceKind: "episode-initial",
        sourceId: "episode:9:initial-mass", sourceDate: workoutDate,
        stateUpdatedAt: new Date("2026-03-01T00:00:00Z"),
      },
    });
    expect(result.massKg).toBe(71.5);
    expect(result.provenance.modelSourceKind).toBe("episode-initial");
    expect(result.provenance.sourceId).toBe("episode:9:initial-mass");
  });

  it("returns unavailable without observed or valid model mass", () => {
    const result = resolveStepperHistoricalMassV1({ workoutAt, workoutDate, timeZone: "Europe/Bratislava", observations: [] });
    expect(result.massKg).toBeNull();
    expect(result.provenance.status).toBe("unavailable");
  });

  it("refreshes only later model-dependent masses after replay", () => {
    expect(stepperMassCandidateDependsOnReplayV1({
      workoutDate: "2026-03-29", replayFromDate: "2026-03-29", massStatus: "model-estimated",
    })).toBe(false);
    expect(stepperMassCandidateDependsOnReplayV1({
      workoutDate: "2026-03-30", replayFromDate: "2026-03-29", massStatus: "observed",
    })).toBe(false);
    expect(stepperMassCandidateDependsOnReplayV1({
      workoutDate: "2026-03-30", replayFromDate: "2026-03-29", massStatus: "model-estimated",
    })).toBe(true);
    expect(stepperMassCandidateDependsOnReplayV1({
      workoutDate: "2026-03-30", replayFromDate: "2026-03-29", massStatus: "unavailable",
    })).toBe(true);
  });
});
