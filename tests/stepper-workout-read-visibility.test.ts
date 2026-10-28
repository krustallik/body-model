import { beforeEach, describe, expect, it, vi } from "vitest";

const fences = vi.hoisted(() => ({
  read: vi.fn(),
  changed: vi.fn(),
  convergenceRead: vi.fn(),
  convergenceChanged: vi.fn(),
}));

vi.mock("@/modules/training/training-refresh-queue", () => ({
  readTrainingRefreshVisibilityFence: fences.read,
  trainingRefreshFenceChanged: fences.changed,
  readActiveEnergyConvergenceVisibilityFence: fences.convergenceRead,
  activeEnergyConvergenceFenceChanged: fences.convergenceChanged,
  isTrainingRefreshPending: (fence: { requestedGeneration: number; completedGeneration: number } | null) =>
    fence !== null && fence.requestedGeneration > fence.completedGeneration,
}));

import { StepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";

function row() {
  return {
    id: 41,
    type: "Stair Climbing",
    startAt: new Date("2026-10-01T10:00:00.000Z"),
    endAt: new Date("2026-10-01T10:30:00.000Z"),
    durationMinutes: 30,
    activeEnergyKcal: null,
    manualStepCount: null,
    manualActiveEnergyKcal: null,
    sourceIdentity: "manual-stepper:test",
    syncProtected: false,
    matchedDiarySession: null,
    activeEnergyAliases: [{ event: {
      currentKcal: 245,
      currentSource: "model-v1",
      resolutionRevision: 7,
      isStale: false,
    } }],
  };
}

function repository() {
  const client = {
    workout: { findMany: vi.fn().mockResolvedValue([row()]) },
    stepperReconciliationCandidate: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return new StepperWorkoutRepository(client as never);
}

describe("Stepper workout currentness during Training refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fences.read.mockResolvedValue({
      requestedGeneration: 3,
      completedGeneration: 2,
      dirtyFromDate: "2026-10-01",
      dirtyToDate: "2026-10-01",
    });
    fences.changed.mockResolvedValue(false);
    fences.convergenceRead.mockResolvedValue(null);
    fences.convergenceChanged.mockResolvedValue(false);
  });

  it("hides canonical energy while a Training generation is pending", async () => {
    const [workout] = await repository().list(1);
    expect(workout).toMatchObject({
      id: 41,
      selectedActiveEnergyKcal: null,
      selectedActiveEnergySource: "unavailable",
      selectedActiveEnergyFullCoverage: false,
      selectedActiveEnergyStatus: "pending",
    });
  });

  it("hides canonical energy when the generation changes during the composed list read", async () => {
    fences.read.mockResolvedValue({
      requestedGeneration: 3,
      completedGeneration: 3,
      dirtyFromDate: null,
      dirtyToDate: null,
    });
    fences.changed.mockResolvedValue(true);
    const [workout] = await repository().list(1);
    expect(workout?.selectedActiveEnergyKcal).toBeNull();
    expect(workout?.selectedActiveEnergySource).toBe("unavailable");
    expect(workout?.selectedActiveEnergyStatus).toBe("pending");
  });

  it("hides canonical energy while Active Energy convergence is in progress", async () => {
    fences.convergenceRead.mockResolvedValue({ active: true, revision: 4, fromDate: "2026-09-01", lifecycleUpdatedAt: "2026-10-17T10:00:00.000Z" });
    const [workout] = await repository().list(1);
    expect(workout?.selectedActiveEnergyKcal).toBeNull();
    expect(workout?.selectedActiveEnergySource).toBe("unavailable");
    expect(workout?.selectedActiveEnergyStatus).toBe("pending");
  });

  it("masks if convergence starts while the list query is in flight", async () => {
    fences.convergenceRead.mockResolvedValueOnce(null).mockResolvedValueOnce({ active: true, revision: 4, fromDate: "2026-09-01", lifecycleUpdatedAt: "2026-10-17T10:00:00.000Z" });
    fences.convergenceChanged.mockImplementation(async (_client, _profileId, before) => before === null);
    const [workout] = await repository().list(1);
    expect(workout?.selectedActiveEnergyKcal).toBeNull();
    expect(workout?.selectedActiveEnergyStatus).toBe("pending");
  });

  it("keeps current canonical energy visible when the fence remains stable", async () => {
    fences.read.mockResolvedValue({
      requestedGeneration: 3,
      completedGeneration: 3,
      dirtyFromDate: null,
      dirtyToDate: null,
    });
    const [workout] = await repository().list(1);
    expect(workout?.selectedActiveEnergyKcal).toBe(245);
    expect(workout?.selectedActiveEnergySource).toBe("model-v1");
    expect(workout?.selectedActiveEnergyStatus).toBe("current");
  });
});
