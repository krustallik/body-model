import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/access", async () => (await import("./helpers/mock-verified-profile-auth")).mockProfileAuth);

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

const context = (id: string) => ({ params: Promise.resolve({ id }) });
describe("stepper diagnostic route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.readFence.mockResolvedValue({ requestedGeneration: 4, completedGeneration: 4 });
    state.pending.mockReturnValue(false);
    state.fenceChanged.mockResolvedValue(false);
    state.readModelFence.mockResolvedValue({ invalidationGeneration: 3, updatedAt: "2026-10-16T12:00:00.000Z" });
    state.modelBlocks.mockResolvedValue(false);
  });
  it("returns read-only evidence for a stair workout", async () => {
    state.get.mockResolvedValue({ workout: { workoutId: 7 } });
    const response = await GET(new Request("http://localhost/api/v1/workouts/7/stepper-diagnostic"), context("7"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ diagnostic: { workout: { workoutId: 7 } } });
  });
  it("leaves a non-stair workout outside the diagnostic", async () => {
    state.get.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/v1/workouts/8/stepper-diagnostic"), context("8"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_stair_workout" });
  });
  it("rejects invalid workout ids without repository access", async () => {
    const response = await GET(new Request("http://localhost/api/v1/workouts/nope/stepper-diagnostic"), context("nope"));
    expect(response.status).toBe(400);
    expect(state.get).not.toHaveBeenCalled();
  });
});
