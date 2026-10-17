import { beforeEach, describe, expect, it, vi } from "vitest";

const visibility = vi.hoisted(() => ({
  convergenceRead: vi.fn(),
  convergenceChanged: vi.fn(),
  trainingChanged: vi.fn(),
  workerOwns: vi.fn(),
}));

vi.mock("@/modules/training/training-refresh-queue", () => ({
  readActiveEnergyConvergenceVisibilityFence: visibility.convergenceRead,
  activeEnergyConvergenceFenceChanged: visibility.convergenceChanged,
  trainingRefreshFenceChanged: visibility.trainingChanged,
  trainingRefreshWorkerOwnsGeneration: visibility.workerOwns,
  isTrainingRefreshPending: () => false,
}));

import { hideSessionDerivedResultsWhileTrainingRefreshIsPending } from "@/modules/training/training.repository";

const session = {
  id: 7,
  selectedActiveEnergy: { kcal: 123, source: "model-v1", fullCoverage: true, resolutionRevision: 4 },
  sets: [{ id: 11, reps: 3 }],
} as never;

describe("Training session Active Energy convergence currentness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visibility.convergenceRead.mockResolvedValue(null);
    visibility.convergenceChanged.mockResolvedValue(false);
    visibility.trainingChanged.mockResolvedValue(false);
    visibility.workerOwns.mockResolvedValue(false);
  });

  it("hides only model-derived energy while convergence is active", async () => {
    visibility.convergenceRead.mockResolvedValue({ active: true, revision: 3, fromDate: "2026-09-01", lifecycleUpdatedAt: "2026-10-17T10:00:00.000Z" });
    const result = await hideSessionDerivedResultsWhileTrainingRefreshIsPending({} as never, 1, null, session);
    expect(result.selectedActiveEnergy).toEqual({
      kcal: null,
      source: "unavailable",
      fullCoverage: false,
      resolutionRevision: null,
    });
    expect(result).toHaveProperty("sets", [{ id: 11, reps: 3 }]);
  });

  it("masks when the convergence token changes during the composed read", async () => {
    visibility.convergenceChanged.mockResolvedValue(true);
    const result = await hideSessionDerivedResultsWhileTrainingRefreshIsPending({} as never, 1, null, session);
    expect(result.selectedActiveEnergy?.kcal).toBeNull();
  });
});
