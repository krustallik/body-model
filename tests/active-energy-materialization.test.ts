import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, refreshStrength, refreshStepper, canonicalizeWorkoutType } = vi.hoisted(() => ({
  prisma: {
    activeEnergyCanonicalEvent: { findMany: vi.fn() },
    modelEpisode: { findMany: vi.fn() },
    strengthDiarySession: { findMany: vi.fn() },
    workout: { findMany: vi.fn() },
  },
  refreshStrength: vi.fn(),
  refreshStepper: vi.fn(),
  canonicalizeWorkoutType: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/modules/training/experimental-strength-energy-shadow.service", () => ({
  recordExperimentalStrengthEnergyShadowBySessionId: refreshStrength,
}));
vi.mock("@/modules/profile/experimental-stepper-active-energy-shadow.service", () => ({
  recordExperimentalStepperActiveEnergyShadow: refreshStepper,
}));
vi.mock("@/model/activity/workout-energy", () => ({ canonicalizeWorkoutType }));
vi.mock("@/modules/model-episodes/episode-time-context-v1", () => ({
  episodeTimeContextForInstantV1: (_episodes: unknown, instant: Date) => ({ date: instant.toISOString().slice(0, 10) }),
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
    prisma.modelEpisode.findMany.mockResolvedValue([{ startDate: "2026-01-01", timezone: "UTC", active: true }]);
    prisma.strengthDiarySession.findMany.mockResolvedValue([]);
    prisma.workout.findMany.mockResolvedValue([]);
    canonicalizeWorkoutType.mockReturnValue({ classification: "other" });
    refreshStrength.mockResolvedValue({ session: null, publicationBlockToken: null });
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

  it("rechecks completed Strength estimates after a production replay", async () => {
    prisma.strengthDiarySession.findMany.mockResolvedValue([{
      id: 42,
      effectiveAccountingAt: null,
      webStartedAt: null,
      createdAt: new Date("2026-01-03T12:00:00.000Z"),
      matchedWorkout: null,
    }]);

    // An estimate can depend on the production model day, so it must be
    // revalidated even when the last selected canonical source was that estimate.
    await expect(refreshCandidatesAfterProductionV1(1, "2026-01-03")).resolves.toEqual([]);

    expect(refreshStrength).toHaveBeenCalledWith({ sessionId: 42, profileId: 1 });
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
