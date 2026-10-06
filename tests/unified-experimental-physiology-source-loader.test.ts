import { describe, expect, it, vi } from "vitest";
import { EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION } from "@/model/physiology-v7/experimental-transient-exercise-water-v2";
import { EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION } from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import { EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import { UnifiedExperimentalPhysiologySourceLoaderV1 } from "@/model/unified-experimental-physiology-v1/source-loader";

function fakeClient(input: {
  completedIds?: number[];
  transientRows?: unknown[];
  relativeRows?: unknown[];
  relativeDeltaRows?: unknown[];
  episodes?: unknown[];
  workouts?: unknown[];
} = {}) {
  const daily = {
    id: 1, date: "2065-01-01", updatedAt: new Date("2065-01-01T12:00:00Z"), weightKg: 80,
    bodyFatPercent: null, caloriesKcal: 2_400, proteinG: 150, fatG: 70, carbsG: 250,
    steps: 8_000, walkingDistanceKm: null, workoutFeedObserved: true,
  };
  return {
    dailyHealthData: { findMany: vi.fn().mockResolvedValue([daily]) },
    workout: { findMany: vi.fn().mockResolvedValue(input.workouts ?? []) },
    strengthDiarySession: { findMany: vi.fn().mockImplementation((query: { where?: { status?: unknown } }) =>
      Promise.resolve(query.where?.status === "COMPLETED" ? (input.completedIds ?? []).map((id) => ({ id })) : [])) },
    healthActivityInterval: { findMany: vi.fn().mockResolvedValue([]) },
    healthSyncSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    heartRateSample: { findMany: vi.fn().mockResolvedValue([]) },
    restingHeartRateSample: { findMany: vi.fn().mockResolvedValue([]) },
    sleepSegment: { findMany: vi.fn().mockResolvedValue([]) },
    dailyModelState: { findMany: vi.fn().mockResolvedValue([]) },
    experimentalTransientExerciseWaterShadow: { findMany: vi.fn().mockResolvedValue(input.transientRows ?? []) },
    experimentalSkeletalMuscleDeltaShadow: { findMany: vi.fn().mockResolvedValue(input.relativeDeltaRows ?? []) },
    experimentalCessationDetrainingShadow: { findMany: vi.fn().mockResolvedValue(input.relativeRows ?? []) },
    modelEpisode: { findMany: vi.fn().mockResolvedValue(input.episodes ?? [
      { id: 1, startDate: "2065-01-01", timezone: "UTC", active: true, deactivatedAt: null },
    ]) },
  };
}

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);

function transientRow(input: { sessionId?: number; episodeId?: number; modelDate: string; eventInstant: string }) {
  const sessionId = input.sessionId ?? 11;
  const sourceFingerprint = `strength-session-${sessionId}`;
  return {
    id: 4,
    sessionId,
    updatedAt: new Date(input.eventInstant),
    sourceFingerprint,
    modelRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
    result: { impulse: {
      contractVersion: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
      modelEpisodeId: input.episodeId ?? 1,
      modelDate: input.modelDate,
      strengthDiarySessionId: sessionId,
      canonicalEventInstant: input.eventInstant,
      sourceFingerprint,
    } },
  };
}

describe("Unified V1 durable source loader", () => {
  it("is bounded by absolute instants and preserves missing versus observed fields", async () => {
    const client = fakeClient();
    const loader = new UnifiedExperimentalPhysiologySourceLoaderV1(client as never);
    const result = await loader.loadRange({ profileId: 1, fromInstant: utc("2065-01-01"), throughInstant: utc("2065-01-03") });
    expect(result.days).toHaveLength(2);
    expect(result.days[0]?.dailyHealthData?.steps).toBe(8_000);
    expect(result.days[1]?.dailyHealthData).toBeNull();
    expect(result.days[0]?.childModelRevisions.glycogenState).toBe("experimental-glycogen-state-v2");
    expect(result.days[0]?.childModelRevisions.transientWater).toBe("experimental-transient-exercise-water-v2-impulse-ledger");
    expect(client.workout.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { hiddenFromHistory: false, dailyHealthData: { date: { gte: "2064-12-30", lte: "2065-01-04" } } },
    }));
  });

  it("rejects empty or reversed absolute replay intervals", async () => {
    const loader = new UnifiedExperimentalPhysiologySourceLoaderV1(fakeClient() as never);
    await expect(loader.loadRange({ fromInstant: utc("2065-01-02"), throughInstant: utc("2065-01-01") }))
      .rejects.toThrow(/absolute replay interval/);
    await expect(loader.loadRange({ fromInstant: utc("2065-01-01"), throughInstant: utc("2065-01-01") }))
      .rejects.toThrow(/absolute replay interval/);
  });

  it("gates legacy V1 transient rows and refuses incomplete V2 coverage", async () => {
    const legacyRow = {
      id: 4, sessionId: 11, updatedAt: new Date(), sourceFingerprint: "legacy", modelRevision: "experimental-transient-exercise-water-v1",
      result: { transientWaterDeltaKg: { point: 0.4 } },
    };
    const v1Loader = new UnifiedExperimentalPhysiologySourceLoaderV1(fakeClient({ transientRows: [legacyRow] }) as never);
    const v1 = await v1Loader.loadRange({ fromInstant: utc("2065-01-01"), throughInstant: utc("2065-01-02") });
    expect(v1.days[0]?.childOutputs.transientWater).toEqual([]);

    const incompleteLoader = new UnifiedExperimentalPhysiologySourceLoaderV1(fakeClient({
      completedIds: [11], transientRows: [legacyRow],
    }) as never);
    await expect(incompleteLoader.loadRange({ fromInstant: utc("2065-01-01"), throughInstant: utc("2065-01-02") }))
      .rejects.toThrow(/incomplete V2 transient-water coverage/);
  });

  it("keeps episode-local boundaries across both date-line directions and permits a date with no boundary", async () => {
    const forward = new UnifiedExperimentalPhysiologySourceLoaderV1(fakeClient({ episodes: [
      { id: 1, startDate: "2065-01-01", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: null },
      { id: 2, startDate: "2065-01-03", timezone: "Etc/GMT+12", active: true, deactivatedAt: null },
    ] }) as never);
    const forwardRange = await forward.loadRange({
      fromInstant: new Date("2064-12-31T10:00:00.000Z"), throughInstant: new Date("2065-01-05T12:00:00.000Z"),
    });
    expect(forwardRange.days.map((day) => `${day.modelEpisodeId}|${day.date}`)).toEqual([
      "1|2065-01-01", "1|2065-01-02", "1|2065-01-03", "1|2065-01-04", "2|2065-01-03", "2|2065-01-04",
    ]);
    expect(forwardRange.days[3]?.boundaryAt).toBe("2065-01-03T10:00:00.000Z");
    expect(forwardRange.days[4]?.boundaryAt).toBe("2065-01-03T12:00:00.000Z");

    const reverse = new UnifiedExperimentalPhysiologySourceLoaderV1(fakeClient({ episodes: [
      { id: 1, startDate: "2065-01-01", timezone: "Etc/GMT+12", active: false, deactivatedAt: null },
      { id: 2, startDate: "2065-01-03", timezone: "Pacific/Kiritimati", active: true, deactivatedAt: null },
    ] }) as never);
    const reverseRange = await reverse.loadRange({
      fromInstant: new Date("2065-01-01T12:00:00.000Z"), throughInstant: new Date("2065-01-04T10:00:00.000Z"),
    });
    expect(reverseRange.days.map((day) => `${day.modelEpisodeId}|${day.date}`)).toEqual([
      "1|2065-01-01", "2|2065-01-03", "2|2065-01-04",
    ]);
  });

  it("maps the reverse date-line Strength impulse to its exact chronological model day", async () => {
    const event = "2065-01-03T11:00:00.000Z";
    const loader = new UnifiedExperimentalPhysiologySourceLoaderV1(fakeClient({
      completedIds: [11],
      episodes: [
        { id: 1, startDate: "2065-01-03", timezone: "Pacific/Kiritimati", active: false, deactivatedAt: new Date("2065-01-03T12:00:00.000Z") },
        { id: 2, startDate: "2065-01-03", timezone: "Etc/GMT+12", active: true, deactivatedAt: null },
      ],
      transientRows: [transientRow({ modelDate: "2065-01-04", eventInstant: event })],
    }) as never);
    const range = await loader.loadRange({
      fromInstant: new Date("2065-01-02T10:00:00.000Z"), throughInstant: new Date("2065-01-04T12:00:00.000Z"),
    });
    expect(range.days.map(({ modelEpisodeId, date, boundaryAt }) => [modelEpisodeId, date, boundaryAt])).toEqual([
      [1, "2065-01-03", "2065-01-02T10:00:00.000Z"],
      [1, "2065-01-04", "2065-01-03T10:00:00.000Z"],
      [2, "2065-01-03", "2065-01-03T12:00:00.000Z"],
    ]);
    expect(range.days[1]?.childOutputs.transientWater.map(({ sessionId }) => sessionId)).toEqual([11]);
    expect(range.days[2]?.childOutputs.transientWater).toEqual([]);
  });

  it("loads Relative Muscle by episode identity and excludes legacy or stale rows", async () => {
    const date = "2088-01-01";
    const activeEpisodeBoundary = new Date("2088-01-01T10:00:00.000Z");
    const client = fakeClient({
      episodes: [
        { id: 1, startDate: date, timezone: "Pacific/Kiritimati", active: false, deactivatedAt: activeEpisodeBoundary },
        { id: 2, startDate: date, timezone: "America/Adak", active: true, deactivatedAt: null },
      ],
      relativeDeltaRows: [
        { id: 21, modelEpisodeId: 1, date, isStale: false, modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, updatedAt: utc(date), sourceFingerprint: "delta-a", result: { contractVersion: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, marker: "delta-a" } },
        { id: 22, modelEpisodeId: 2, date, isStale: false, modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, updatedAt: utc(date), sourceFingerprint: "delta-b", result: { contractVersion: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, marker: "delta-b" } },
        { id: 23, modelEpisodeId: 2, date, isStale: true, modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, updatedAt: utc(date), sourceFingerprint: "stale", result: { contractVersion: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, marker: "stale" } },
        { id: 24, modelEpisodeId: null, date, isStale: false, modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, updatedAt: utc(date), sourceFingerprint: "legacy", result: { contractVersion: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION, marker: "legacy" } },
      ],
      relativeRows: [
        { id: 11, modelEpisodeId: 1, date, isStale: false, modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, updatedAt: utc(date), sourceFingerprint: "episode-a", result: { contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, marker: "episode-a" } },
        { id: 12, modelEpisodeId: 2, date, isStale: false, modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, updatedAt: utc(date), sourceFingerprint: "episode-b", result: { contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, marker: "episode-b" } },
        { id: 13, modelEpisodeId: 2, date, isStale: true, modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, updatedAt: utc(date), sourceFingerprint: "stale", result: { contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, marker: "stale" } },
        { id: 14, modelEpisodeId: null, date, isStale: false, modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, updatedAt: utc(date), sourceFingerprint: "legacy", result: { contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION, marker: "legacy" } },
      ],
    });
    const loader = new UnifiedExperimentalPhysiologySourceLoaderV1(client as never);
    const range = await loader.loadRange({
      profileId: 1,
      fromInstant: new Date("2087-12-31T10:00:00.000Z"),
      throughInstant: new Date("2088-01-02T00:00:00.000Z"),
    });

    const relativeByEpisode = new Map(range.days
      .filter(({ date: modelDate }) => modelDate === date)
      .map(({ modelEpisodeId, childOutputs }) => [
        modelEpisodeId,
        childOutputs.relativeMuscle.cumulative?.result as { marker?: string } | undefined,
      ]));
    expect(relativeByEpisode.get(1)?.marker).toBe("episode-a");
    expect(relativeByEpisode.get(2)?.marker).toBe("episode-b");
    const dailyByEpisode = new Map(range.days.filter(({ date: modelDate }) => modelDate === date)
      .map(({ modelEpisodeId, childOutputs }) => [modelEpisodeId, childOutputs.relativeMuscle.daily?.result as { marker?: string } | undefined]));
    expect(dailyByEpisode.get(1)?.marker).toBe("delta-a");
    expect(dailyByEpisode.get(2)?.marker).toBe("delta-b");
    expect(client.experimentalCessationDetrainingShadow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ modelEpisodeId: { not: null }, isStale: false }),
    }));
    expect(client.experimentalSkeletalMuscleDeltaShadow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ modelEpisodeId: { not: null }, isStale: false }),
    }));
  });

  it("fails closed when an eligible impulse has no boundary in a partial-day interval", async () => {
    const loader = new UnifiedExperimentalPhysiologySourceLoaderV1(fakeClient({
      completedIds: [11],
      episodes: [{ id: 1, startDate: "2065-01-03", timezone: "Pacific/Kiritimati", active: true, deactivatedAt: null }],
      transientRows: [transientRow({ modelDate: "2065-01-04", eventInstant: "2065-01-03T11:00:00.000Z" })],
    }) as never);
    await expect(loader.loadRange({
      fromInstant: new Date("2065-01-03T11:00:00.000Z"), throughInstant: new Date("2065-01-05T10:00:00.000Z"),
    })).rejects.toThrow(/missing episode model-day boundary/);
  });

  it("assigns exact-boundary events to the new episode-local day", async () => {
    const loader = new UnifiedExperimentalPhysiologySourceLoaderV1(fakeClient({
      completedIds: [11],
      episodes: [{ id: 1, startDate: "2065-01-03", timezone: "Pacific/Kiritimati", active: true, deactivatedAt: null }],
      transientRows: [transientRow({ modelDate: "2065-01-04", eventInstant: "2065-01-03T10:00:00.000Z" })],
    }) as never);
    const range = await loader.loadRange({
      fromInstant: new Date("2065-01-02T10:00:00.000Z"), throughInstant: new Date("2065-01-04T10:00:00.000Z"),
    });
    expect(range.days[1]?.date).toBe("2065-01-04");
    expect(range.days[1]?.childOutputs.transientWater.map(({ sessionId }) => sessionId)).toEqual([11]);
  });
});
