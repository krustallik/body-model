import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const repository = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getActive: vi.fn(),
  getById: vi.fn(),
  loadSources: vi.fn(),
  deactivateActive: vi.fn(),
  createPrepared: vi.fn(),
  persistCalculation: vi.fn(),
  markRecoveryRunsStale: vi.fn(),
  status: vi.fn(),
  history: vi.fn(),
}));
vi.mock("@/modules/model-episodes/model-episode.repository", () => ({
  ModelEpisodeRepository: class {
    constructor() { return repository; }
  },
}));

import {
  getModelHistory,
  getModelStatus,
  initializeNewModelEpisode,
  recalculateModelEpisode,
} from "@/modules/model-episodes/model-episode.service";
import {
  EpisodeInitializationError,
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { modelProfile, persistedEpisodeFixture, stableSourceDays, sourceDay } from "./model-episode-fixtures";

const clientMock = {
  $transaction: vi.fn(async (callback: (transaction: object) => unknown) => callback({})),
};
const client = clientMock as unknown as PrismaClient;

describe("model episode application service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.getProfile.mockResolvedValue(modelProfile);
    repository.loadSources.mockResolvedValue({
      days: stableSourceDays(), snapshots: [], workIntervals: [],
    });
    repository.deactivateActive.mockResolvedValue(undefined);
    repository.createPrepared.mockImplementation(async (prepared) => ({ id: 7, ...prepared }));
    repository.persistCalculation.mockResolvedValue(undefined);
    repository.markRecoveryRunsStale.mockResolvedValue(undefined);
  });

  it("initializes yesterday in Bratislava and atomically deactivates the old episode", async () => {
    const result = await initializeNewModelEpisode({
      now: new Date("2026-08-23T10:00:00.000Z"),
    }, client);
    expect(repository.loadSources).toHaveBeenCalledWith("2026-04-19", "2026-08-22");
    expect(repository.deactivateActive).toHaveBeenCalledWith(
      new Date("2026-08-23T10:00:00.000Z"),
    );
    expect(repository.createPrepared).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: 7, startDate: "2026-08-22", ecfPolicy: "hold-ecf" });
  });

  it("initializes an explicit insufficient-history episode instead of dead-ending the start action", async () => {
    repository.loadSources.mockResolvedValue({
      days: stableSourceDays({ count: 10 }).map((day) => ({
        ...day,
        bodyFatPercent: null,
        caloriesKcal: null,
        proteinG: null,
        fatG: null,
        carbsG: null,
      })),
      snapshots: [], workIntervals: [], workouts: [],
    });
    const result = await initializeNewModelEpisode({
      now: new Date("2026-08-23T10:00:00.000Z"),
    }, client);
    expect(repository.deactivateActive).toHaveBeenCalledOnce();
    expect(repository.createPrepared).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: 7, initializationStatus: "insufficient" });
    expect(result.initializationDiagnostics).toMatchObject({
      bootstrap: { mode: "insufficient-history", fallbackBodyFatPercent: 25 },
    });
  });

  it("rejects a current or future local start date before database work", async () => {
    await expect(initializeNewModelEpisode({
      startDate: "2026-08-23",
      now: new Date("2026-08-23T10:00:00.000Z"),
    }, client)).rejects.toEqual(new EpisodeInitializationError("start-date-not-complete"));
    expect(clientMock.$transaction).not.toHaveBeenCalled();
  });

  it("recalculates active sources only through the latest completed local date", async () => {
    const episode = persistedEpisodeFixture("2026-08-20");
    repository.getActive.mockResolvedValue(episode);
    repository.loadSources.mockResolvedValue({
      days: [sourceDay("2026-08-20"), sourceDay("2026-08-21")],
      snapshots: [],
      workIntervals: [],
    });
    repository.status.mockResolvedValue({ episodeId: episode.id });
    const result = await recalculateModelEpisode({
      now: new Date("2026-08-22T10:00:00.000Z"),
    }, client);
    expect(repository.loadSources).toHaveBeenCalledWith("2026-04-18", "2026-08-21");
    expect(repository.persistCalculation).toHaveBeenCalledOnce();
    expect(repository.persistCalculation.mock.calls[0]?.[1].dailyStates.every(
      ({ nutrition }: { nutrition: { source: string } }) => nutrition.source === "observed",
    )).toBe(true);
    expect(result).toMatchObject({
      status: "ok", daysPersisted: 2, completeDays: 2, incompleteDays: 0,
      observedNutritionDays: 2, imputedNutritionDays: 0, unbridgeableNutritionDays: 0,
      calibrationStatus: "insufficient-history",
    });
  });

  it("expands a recent episode back to the earliest retained modelable run", async () => {
    const episode = {
      ...persistedEpisodeFixture("2026-09-01"),
      modelVersion: "bodycast-physiology-v5",
    };
    const historical = [
      ...stableSourceDays({
        count: 14,
        endDate: "2026-08-31",
        override: () => ({ bodyFatPercent: 20 }),
      }),
      sourceDay("2026-09-01", {
        caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
      }),
      sourceDay("2026-09-02"),
      sourceDay("2026-09-03", {
        caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
      }),
    ];
    const recent = [
      sourceDay("2026-09-14", {
        weightKg: 92.9, strengthTrainingMinutes: null, workoutFeedObserved: true,
      }),
      sourceDay("2026-09-15", {
        weightKg: 91.1, strengthTrainingMinutes: null, workoutFeedObserved: true,
      }),
    ];
    repository.getActive.mockResolvedValue(episode);
    repository.loadSources.mockResolvedValue({
      days: [...historical, ...recent], snapshots: [], workIntervals: [], workouts: [],
    });
    repository.createPrepared.mockResolvedValue({
      ...persistedEpisodeFixture("2026-08-18"),
      id: 8,
    });
    repository.status.mockResolvedValue({ episodeId: 8, daysModeled: 16 });

    const result = await recalculateModelEpisode({
      now: new Date("2026-09-16T18:00:00.000Z"),
    }, client);

    expect(repository.deactivateActive).toHaveBeenCalledWith(
      new Date("2026-09-16T18:00:00.000Z"),
    );
    expect(repository.createPrepared).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-08-18",
      }),
    );
    expect(repository.persistCalculation).toHaveBeenCalledWith(
      8,
      expect.objectContaining({
        dailyStates: expect.arrayContaining([
          expect.objectContaining({ date: "2026-08-18" }),
          expect.objectContaining({ date: "2026-08-31" }),
        ]),
      }),
      "bodycast-physiology-v7",
    );
    expect(result).toMatchObject({ episodeId: 8, daysPersisted: 16, completeDays: 16 });
  });

  it("restarts at a three-day post-gap run when no older usable run exists", async () => {
    const episode = persistedEpisodeFixture("2026-09-01");
    const recent = ["2026-09-14", "2026-09-15", "2026-09-16"].map((date) => (
      sourceDay(date, { workoutFeedObserved: true })
    ));
    repository.getActive.mockResolvedValue(episode);
    repository.loadSources.mockResolvedValue({
      days: [
        sourceDay("2026-09-01", {
          caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
        }),
        ...recent,
      ],
      snapshots: [], workIntervals: [], workouts: [],
    });
    repository.createPrepared.mockResolvedValue({
      ...persistedEpisodeFixture("2026-09-14"), id: 9,
    });
    repository.status.mockResolvedValue({ episodeId: 9, daysModeled: 3 });

    const result = await recalculateModelEpisode({
      now: new Date("2026-09-17T10:00:00.000Z"),
    }, client);

    expect(repository.createPrepared).toHaveBeenCalledWith(expect.objectContaining({
      startDate: "2026-09-14",
    }));
    expect(result).toMatchObject({ episodeId: 9, daysPersisted: 3, completeDays: 3 });
  });

  it("handles an episode with no completed source days deterministically", async () => {
    const episode = persistedEpisodeFixture("2026-08-23");
    repository.getById.mockResolvedValue(episode);
    repository.status.mockResolvedValue(null);
    const result = await recalculateModelEpisode({
      episodeId: episode.id,
      now: new Date("2026-08-22T10:00:00.000Z"),
    }, client);
    expect(repository.loadSources).not.toHaveBeenCalled();
    expect(result.daysPersisted).toBe(0);
    expect(result.latestModeledDate).toBeNull();
  });

  it("keeps the earliest retained run across repeated recalculates", async () => {
    const historical = [
      ...stableSourceDays({
        count: 5,
        endDate: "2026-08-21",
        override: () => ({ bodyFatPercent: 20 }),
      }),
      ...stableSourceDays({
        count: 5,
        endDate: "2026-08-28",
        override: () => ({ bodyFatPercent: 20 }),
      }),
    ];
    // Incomplete bridge day splits the history into two qualifying runs.
    historical.splice(5, 0, sourceDay("2026-08-22", {
      caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
      walkingDistanceKm: null,
    }));
    const sources = { days: historical, snapshots: [], workIntervals: [], workouts: [] };
    repository.loadSources.mockResolvedValue(sources);
    repository.createPrepared.mockImplementation(async (prepared) => ({
      ...persistedEpisodeFixture(prepared.startDate),
      id: prepared.startDate === "2026-08-17" ? 11 : 12,
      modelVersion: "bodycast-physiology-v7",
    }));
    repository.status.mockResolvedValue({ episodeId: 11, daysModeled: 5 });

    repository.getActive.mockResolvedValue({
      ...persistedEpisodeFixture("2026-08-24"),
      modelVersion: "bodycast-physiology-v5",
    });
    const first = await recalculateModelEpisode({
      now: new Date("2026-08-29T18:00:00.000Z"),
    }, client);
    expect(repository.createPrepared).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-08-17" }),
    );
    expect(first).toMatchObject({ episodeId: 11, daysPersisted: 5 });

    repository.createPrepared.mockClear();
    repository.deactivateActive.mockClear();
    repository.getActive.mockResolvedValue({
      ...persistedEpisodeFixture("2026-08-17"),
      id: 11,
      modelVersion: "bodycast-physiology-v7",
    });
    const second = await recalculateModelEpisode({
      now: new Date("2026-08-29T18:05:00.000Z"),
    }, client);
    expect(repository.createPrepared).not.toHaveBeenCalled();
    expect(repository.deactivateActive).not.toHaveBeenCalled();
    expect(second).toMatchObject({ episodeId: 11, daysPersisted: 5 });
  });

  it("preserves legacy episode semantics instead of silently relabeling them v5", async () => {
    const episode = {
      ...persistedEpisodeFixture("2026-08-20"),
      modelVersion: "bodycast-physiology-v3",
    };
    repository.getById.mockResolvedValue(episode);
    repository.loadSources.mockResolvedValue({
      days: [sourceDay("2026-08-20")], snapshots: [], workIntervals: [],
    });
    repository.status.mockResolvedValue({ episodeId: episode.id });
    await recalculateModelEpisode({
      episodeId: episode.id,
      now: new Date("2026-08-21T10:00:00.000Z"),
    }, client);
    expect(repository.persistCalculation).toHaveBeenCalledWith(
      episode.id,
      expect.objectContaining({
        dailyStates: [expect.objectContaining({ modelVersion: "bodycast-physiology-v3" })],
      }),
      "bodycast-physiology-v3",
    );
  });

  it("distinguishes no active episode from an unknown explicit episode", async () => {
    repository.getActive.mockResolvedValue(null);
    await expect(recalculateModelEpisode({}, client))
      .rejects.toBeInstanceOf(NoActiveModelEpisodeError);
    repository.getById.mockResolvedValue(null);
    await expect(recalculateModelEpisode({ episodeId: 999 }, client))
      .rejects.toBeInstanceOf(ModelEpisodeNotFoundError);
  });

  it("returns status/history DTOs and preserves their not-found semantics", async () => {
    repository.status.mockResolvedValue({ episodeId: 1 });
    await expect(getModelStatus(undefined, client)).resolves.toEqual({ episodeId: 1 });
    repository.status.mockResolvedValue(null);
    await expect(getModelStatus(undefined, client)).rejects
      .toBeInstanceOf(NoActiveModelEpisodeError);
    await expect(getModelStatus(9, client)).rejects
      .toBeInstanceOf(ModelEpisodeNotFoundError);

    repository.history.mockResolvedValue({ episodeId: 1, days: [] });
    const query = { limit: 90, offset: 0 };
    await expect(getModelHistory(query, client)).resolves.toEqual({
      episodeId: 1, days: [], limit: 90, offset: 0,
    });
    repository.history.mockResolvedValue(null);
    await expect(getModelHistory(query, client)).rejects
      .toBeInstanceOf(NoActiveModelEpisodeError);
    await expect(getModelHistory({ ...query, episodeId: 9 }, client)).rejects
      .toBeInstanceOf(ModelEpisodeNotFoundError);
  });
});
