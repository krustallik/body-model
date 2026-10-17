import { beforeEach, describe, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => ({
  read: vi.fn(), changed: vi.fn(), pending: vi.fn(), convergenceRead: vi.fn(), convergenceChanged: vi.fn(),
}));
const sources = vi.hoisted(() => ({ resolve: vi.fn(), massReferences: vi.fn() }));
const rawFact = {
  date: "2026-10-01",
  events: [{
    id: "strength-session:42",
    title: "Strength training",
    durationMinutes: 45,
    activeEnergyKcal: 245,
    energySource: "model-v1",
    sessionId: 42,
    canonicalEnergyResolution: { kcal: 245, source: "stale-generation", revision: 3 },
    energyShadow: { kcal: 245 },
    activeEnergyMassReference: { massKg: 80 },
    estimatorVersion: "stale-estimator",
  }],
};

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/training/training.repository", () => ({
  readActiveEnergyMassReferencesV1: sources.massReferences,
}));
vi.mock("@/modules/days/training-day-fact", () => ({ resolveTrainingDayFacts: sources.resolve }));
vi.mock("@/modules/training/training-refresh-queue", () => ({
  isTrainingRefreshPending: queue.pending,
  readTrainingRefreshVisibilityFence: queue.read,
  trainingRefreshFenceChanged: queue.changed,
  readActiveEnergyConvergenceVisibilityFence: queue.convergenceRead,
  activeEnergyConvergenceFenceChanged: queue.convergenceChanged,
}));

import { TrainingDayFactRepository } from "@/modules/days/training-day-fact.repository";

function client() {
  return {
    workout: { findMany: vi.fn().mockResolvedValue([]) },
    strengthDiarySession: { findMany: vi.fn().mockResolvedValue([]) },
    modelEpisode: { findMany: vi.fn().mockResolvedValue([]) },
    activeEnergyEventAlias: { findMany: vi.fn().mockResolvedValue([]) },
    dailyHealthData: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("TrainingDayFact currentness fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queue.read.mockResolvedValue({ requestedGeneration: 8, completedGeneration: 8 });
    queue.pending.mockReturnValue(false);
    queue.changed.mockResolvedValue(false);
    queue.convergenceRead.mockResolvedValue(null);
    queue.convergenceChanged.mockResolvedValue(false);
    sources.resolve.mockReturnValue([structuredClone(rawFact)]);
    sources.massReferences.mockResolvedValue(new Map());
  });

  it("masks derived energy while preserving raw event facts when Training is pending", async () => {
    queue.read.mockResolvedValue({ requestedGeneration: 9, completedGeneration: 8 });
    queue.pending.mockReturnValue(true);

    const [fact] = await new TrainingDayFactRepository(client() as never).list();
    expect(fact?.events[0]).toMatchObject({
      id: "strength-session:42",
      title: "Strength training",
      durationMinutes: 45,
      sessionId: 42,
      activeEnergyKcal: null,
      energySource: "unavailable",
    });
    for (const field of ["canonicalEnergyResolution", "energyShadow", "activeEnergyMassReference", "estimatorVersion"]) {
      expect(fact?.events[0]).not.toHaveProperty(field);
    }
  });

  it("masks derived energy when the generation changes during the read", async () => {
    queue.changed.mockResolvedValue(true);

    const [fact] = await new TrainingDayFactRepository(client() as never).list();
    expect(fact?.events[0]).toMatchObject({
      id: "strength-session:42",
      title: "Strength training",
      durationMinutes: 45,
      sessionId: 42,
      activeEnergyKcal: null,
      energySource: "unavailable",
    });
    for (const field of ["canonicalEnergyResolution", "energyShadow", "activeEnergyMassReference", "estimatorVersion"]) {
      expect(fact?.events[0]).not.toHaveProperty(field);
    }
  });

  it("masks only derived values while Active Energy convergence is fenced", async () => {
    queue.convergenceRead.mockResolvedValue({ active: true, revision: 2, fromDate: "2026-09-30", lifecycleUpdatedAt: "2026-10-17T10:00:00.000Z" });
    const [fact] = await new TrainingDayFactRepository(client() as never).list();
    expect(fact?.events[0]).toMatchObject({ activeEnergyKcal: null, energySource: "unavailable", sessionId: 42 });
    expect(fact?.events[0]).not.toHaveProperty("canonicalEnergyResolution");
  });
});
