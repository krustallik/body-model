import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getActive: vi.fn(),
  getById: vi.fn(),
  loadSources: vi.fn(),
  latestStatus: vi.fn(),
  markAllStale: vi.fn(),
  readFence: vi.fn(),
  pending: vi.fn(),
  fenceChanged: vi.fn(),
  readModelFence: vi.fn(),
  modelBlocks: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/model-episodes/model-episode.repository", () => ({
  ModelEpisodeRepository: class {
    getActive = state.getActive;
    getById = state.getById;
    loadSources = state.loadSources;
  },
}));
vi.mock("@/modules/model-recovery/model-recovery.repository", () => ({
  ModelRecoveryRepository: class {
    latestStatus = state.latestStatus;
    markAllStale = state.markAllStale;
  },
}));
vi.mock("@/modules/model-episodes/physiology-v7-persistence.repository", () => ({
  PhysiologyV7PersistenceRepository: class {
    readUnifiedPublicationFence = state.readModelFence;
    hasUnifiedPublicationBlocks = state.modelBlocks;
  },
}));
vi.mock("@/modules/training/training-refresh-queue", () => ({
  readTrainingRefreshVisibilityFence: state.readFence,
  isTrainingRefreshPending: state.pending,
  trainingRefreshFenceChanged: state.fenceChanged,
}));

import {
  getModelRecoveryStatus,
  ModelRefreshVisibilityPendingError,
  TrainingRefreshVisibilityPendingError,
} from "@/modules/model-recovery/model-recovery.service";

describe("model recovery status Training currentness fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getActive.mockResolvedValue({
      id: 7, profileId: 1, startDate: "2026-01-01", timezone: "UTC", modelVersion: "model-v1",
    });
    state.latestStatus.mockResolvedValue(null);
    state.markAllStale.mockResolvedValue(undefined);
    state.readFence.mockResolvedValue({ requestedGeneration: 5, completedGeneration: 5 });
    state.pending.mockReturnValue(false);
    state.fenceChanged.mockResolvedValue(false);
    state.readModelFence.mockResolvedValue({ invalidationGeneration: 3, updatedAt: "2026-10-16T12:00:00.000Z" });
    state.modelBlocks.mockResolvedValue(false);
  });

  it("refuses a recovery status read that starts during a pending Training generation", async () => {
    state.pending.mockReturnValue(true);
    await expect(getModelRecoveryStatus(1)).rejects.toBeInstanceOf(TrainingRefreshVisibilityPendingError);
    expect(state.latestStatus).not.toHaveBeenCalled();
  });

  it("refuses a composed recovery read when the Training generation changes", async () => {
    state.fenceChanged.mockResolvedValue(true);
    await expect(getModelRecoveryStatus(1)).rejects.toBeInstanceOf(TrainingRefreshVisibilityPendingError);
    expect(state.latestStatus).toHaveBeenCalledOnce();
  });

  it("refuses a recovery read while Health or another model source publication is blocked", async () => {
    state.modelBlocks.mockResolvedValue(true);
    await expect(getModelRecoveryStatus(1)).rejects.toBeInstanceOf(ModelRefreshVisibilityPendingError);
    expect(state.latestStatus).not.toHaveBeenCalled();
  });

  it("refuses a recovery read when model-source publication changes during composition", async () => {
    state.readModelFence
      .mockResolvedValueOnce({ invalidationGeneration: 3, updatedAt: "2026-10-16T12:00:00.000Z" })
      .mockResolvedValueOnce({ invalidationGeneration: 3, updatedAt: "2026-10-16T12:00:00.001Z" });
    await expect(getModelRecoveryStatus(1)).rejects.toBeInstanceOf(ModelRefreshVisibilityPendingError);
  });

  it("refuses a recovery read when a Health publication block appears during composition", async () => {
    state.modelBlocks.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(getModelRecoveryStatus(1)).rejects.toBeInstanceOf(ModelRefreshVisibilityPendingError);
  });

  it("returns status when the Training fence remains stable", async () => {
    await expect(getModelRecoveryStatus(1)).resolves.toEqual({
      episodeId: 7,
      deterministicModelVersion: "model-v1",
      recovery: null,
    });
  });
});
