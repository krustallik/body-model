import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  afterHealthSyncMatch,
  healthSyncRepository,
  rebuildAuthoritativeRelativeMuscleTrajectory,
  recordExperimentalStepperActiveEnergyShadowsForLocalDate,
  recordExperimentalStepperGlycogenDemandShadowsForLocalDate,
  recordExperimentalGlycogenStateShadow,
  recordExperimentalSkeletalMuscleDeltaShadow,
  recordExperimentalCessationDetrainingShadow,
  recordExperimentalFfmRetentionShadow,
  recordExperimentalLocalHypertrophyResponseShadow,
} = vi.hoisted(() => {
  const healthSyncRepository = {
    syncDay: vi.fn(),
    pruneOlderThan: vi.fn().mockResolvedValue({ deletedDays: 0, deletedSnapshots: 0 }),
  };
  return {
    afterHealthSyncMatch: vi.fn().mockResolvedValue(undefined),
    healthSyncRepository,
    rebuildAuthoritativeRelativeMuscleTrajectory: vi.fn().mockResolvedValue(undefined),
    recordExperimentalStepperActiveEnergyShadowsForLocalDate: vi.fn().mockResolvedValue(undefined),
    recordExperimentalStepperGlycogenDemandShadowsForLocalDate: vi.fn().mockResolvedValue(undefined),
    recordExperimentalGlycogenStateShadow: vi.fn().mockResolvedValue(undefined),
    recordExperimentalSkeletalMuscleDeltaShadow: vi.fn().mockResolvedValue(undefined),
    recordExperimentalCessationDetrainingShadow: vi.fn().mockResolvedValue(undefined),
    recordExperimentalFfmRetentionShadow: vi.fn().mockResolvedValue(undefined),
    recordExperimentalLocalHypertrophyResponseShadow: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/modules/training/training.service", () => ({
  trainingService: { afterHealthSyncMatch },
}));
vi.mock("@/modules/health/health.repository", () => ({ healthSyncRepository }));
vi.mock("@/modules/profile/experimental-stepper-active-energy-shadow.service", () => ({
  recordExperimentalStepperActiveEnergyShadowsForLocalDate,
}));
vi.mock("@/modules/profile/experimental-stepper-glycogen-demand-shadow.service", () => ({
  recordExperimentalStepperGlycogenDemandShadowsForLocalDate,
}));
vi.mock("@/modules/model-episodes/experimental-glycogen-state-shadow.service", () => ({
  recordExperimentalGlycogenStateShadow,
}));
vi.mock("@/modules/model-episodes/experimental-skeletal-muscle-delta-shadow.service", () => ({
  recordExperimentalSkeletalMuscleDeltaShadow,
}));
vi.mock("@/modules/model-episodes/experimental-cessation-detraining-shadow.service", () => ({
  recordExperimentalCessationDetrainingShadow,
  rebuildAuthoritativeRelativeMuscleTrajectory,
}));
vi.mock("@/modules/model-episodes/experimental-ffm-retention-shadow.service", () => ({
  recordExperimentalFfmRetentionShadow,
}));
vi.mock("@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service", () => ({
  recordExperimentalLocalHypertrophyResponseShadow,
}));

import { syncHealthData } from "@/modules/health/health.service";

describe("health sync authoritative muscle suffix rebuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    healthSyncRepository.syncDay.mockImplementation(async (day: { date: string }) => ({
      date: day.date,
      action: "created" as const,
    }));
    healthSyncRepository.pruneOlderThan.mockResolvedValue({ deletedDays: 0, deletedSnapshots: 0 });
  });

  it("replays the authoritative muscle suffix once after the chronological batch, not per day", async () => {
    await syncHealthData({
      days: [
        { date: "2026-09-23" },
        { date: "2026-09-21" },
        { date: "2026-09-22" },
      ],
    }, healthSyncRepository as never);

    expect(recordExperimentalSkeletalMuscleDeltaShadow).toHaveBeenCalledTimes(3);
    expect(recordExperimentalCessationDetrainingShadow).toHaveBeenCalledTimes(3);
    expect(rebuildAuthoritativeRelativeMuscleTrajectory).toHaveBeenCalledTimes(1);
    expect(rebuildAuthoritativeRelativeMuscleTrajectory).toHaveBeenCalledWith({
      fromDate: "2026-09-21",
    });
    // Glycogen is stateful, so its suffix replays once only after all same-day
    // stepper/depletion source shadows have been written.
    expect(recordExperimentalGlycogenStateShadow).toHaveBeenCalledTimes(1);
    expect(recordExperimentalGlycogenStateShadow).toHaveBeenCalledWith({ date: "2026-09-21" });
  });
});
