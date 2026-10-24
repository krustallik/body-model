import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, refreshStrength, refreshStepper, getSession, canonicalizeWorkoutType, persistCanonical } = vi.hoisted(() => ({
  prisma: {
    activeEnergyCanonicalEvent: { findMany: vi.fn() },
    modelEpisode: { findMany: vi.fn() },
    strengthDiarySession: { findMany: vi.fn() },
    dailyModelState: { findUnique: vi.fn() },
    physiologyV7Lifecycle: { findUnique: vi.fn() },
    workout: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  refreshStrength: vi.fn(),
  refreshStepper: vi.fn(),
  getSession: vi.fn(),
  canonicalizeWorkoutType: vi.fn(),
  persistCanonical: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/modules/training/experimental-strength-energy-shadow.service", () => ({
  historicalBodyweightSourceChangeMayAffectSessionV1: vi.fn(),
  recordExperimentalStrengthEnergyShadow: refreshStrength,
  recordExperimentalStrengthEnergyShadowBySessionId: vi.fn(),
}));
vi.mock("@/modules/training/training.repository", () => ({
  TrainingRepository: class {
    getSession = getSession;
  },
}));
vi.mock("@/modules/profile/experimental-stepper-active-energy-shadow.service", () => ({
  recordExperimentalStepperActiveEnergyShadow: refreshStepper,
}));
vi.mock("@/model/activity/workout-energy", () => ({ canonicalizeWorkoutType }));
vi.mock("@/model/activity/active-energy-canonical.repository", async () => {
  const actual = await vi.importActual<typeof import("@/model/activity/active-energy-canonical.repository")>(
    "@/model/activity/active-energy-canonical.repository",
  );
  return { ...actual, persistActiveEnergyCanonicalResolutionV1: persistCanonical };
});
vi.mock("@/modules/model-episodes/episode-time-context-v1", () => ({
  episodeTimeContextForInstantV1: (_episodes: unknown, instant: Date) => ({
    date: instant.toISOString().slice(0, 10),
    timeZone: "UTC",
    episode: { id: 1, startDate: "2026-01-01", timezone: "UTC" },
  }),
}));

import {
  changedResolutionDatesV1,
  refreshCandidatesAfterProductionV1,
  type ActiveEnergyResolutionSnapshotV1,
} from "@/modules/activity/active-energy-materialization";

describe("Active Energy convergence candidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.activeEnergyCanonicalEvent.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $executeRaw: vi.fn().mockResolvedValue(0),
    }));
    prisma.physiologyV7Lifecycle.findUnique.mockResolvedValue({
      invalidationGeneration: 1, productionPublishedGeneration: 1, productionStaleFromDate: null,
    });
    prisma.dailyModelState.findUnique.mockResolvedValue({
      id: 1, date: "2026-01-04", status: "complete", modelVersion: "bodycast-physiology-v7",
      dynamicRmrKcalPerDay: 1_600, filteredWeightKg: 80, endWeightKg: 80,
      updatedAt: new Date("2026-01-04T00:00:00.000Z"),
    });
    prisma.modelEpisode.findMany.mockResolvedValue([{ id: 1, startDate: "2026-01-01", timezone: "UTC", active: true }]);
    prisma.strengthDiarySession.findMany.mockResolvedValue([]);
    prisma.workout.findMany.mockResolvedValue([]);
    canonicalizeWorkoutType.mockReturnValue({ classification: "other" });
    persistCanonical.mockResolvedValue({ eventId: 1, revision: 1, current: true });
    getSession.mockResolvedValue({ id: 42 });
    refreshStrength.mockResolvedValue(undefined);
    refreshStepper.mockResolvedValue(undefined);
  });

  it("invalidates both old and new model dates when a canonical event relocates", () => {
    const before: ActiveEnergyResolutionSnapshotV1[] = [{
      id: 7,
      modelDate: "2026-01-01",
      isStale: false,
      currentResolutionFingerprint: "same-resolution",
      resolutionRevision: 3,
    }];
    const after: ActiveEnergyResolutionSnapshotV1[] = [{
      ...before[0]!,
      modelDate: "2026-01-03",
    }];

    expect(changedResolutionDatesV1(before, after)).toEqual(["2026-01-01", "2026-01-03"]);
  });

  it("rechecks only Strength sessions whose energy-relevant model day changed", async () => {
    prisma.strengthDiarySession.findMany.mockResolvedValue([
      {
        id: 41,
        effectiveAccountingAt: null,
        webStartedAt: null,
        createdAt: new Date("2026-01-02T12:00:00.000Z"),
        matchedWorkout: null,
        currentAccountingSnapshot: { payload: { massReference: { status: "observed" } } },
      },
      {
        id: 42,
        effectiveAccountingAt: null,
        webStartedAt: null,
        createdAt: new Date("2026-01-03T12:00:00.000Z"),
        matchedWorkout: null,
        currentAccountingSnapshot: { payload: { massReference: { status: "observed" } } },
      },
    ]);

    await expect(refreshCandidatesAfterProductionV1(1, "2026-01-03", {
      modelChangedDays: [{ episodeId: 1, date: "2026-01-03", strengthRmrChanged: true, modelMassChanged: true }],
    })).resolves.toEqual([]);

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledWith(42, 1);
    expect(refreshStrength).toHaveBeenCalledWith({ session: { id: 42 }, profileId: 1 });
  });

  it("rechecks matched Strength when its episode's modeled horizon changes", async () => {
    prisma.strengthDiarySession.findMany.mockResolvedValue([{
      id: 44,
      effectiveAccountingAt: null,
      webStartedAt: null,
      createdAt: new Date("2025-12-30T12:00:00.000Z"),
      matchedWorkout: null,
      currentAccountingSnapshot: { payload: { massReference: { status: "observed" } } },
    }]);

    await refreshCandidatesAfterProductionV1(1, "2026-01-03", {
      modelChangedDays: [],
      strengthHorizonChangedEpisodeId: 1,
    });

    expect(getSession).toHaveBeenCalledOnce();
    expect(getSession).toHaveBeenCalledWith(44, 1);
    expect(refreshStrength).toHaveBeenCalledOnce();
  });

  it("does not refresh unchanged unmatched Strength days during exact replay", async () => {
    canonicalizeWorkoutType.mockImplementation((type: string) => ({
      classification: type === "Strength" ? "traditional-strength-training" : "other",
    }));
    prisma.workout.findMany.mockResolvedValue([{
      id: 56,
      type: "Strength",
      startAt: new Date("2026-01-04T12:00:00.000Z"),
      matchedDiarySession: null,
      experimentalStepperActiveEnergyShadow: null,
    }]);
    const onCandidateProcessed = vi.fn();

    await refreshCandidatesAfterProductionV1(1, "2026-01-03", {
      modelChangedDays: [],
      onCandidateProcessed,
    });

    expect(onCandidateProcessed).not.toHaveBeenCalled();
  });

  it("refreshes unmatched Strength when the model mass input for its day changes", async () => {
    canonicalizeWorkoutType.mockImplementation((type: string) => ({
      classification: type === "Strength" ? "traditional-strength-training" : "other",
    }));
    prisma.workout.findMany.mockResolvedValue([{
      id: 56,
      type: "Strength",
      startAt: new Date("2026-01-04T12:00:00.000Z"),
      matchedDiarySession: null,
      experimentalStepperActiveEnergyShadow: null,
    }]);
    prisma.workout.findFirst.mockResolvedValue({
      id: 56, type: "Strength", sourceIdentity: "strength:56",
      startAt: new Date("2026-01-04T12:00:00.000Z"), endAt: new Date("2026-01-04T12:30:00.000Z"),
      durationMinutes: 30, activeEnergyKcal: 100, manualActiveEnergyKcal: null,
      updatedAt: new Date("2026-01-04T13:00:00.000Z"),
    });
    const onCandidateProcessed = vi.fn();

    await refreshCandidatesAfterProductionV1(1, "2026-01-03", {
      modelChangedDays: [{ episodeId: 1, date: "2026-01-04", strengthRmrChanged: false, modelMassChanged: true }],
      onCandidateProcessed,
    });

    expect(persistCanonical).toHaveBeenCalledOnce();
    expect(onCandidateProcessed).toHaveBeenCalledOnce();
  });

  it("keeps historical model-estimated Strength mass dependents in scope", async () => {
    prisma.strengthDiarySession.findMany.mockResolvedValue([{
      id: 43,
      effectiveAccountingAt: null,
      webStartedAt: null,
      createdAt: new Date("2026-01-04T12:00:00.000Z"),
      matchedWorkout: null,
      currentAccountingSnapshot: { payload: { massReference: { status: "unavailable" } } },
    }]);
    const { historicalBodyweightSourceChangeMayAffectSessionV1 } = await import(
      "@/modules/training/experimental-strength-energy-shadow.service"
    );
    vi.mocked(historicalBodyweightSourceChangeMayAffectSessionV1).mockReturnValueOnce(true);

    await refreshCandidatesAfterProductionV1(1, "2026-01-03", {
      modelChangedDays: [{ episodeId: 1, date: "2026-01-03", strengthRmrChanged: true, modelMassChanged: true }],
    });

    expect(refreshStrength).toHaveBeenCalledTimes(1);
  });

  it("refreshes only Steppers whose model mass source day changed", async () => {
    canonicalizeWorkoutType.mockImplementation((type: string) => ({
      classification: type === "Stepper" ? "stair-climbing" : "other",
    }));
    prisma.workout.findMany.mockResolvedValue([
      {
        id: 91, type: "Stepper", startAt: new Date("2026-01-04T12:00:00.000Z"), matchedDiarySession: null,
        experimentalStepperActiveEnergyShadow: { result: { massReference: { status: "model-estimated", modelSourceKind: "predecessor-model" } } },
      },
      {
        id: 92, type: "Stepper", startAt: new Date("2026-01-04T13:00:00.000Z"), matchedDiarySession: null,
        experimentalStepperActiveEnergyShadow: { result: { massReference: { status: "observed" } } },
      },
      {
        id: 93, type: "Stepper", startAt: new Date("2026-01-05T12:00:00.000Z"), matchedDiarySession: null,
        experimentalStepperActiveEnergyShadow: { result: { massReference: { status: "model-estimated", modelSourceKind: "predecessor-model" } } },
      },
    ]);

    await refreshCandidatesAfterProductionV1(1, "2026-01-03", {
      modelChangedDays: [{ episodeId: 1, date: "2026-01-03", strengthRmrChanged: true, modelMassChanged: true }],
    });

    expect(refreshStepper).toHaveBeenCalledTimes(1);
    expect(refreshStepper).toHaveBeenCalledWith({ workoutId: 91, profileId: 1 });
  });

  it("awaits progress after each candidate so a lost worker lease stops the scan", async () => {
    prisma.strengthDiarySession.findMany.mockResolvedValue([{
      id: 43,
      effectiveAccountingAt: null,
      webStartedAt: null,
      createdAt: new Date("2026-01-03T12:00:00.000Z"),
      matchedWorkout: null,
    }]);
    const leaseLost = new Error("lease lost");
    const onCandidateProcessed = vi.fn().mockRejectedValue(leaseLost);

    await expect(refreshCandidatesAfterProductionV1(1, "2026-01-03", { onCandidateProcessed }))
      .rejects.toBe(leaseLost);

    expect(refreshStrength).toHaveBeenCalledOnce();
    expect(onCandidateProcessed).toHaveBeenCalledOnce();
  });
});
