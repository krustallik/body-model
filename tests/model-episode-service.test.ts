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
  });

  it("initializes yesterday in Bratislava and atomically deactivates the old episode", async () => {
    const result = await initializeNewModelEpisode({
      now: new Date("2026-08-23T10:00:00.000Z"),
    }, client);
    expect(repository.loadSources).toHaveBeenCalledWith("2026-05-25", "2026-08-22");
    expect(repository.deactivateActive).toHaveBeenCalledWith(
      new Date("2026-08-23T10:00:00.000Z"),
    );
    expect(repository.createPrepared).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: 7, startDate: "2026-08-22", ecfPolicy: "hold-ecf" });
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
    expect(repository.loadSources).toHaveBeenCalledWith("2026-08-20", "2026-08-21");
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

  it("upgrades v3 input semantics before calculation and persists only v4 rows", async () => {
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
        dailyStates: [expect.objectContaining({ modelVersion: "bodycast-physiology-v4" })],
      }),
      "bodycast-physiology-v4",
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
