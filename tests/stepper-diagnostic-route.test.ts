import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  get: vi.fn(),
  readFence: vi.fn(),
  pending: vi.fn(),
  fenceChanged: vi.fn(),
  readModelFence: vi.fn(),
  modelBlocks: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/profile/stepper-workout-diagnostic.repository", () => ({
  stepperWorkoutDiagnosticRepository: { get: state.get },
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

import { GET } from "@/app/api/v1/workouts/[id]/stepper-diagnostic/route";

describe("Stepper diagnostic currentness fences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.readFence.mockResolvedValue({ requestedGeneration: 4, completedGeneration: 4 });
    state.pending.mockReturnValue(false);
    state.fenceChanged.mockResolvedValue(false);
    state.readModelFence.mockResolvedValue({ invalidationGeneration: 3, updatedAt: "2026-10-16T12:00:00.000Z" });
    state.modelBlocks.mockResolvedValue(false);
    state.get.mockResolvedValue({ activeEnergyResolution: { availability: "available" } });
  });

  it("fails closed while Training refresh is pending", async () => {
    state.pending.mockReturnValue(true);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "41" }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "training_refresh_pending" });
    expect(state.get).not.toHaveBeenCalled();
  });

  it("does not return model-facing energy if Training changes during the diagnostic read", async () => {
    state.fenceChanged.mockResolvedValue(true);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "41" }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "training_refresh_pending" });
  });

  it("fails closed while a Health/model publication block is present", async () => {
    state.modelBlocks.mockResolvedValue(true);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "41" }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "model_refresh_pending" });
    expect(state.get).not.toHaveBeenCalled();
  });

  it("rejects a mixed Health diagnostic when the source fence changes mid-read", async () => {
    state.readModelFence
      .mockResolvedValueOnce({ invalidationGeneration: 3, updatedAt: "2026-10-16T12:00:00.000Z" })
      .mockResolvedValueOnce({ invalidationGeneration: 3, updatedAt: "2026-10-16T12:00:00.001Z" });
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "41" }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "model_refresh_pending" });
  });

  it("rejects a mixed Health diagnostic when a publication block appears mid-read", async () => {
    state.modelBlocks.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "41" }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "model_refresh_pending" });
  });

  it("returns the diagnostic only while the Training fence stays current", async () => {
    const diagnostic = { activeEnergyResolution: { availability: "available" } };
    state.get.mockResolvedValue(diagnostic);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "41" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ diagnostic });
  });
});
