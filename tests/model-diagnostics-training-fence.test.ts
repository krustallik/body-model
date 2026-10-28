import { beforeEach, describe, expect, it, vi } from "vitest";

const repositories = vi.hoisted(() => ({
  getActive: vi.fn(),
  status: vi.fn(),
  loadEvidence: vi.fn(),
  latestStatus: vi.fn(),
  buildDiagnosticsDto: vi.fn(),
}));
const fence = vi.hoisted(() => ({
  read: vi.fn(),
  pending: vi.fn(),
  changed: vi.fn(),
  owns: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/model-episodes/model-episode.repository", () => ({
  ModelEpisodeRepository: class {
    getActive = repositories.getActive;
    status = repositories.status;
  },
}));
vi.mock("@/modules/model-diagnostics/model-diagnostics.repository", () => ({
  ModelDiagnosticsRepository: class {
    loadEvidence = repositories.loadEvidence;
  },
}));
vi.mock("@/modules/model-recovery/model-recovery.repository", () => ({
  ModelRecoveryRepository: class {
    latestStatus = repositories.latestStatus;
  },
}));
vi.mock("@/modules/model-diagnostics/model-diagnostics", () => ({
  buildDiagnosticsDto: repositories.buildDiagnosticsDto,
  MODEL_DIAGNOSTICS_RECENT_WINDOW_DAYS: 14,
}));
vi.mock("@/modules/training/training-refresh-queue", () => ({
  isTrainingRefreshPending: fence.pending,
  readTrainingRefreshVisibilityFence: fence.read,
  trainingRefreshFenceChanged: fence.changed,
  trainingRefreshWorkerOwnsGeneration: fence.owns,
}));

import {
  getModelDiagnostics,
  TrainingRefreshPendingDiagnosticsError,
} from "@/modules/model-diagnostics/model-diagnostics.service";

describe("model diagnostics Training currentness fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fence.read.mockResolvedValue({ requestedGeneration: 4, completedGeneration: 4 });
    fence.pending.mockReturnValue(false);
    fence.changed.mockResolvedValue(false);
    fence.owns.mockResolvedValue(false);
    repositories.getActive.mockResolvedValue({ id: 7, startDate: "2026-01-01", latestModeledDate: "2026-09-01" });
    repositories.status.mockResolvedValue({ productionCurrent: true, latestModeledDate: "2026-09-01" });
    repositories.loadEvidence.mockResolvedValue({ modeledDayCount: 1 });
    repositories.latestStatus.mockResolvedValue({ status: "current" });
    repositories.buildDiagnosticsDto.mockReturnValue({ currentState: { status: "available" } });
  });

  it("fails closed when a Training generation is already pending", async () => {
    fence.read.mockResolvedValue({ requestedGeneration: 5, completedGeneration: 4 });
    fence.pending.mockReturnValue(true);

    await expect(getModelDiagnostics(1)).rejects.toBeInstanceOf(TrainingRefreshPendingDiagnosticsError);
    expect(repositories.buildDiagnosticsDto).not.toHaveBeenCalled();
  });

  it("fails closed when the generation changes during deterministic and recovery reads", async () => {
    fence.changed.mockResolvedValue(true);

    await expect(getModelDiagnostics(1)).rejects.toBeInstanceOf(TrainingRefreshPendingDiagnosticsError);
    expect(repositories.loadEvidence).toHaveBeenCalled();
    expect(repositories.latestStatus).toHaveBeenCalled();
    expect(repositories.buildDiagnosticsDto).not.toHaveBeenCalled();
  });
});
