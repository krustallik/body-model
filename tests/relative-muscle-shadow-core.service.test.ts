import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { rebuildRelativeMuscleEpisodeTrajectories } from "@/modules/model-episodes/relative-muscle-shadow-core.service";

type EpisodeFixture = {
  id: number;
  profileId: number;
  startDate: string;
  timezone: string;
  active: boolean;
  deactivatedAt: Date | null;
  latestModeledDate: string | null;
};

type ShadowRow = {
  profileId: number;
  modelEpisodeId: number;
  date: string;
  sourceFingerprint: string;
  modelRevision: string;
  isStale: boolean;
  features: unknown;
  result: unknown;
};

type DateFilter = string | { gte?: string; lte?: string };
type ShadowWhere = {
  profileId?: number;
  modelEpisodeId?: number;
  date?: DateFilter;
  profileId_modelEpisodeId_date?: { profileId: number; modelEpisodeId: number; date: string };
};

function dateMatches(row: ShadowRow, where: ShadowWhere): boolean {
  if (where.profileId !== undefined && row.profileId !== where.profileId) return false;
  if (where.modelEpisodeId !== undefined && row.modelEpisodeId !== where.modelEpisodeId) return false;
  if (typeof where.date === "string" && row.date !== where.date) return false;
  if (where.date && typeof where.date === "object") {
    if (where.date.gte && row.date < where.date.gte) return false;
    if (where.date.lte && row.date > where.date.lte) return false;
  }
  const unique = where.profileId_modelEpisodeId_date;
  return !unique || (row.profileId === unique.profileId
    && row.modelEpisodeId === unique.modelEpisodeId
    && row.date === unique.date);
}

function createClient(input: {
  episodes: EpisodeFixture[];
  healthRows: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown>>;
  dailyStates: Array<Record<string, unknown>>;
  workouts?: Array<Record<string, unknown>>;
}) {
  const deltaRows: ShadowRow[] = [];
  const cessationRows: ShadowRow[] = [];
  const deltaUpsertDates: string[] = [];
  const cessationUpsertDates: string[] = [];

  const makeShadowDelegate = (rows: ShadowRow[], upsertDates: string[]) => ({
    updateMany: vi.fn(async (args: unknown) => {
      const query = args as { where: ShadowWhere; data: { isStale: boolean } };
      let count = 0;
      for (const row of rows) {
        if (!dateMatches(row, query.where)) continue;
        row.isStale = query.data.isStale;
        count += 1;
      }
      return { count };
    }),
    findUnique: vi.fn(async (args: unknown) => {
      const query = args as { where: ShadowWhere };
      return rows.find((row) => dateMatches(row, query.where)) ?? null;
    }),
    findMany: vi.fn(async (args: unknown) => {
      const query = args as { where: ShadowWhere };
      return rows.filter((row) => dateMatches(row, query.where)).sort((a, b) => a.date.localeCompare(b.date));
    }),
    upsert: vi.fn(async (args: unknown) => {
      const query = args as { where: ShadowWhere; create: ShadowRow; update: Partial<ShadowRow> };
      upsertDates.push(query.create.date);
      const existing = rows.find((row) => dateMatches(row, query.where));
      if (existing) Object.assign(existing, query.update);
      else rows.push({ ...query.create });
      return existing ?? query.create;
    }),
  });

  const delta = makeShadowDelegate(deltaRows, deltaUpsertDates);
  const cessation = makeShadowDelegate(cessationRows, cessationUpsertDates);
  const client = {
    modelEpisode: { findMany: vi.fn(async () => input.episodes) },
    dailyHealthData: { findMany: vi.fn(async () => input.healthRows) },
    healthSyncSnapshot: { findMany: vi.fn(async () => input.snapshots) },
    dailyModelState: { findMany: vi.fn(async () => input.dailyStates) },
    workout: { findMany: vi.fn(async () => input.workouts ?? []) },
    strengthDiarySession: { findMany: vi.fn(async () => []) },
    experimentalSkeletalMuscleDeltaShadow: delta,
    experimentalCessationDetrainingShadow: cessation,
    $transaction: vi.fn(async (operation: unknown) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      if (typeof operation === "function") return operation({
        modelEpisode: client.modelEpisode,
        dailyHealthData: client.dailyHealthData,
        healthSyncSnapshot: client.healthSyncSnapshot,
        dailyModelState: client.dailyModelState,
        workout: client.workout,
        strengthDiarySession: client.strengthDiarySession,
        experimentalSkeletalMuscleDeltaShadow: delta,
        experimentalCessationDetrainingShadow: cessation,
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: vi.fn().mockResolvedValue(1),
      });
      throw new TypeError("unsupported transaction operation");
    }),
  } as unknown as PrismaClient;

  return { client, deltaRows, cessationRows, deltaUpsertDates, cessationUpsertDates };
}

function fixture(overrides: Partial<Parameters<typeof createClient>[0]> = {}) {
  const updatedAt = new Date("2026-09-03T12:00:00.000Z");
  const dates = ["2026-09-01", "2026-09-02"];
  const episode: EpisodeFixture = {
    id: 17,
    profileId: 5,
    startDate: dates[0]!,
    timezone: "Europe/Bratislava",
    active: true,
    deactivatedAt: null,
    latestModeledDate: dates[1]!,
  };
  return createClient({
    episodes: [episode],
    healthRows: dates.map((date, id) => ({
      id: id + 1,
      date,
      updatedAt,
      weightKg: 80,
      proteinG: 150,
      workoutFeedObserved: true,
    })),
    snapshots: dates.map((date, id) => ({
      id: id + 1,
      date,
      receivedAt: updatedAt,
      timezone: episode.timezone,
    })),
    dailyStates: dates.map((date, id) => ({
      id: id + 1,
      episodeId: episode.id,
      date,
      status: "complete",
      modelVersion: "test-v7",
      energyBalanceKcal: -100,
      updatedAt,
    })),
    ...overrides,
  });
}

describe("Relative Muscle episode core service", () => {
  it("keeps unavailable days distinct from verified no-exposure zero and resumes an exact suffix", async () => {
    const data = fixture({ dailyStates: [
      {
        id: 1, episodeId: 17, date: "2026-09-01", status: "complete", modelVersion: "test-v7",
        energyBalanceKcal: -100, updatedAt: new Date("2026-09-03T12:00:00.000Z"),
      },
      {
        id: 2, episodeId: 17, date: "2026-09-02", status: "partial", modelVersion: "test-v7",
        energyBalanceKcal: -100, updatedAt: new Date("2026-09-03T12:00:00.000Z"),
      },
    ] });

    await rebuildRelativeMuscleEpisodeTrajectories({ profileId: 5, fromDate: "2026-09-01", client: data.client });

    expect(data.deltaRows.map((row) => row.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(data.deltaRows[0]!.result).toMatchObject({
      availability: "available",
      estimatedSkeletalMuscleDeltaKg: 0,
      state: { relativeCumulativeDeltaKg: 0, absoluteSkeletalMuscleKg: null },
    });
    expect(data.deltaRows[0]!.features).toMatchObject({
      lineage: { episodeTimezone: "Europe/Bratislava", modelDate: "2026-09-01", dateOnlySourceTimezone: "Europe/Bratislava" },
    });
    expect(data.deltaRows[1]!.result).toMatchObject({
      availability: "unavailable",
      unavailableReason: "missing-energy-balance",
      state: { relativeCumulativeDeltaKg: null },
    });

    const prefixFingerprint = data.deltaRows[0]!.sourceFingerprint;
    data.deltaUpsertDates.length = 0;
    data.cessationUpsertDates.length = 0;
    const secondDay = data.client.dailyModelState as unknown as { findMany: ReturnType<typeof vi.fn> };
    secondDay.findMany.mockResolvedValue([
      {
        id: 1, episodeId: 17, date: "2026-09-01", status: "complete", modelVersion: "test-v7",
        energyBalanceKcal: -100, updatedAt: new Date("2026-09-03T12:00:00.000Z"),
      },
      {
        id: 2, episodeId: 17, date: "2026-09-02", status: "complete", modelVersion: "test-v7",
        energyBalanceKcal: -200, updatedAt: new Date("2026-09-04T12:00:00.000Z"),
      },
    ]);

    await rebuildRelativeMuscleEpisodeTrajectories({ profileId: 5, fromDate: "2026-09-02", client: data.client });

    expect(data.deltaUpsertDates).toEqual(["2026-09-02"]);
    expect(data.cessationUpsertDates).toEqual(["2026-09-02"]);
    expect(data.deltaRows[0]!.sourceFingerprint).toBe(prefixFingerprint);
    expect(data.deltaRows[1]!.result).toMatchObject({ availability: "available" });
  });

  it("falls back to the episode start when predecessor result lineage is incompatible", async () => {
    const data = fixture();
    await rebuildRelativeMuscleEpisodeTrajectories({ profileId: 5, fromDate: "2026-09-01", client: data.client });

    const priorResult = data.deltaRows[0]!.result as { state: { relativeCumulativeDeltaKg: number | null } };
    priorResult.state.relativeCumulativeDeltaKg = 12;
    data.deltaUpsertDates.length = 0;
    data.cessationUpsertDates.length = 0;

    await rebuildRelativeMuscleEpisodeTrajectories({ profileId: 5, fromDate: "2026-09-02", client: data.client });

    expect(data.deltaUpsertDates).toEqual(["2026-09-01", "2026-09-02"]);
    expect(data.cessationUpsertDates).toEqual(["2026-09-01", "2026-09-02"]);
    expect((data.deltaRows[0]!.result as { state: { relativeCumulativeDeltaKg: number } }).state.relativeCumulativeDeltaKg).toBe(0);
  });

  it("maps event instants to episode-local dates and fully replays without a compatible predecessor", async () => {
    const data = fixture();
    await rebuildRelativeMuscleEpisodeTrajectories({
      profileId: 5,
      fromInstant: new Date("2026-09-01T22:30:00.000Z"),
      client: data.client,
    });

    expect(data.deltaUpsertDates).toEqual(["2026-09-01", "2026-09-02"]);
    expect(data.deltaRows[1]!.date).toBe("2026-09-02");
    expect(data.deltaRows[1]!.features).toMatchObject({
      lineage: { episodeId: 17, episodeTimezone: "Europe/Bratislava", modelDate: "2026-09-02" },
    });
  });
});
