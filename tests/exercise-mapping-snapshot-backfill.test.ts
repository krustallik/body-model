import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyNullMuscleMappingSnapshotBackfill,
  historicalExerciseStableKey,
  muscleMappingSnapshotForCatalogStableKey,
  reportNullMuscleMappingSnapshotBackfill,
} from "@/modules/training/exercise-mapping-snapshot";
import { EXERCISE_MUSCLE_MAPPING_V7_VERSION } from "@/model/physiology-v7/exercise-muscle-mapping-v7";

function buildDb() {
  const order: string[] = [];
  type BackfillMock = {
    $executeRaw: ReturnType<typeof vi.fn>;
    strengthSessionExercise: {
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    order: string[];
  };
  const db = {
    $executeRaw: vi.fn(async () => { order.push("profile-lock"); return 1; }),
    strengthSessionExercise: {
      findMany: vi.fn(async () => { order.push("findMany"); return []; }),
      count: vi.fn(async () => { order.push("count"); return 0; }),
      updateMany: vi.fn(async () => { order.push("updateMany"); return { count: 0 }; }),
    },
    order,
  } as BackfillMock & { $transaction: ReturnType<typeof vi.fn> };
  db.$transaction = vi.fn(async (callback: (tx: BackfillMock) => Promise<unknown>) => callback(db));
  return db;
}

describe("null muscleMappingSnapshot backfill", () => {
  let db: ReturnType<typeof buildDb>;

  it("prefers immutable snapshot identity over mutable catalog identity", () => {
    const snapshot = muscleMappingSnapshotForCatalogStableKey("hyperextension");
    expect(historicalExerciseStableKey(snapshot, "pull_up")).toBe("hyperextension");
    expect(historicalExerciseStableKey({
      ...snapshot,
      mappingVersion: "bodycast-exercise-muscle-mapping-v7.1",
    }, "pull_up")).toBe("hyperextension");
    const customUnmappedSnapshot = muscleMappingSnapshotForCatalogStableKey("custom_personal_exercise");
    expect(historicalExerciseStableKey(customUnmappedSnapshot, "pull_up")).toBe("custom_personal_exercise");
    const explicitUnknownSnapshot = muscleMappingSnapshotForCatalogStableKey(null);
    expect(historicalExerciseStableKey(explicitUnknownSnapshot, "catalog_key_added_later")).toBeNull();
    expect(historicalExerciseStableKey(null, "pull_up")).toBe("pull_up");
    expect(historicalExerciseStableKey(null, null)).toBeNull();
  });

  beforeEach(() => {
    db = buildDb();
  });

  it("classifies eligible, unresolved, and already-mapped rows without mutating", async () => {
    db.strengthSessionExercise.findMany.mockResolvedValue([
      {
        id: 1,
        sourceExerciseCatalogId: 10,
        sourceExerciseCatalog: { id: 10, stableKey: "hyperextension" },
      },
      {
        id: 2,
        sourceExerciseCatalogId: 11,
        sourceExerciseCatalog: { id: 11, stableKey: null },
      },
      {
        id: 3,
        sourceExerciseCatalogId: null,
        sourceExerciseCatalog: null,
      },
      {
        id: 4,
        sourceExerciseCatalogId: 12,
        sourceExerciseCatalog: { id: 12, stableKey: "not_in_registry" },
      },
    ]);
    db.strengthSessionExercise.count.mockResolvedValue(9);

    const report = await reportNullMuscleMappingSnapshotBackfill(db as never);
    expect(report.mappingVersion).toBe(EXERCISE_MUSCLE_MAPPING_V7_VERSION);
    expect(report.totalNullSnapshotRows).toBe(4);
    expect(report.alreadyMappedRows).toBe(9);
    expect(report.eligibleMappedRows).toBe(1);
    expect(report.unresolvedRows).toBe(3);
    expect(report.stableKeysInvolved).toEqual(["hyperextension"]);
    expect(report.eligibleSessionExerciseIds).toEqual([1]);
    expect(db.strengthSessionExercise.updateMany).not.toHaveBeenCalled();
  });

  it("applies only to eligible null rows and never overwrites non-null snapshots", async () => {
    const nullRows = [
      {
        id: 1,
        sourceExerciseCatalogId: 10,
        sourceExerciseCatalog: { id: 10, stableKey: "hyperextension" },
      },
      {
        id: 2,
        sourceExerciseCatalogId: 11,
        sourceExerciseCatalog: { id: 11, stableKey: null },
      },
    ];
    db.strengthSessionExercise.findMany.mockImplementation(async (args: { select?: { sourceExerciseCatalogId?: boolean } }) => {
      db.order.push("findMany");
      if (args.select?.sourceExerciseCatalogId) return nullRows;
      return [{ id: 1, sourceExerciseCatalog: { stableKey: "hyperextension" } }];
    });
    db.strengthSessionExercise.count.mockResolvedValue(3);
    db.strengthSessionExercise.updateMany.mockResolvedValue({ count: 1 });

    const dryRun = await applyNullMuscleMappingSnapshotBackfill(db as never, { dryRun: true });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.updatedRows).toBe(0);
    expect(db.strengthSessionExercise.updateMany).not.toHaveBeenCalled();

    db.order.length = 0;
    const applied = await applyNullMuscleMappingSnapshotBackfill(db as never, { dryRun: false });
    expect(applied.dryRun).toBe(false);
    expect(applied.updatedRows).toBe(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.order[0]).toBe("profile-lock");
    expect(db.order.indexOf("profile-lock")).toBeLessThan(db.order.indexOf("findMany"));
    expect(db.strengthSessionExercise.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { id: 1 },
        ]),
      }),
      data: expect.objectContaining({
        muscleMappingSnapshot: expect.objectContaining({
          availability: "available",
          stableKey: "hyperextension",
        }),
      }),
    }));
  });
});
