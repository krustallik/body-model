import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = { experimentalStepperActiveEnergyShadow: { upsert: vi.fn() } };
  return {
    tx,
    persistResolution: vi.fn(),
    prisma: {
      stepperReconciliationCandidate: { findMany: vi.fn() },
      workout: { findUnique: vi.fn(), findMany: vi.fn() },
      modelEpisode: { findMany: vi.fn() },
      dailyModelState: { findUnique: vi.fn() },
      physiologyV7Lifecycle: { findUnique: vi.fn() },
      healthSyncSnapshot: { findMany: vi.fn() },
      healthActivityInterval: { findMany: vi.fn() },
      heartRateSample: { findMany: vi.fn() },
      healthMetricSample: { findMany: vi.fn() },
      dailyHealthData: { findMany: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/model/activity/active-energy-canonical.repository", () => ({
  persistActiveEnergyCanonicalResolutionV1: mocks.persistResolution,
}));

import {
  recordExperimentalStepperActiveEnergyShadow,
  recordExperimentalStepperActiveEnergyShadowsForMassWindow,
  recordExperimentalStepperActiveEnergyShadowsForWorkouts,
} from "@/modules/profile/experimental-stepper-active-energy-shadow.service";

const workoutStart = new Date("2026-10-02T18:00:00.000Z");
const workoutEnd = new Date("2026-10-02T18:10:00.000Z");
const updatedAt = new Date("2026-10-02T18:11:00.000Z");

function decimal(value: number) {
  return { toNumber: () => value, toString: () => String(value) };
}

function workout(overrides: Record<string, unknown> = {}) {
  return {
    id: 44,
    type: "Stair Climbing",
    startAt: workoutStart,
    endAt: workoutEnd,
    durationMinutes: 10,
    activeEnergyKcal: 360,
    manualActiveEnergyKcal: null,
    manualStepCount: null,
    updatedAt,
    sourceIdentity: "ext:device-workout-44",
    ...overrides,
  };
}

function prepareQueries(input: { mass?: number | null; stepCount?: number | null } = {}) {
  const row = workout();
  mocks.prisma.stepperReconciliationCandidate.findMany.mockResolvedValue([]);
  mocks.prisma.workout.findUnique.mockResolvedValue(row);
  mocks.prisma.workout.findMany.mockResolvedValue([]);
  mocks.prisma.modelEpisode.findMany.mockResolvedValue([]);
  mocks.prisma.dailyModelState.findUnique.mockResolvedValue(null);
  mocks.prisma.physiologyV7Lifecycle.findUnique.mockResolvedValue(null);
  mocks.prisma.healthSyncSnapshot.findMany.mockResolvedValue([]);
  mocks.prisma.healthActivityInterval.findMany.mockResolvedValue(input.stepCount == null ? [] : [{
    id: 19,
    startAt: workoutStart,
    endAt: workoutEnd,
    value: decimal(input.stepCount),
  }]);
  mocks.prisma.heartRateSample.findMany.mockResolvedValue([]);
  mocks.prisma.healthMetricSample.findMany.mockResolvedValue([]);
  mocks.prisma.dailyHealthData.findMany.mockResolvedValue(input.mass == null ? [] : [{
    date: "2026-10-02",
    weightKg: input.mass,
    updatedAt,
  }]);
  mocks.tx.experimentalStepperActiveEnergyShadow.upsert.mockResolvedValue({});
  mocks.persistResolution.mockResolvedValue({ eventId: 3, revision: 1, current: true });
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
}

describe("Stepper active-energy shadow writer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareQueries();
  });

  it("calculates and persists BodyCast mechanical evidence with observed mass before device fallback", async () => {
    prepareQueries({ mass: 75, stepCount: 800 });

    await recordExperimentalStepperActiveEnergyShadow({ workoutId: 44, profileId: 7 });

    expect(mocks.tx.experimentalStepperActiveEnergyShadow.upsert).toHaveBeenCalledOnce();
    const shadowWrite = mocks.tx.experimentalStepperActiveEnergyShadow.upsert.mock.calls[0]![0];
    expect(shadowWrite.where).toEqual({ workoutId: 44 });
    expect(shadowWrite.create.result).toMatchObject({
      availability: "available",
      massReference: expect.objectContaining({
        status: "observed",
        sourceType: "daily-health-data",
        sourceId: "2026-10-02",
        valueKg: 75,
      }),
    });
    expect(shadowWrite.create.result.estimatedActiveKcal).toBeGreaterThan(0);

    const resolution = mocks.persistResolution.mock.calls[0]![1];
    expect(resolution).toMatchObject({
      profileId: 7,
      logicalEventKey: "workout:44",
      eventKind: "stepper",
      modelDate: "2026-10-02",
      candidates: expect.arrayContaining([
        expect.objectContaining({ source: "bodycast-stepper-mechanical", valueKcal: shadowWrite.create.result.estimatedActiveKcal }),
        expect.objectContaining({ source: "device-kcal", valueKcal: 360 }),
      ]),
    });
    expect(resolution.candidates.find((item: { source: string }) => item.source === "bodycast-stepper-mechanical")?.provenance.massReference)
      .toMatchObject({ sourceType: "daily-health-data", sourceId: "2026-10-02", status: "observed" });
    expect(mocks.prisma.healthMetricSample.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ metric: "weight-kg", source: "apple-health-shortcut" }),
    }));
  });

  it("keeps missing body mass unavailable and publishes only the device fallback candidate", async () => {
    prepareQueries({ stepCount: 600 });

    await recordExperimentalStepperActiveEnergyShadow({ workoutId: 44 });

    const persisted = mocks.tx.experimentalStepperActiveEnergyShadow.upsert.mock.calls[0]![0].create.result;
    expect(persisted).toMatchObject({ availability: "unavailable", unavailableReason: "missing-body-mass", estimatedActiveKcal: null });
    const resolution = mocks.persistResolution.mock.calls[0]![1];
    expect(resolution.candidates).toEqual([expect.objectContaining({ source: "device-kcal", valueKcal: 360 })]);
    expect(resolution.candidates.some((item: { source: string }) => item.source === "bodycast-stepper-mechanical")).toBe(false);
  });

  it("uses the workout episode's initial mass when no observed measurement is available", async () => {
    prepareQueries({ stepCount: 800 });
    mocks.prisma.modelEpisode.findMany.mockResolvedValue([{
      id: 12,
      timezone: "Europe/Bratislava",
      modelVersion: "physiology-v7",
      startDate: "2026-10-02",
      latestModeledDate: null,
      initialFilteredWeightKg: 78,
      updatedAt,
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
      active: true,
    }]);

    await recordExperimentalStepperActiveEnergyShadow({ workoutId: 44, profileId: 7 });

    const persisted = mocks.tx.experimentalStepperActiveEnergyShadow.upsert.mock.calls[0]![0].create.result;
    expect(persisted.massReference).toMatchObject({
      status: "model-estimated",
      valueKg: 78,
      modelSourceKind: "episode-initial",
      modelEpisodeId: 12,
      modelVersion: "physiology-v7",
      sourceDate: "2026-10-02",
    });
    expect(persisted.estimatedActiveKcal).toBeGreaterThan(0);
  });

  it("recalculates only workouts within the seven-calendar-day mass window", async () => {
    prepareQueries();
    mocks.prisma.workout.findMany.mockResolvedValueOnce([
      { id: 44, startAt: workoutStart },
      { id: 99, startAt: new Date("2026-10-17T18:00:00.000Z") },
    ]);

    await recordExperimentalStepperActiveEnergyShadowsForMassWindow({ measurementDates: ["2026-10-09"], profileId: 7 });

    expect(mocks.prisma.workout.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.workout.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 44, hiddenFromHistory: false } }));
    expect(mocks.tx.experimentalStepperActiveEnergyShadow.upsert).toHaveBeenCalledOnce();
  });

  it("processes unique workout IDs in deterministic ascending order", async () => {
    prepareQueries();
    mocks.prisma.workout.findUnique.mockResolvedValue(null);

    await recordExperimentalStepperActiveEnergyShadowsForWorkouts({ workoutIds: [52, 44, 52, 8] });

    expect(mocks.prisma.workout.findUnique.mock.calls.map(([query]) => query.where.id)).toEqual([8, 44, 52]);
    expect(mocks.tx.experimentalStepperActiveEnergyShadow.upsert).not.toHaveBeenCalled();
  });

  it("does not create a shadow for a missing or non-stepper workout", async () => {
    mocks.prisma.workout.findUnique.mockResolvedValueOnce(null);
    await recordExperimentalStepperActiveEnergyShadow({ workoutId: 404 });
    expect(mocks.tx.experimentalStepperActiveEnergyShadow.upsert).not.toHaveBeenCalled();

    mocks.prisma.workout.findUnique.mockResolvedValueOnce(workout({ type: "Running" }));
    await recordExperimentalStepperActiveEnergyShadow({ workoutId: 45 });
    expect(mocks.tx.experimentalStepperActiveEnergyShadow.upsert).not.toHaveBeenCalled();
    expect(mocks.persistResolution).not.toHaveBeenCalled();
  });
});
