import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  buildExerciseMuscleMappingSnapshotV7,
  EXERCISE_MUSCLE_MAPPING_V7_VERSION,
  lookupExerciseMuscleMappingV7,
  type ExerciseMuscleMappingSnapshotV7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import { DEFAULT_TRAINING_PROFILE_ID } from "./training.constants";

export function muscleMappingSnapshotForCatalogStableKey(
  stableKey: string | null | undefined,
): ExerciseMuscleMappingSnapshotV7 {
  return buildExerciseMuscleMappingSnapshotV7(stableKey);
}

export function muscleMappingSnapshotJson(
  stableKey: string | null | undefined,
): Prisma.InputJsonValue {
  return muscleMappingSnapshotForCatalogStableKey(stableKey) as unknown as Prisma.InputJsonValue;
}

/** Historical rows may store SQL NULL or JSON null from earlier snapshotting. */
function nullMappingSnapshotWhere(): Prisma.StrengthSessionExerciseWhereInput {
  return {
    OR: [
      { muscleMappingSnapshot: { equals: Prisma.DbNull } },
      { muscleMappingSnapshot: { equals: Prisma.JsonNull } },
    ],
  };
}

export type MuscleMappingSnapshotBackfillReport = {
  mappingVersion: typeof EXERCISE_MUSCLE_MAPPING_V7_VERSION;
  totalNullSnapshotRows: number;
  alreadyMappedRows: number;
  eligibleMappedRows: number;
  unresolvedRows: number;
  stableKeysInvolved: string[];
  eligibleSessionExerciseIds: number[];
  unresolved: Array<{
    sessionExerciseId: number;
    sourceExerciseCatalogId: number | null;
    stableKey: string | null;
    reason: "missing-source-catalog" | "missing-stable-key" | "unregistered-stable-key";
  }>;
};

export type MuscleMappingSnapshotBackfillApplyResult = MuscleMappingSnapshotBackfillReport & {
  updatedRows: number;
  dryRun: boolean;
};

/**
 * Controlled classification for StrengthSessionExercise rows with null snapshots.
 * Match ONLY via ExerciseCatalog.stableKey — never by display name.
 */
export async function reportNullMuscleMappingSnapshotBackfill(
  db: PrismaClient,
  profileId = DEFAULT_TRAINING_PROFILE_ID,
): Promise<MuscleMappingSnapshotBackfillReport> {
  const nullRows = await db.strengthSessionExercise.findMany({
    where: {
      AND: [
        nullMappingSnapshotWhere(),
        { session: { profileId } },
      ],
    },
    select: {
      id: true,
      sourceExerciseCatalogId: true,
      sourceExerciseCatalog: { select: { id: true, stableKey: true } },
    },
    orderBy: { id: "asc" },
  });

  const alreadyMappedRows = await db.strengthSessionExercise.count({
    where: {
      AND: [
        { NOT: nullMappingSnapshotWhere() },
        { session: { profileId } },
      ],
    },
  });

  const eligibleSessionExerciseIds: number[] = [];
  const stableKeySet = new Set<string>();
  const unresolved: MuscleMappingSnapshotBackfillReport["unresolved"] = [];

  for (const row of nullRows) {
    if (!row.sourceExerciseCatalog) {
      unresolved.push({
        sessionExerciseId: row.id,
        sourceExerciseCatalogId: row.sourceExerciseCatalogId,
        stableKey: null,
        reason: "missing-source-catalog",
      });
      continue;
    }

    const stableKey = row.sourceExerciseCatalog.stableKey;
    if (stableKey == null || stableKey === "") {
      unresolved.push({
        sessionExerciseId: row.id,
        sourceExerciseCatalogId: row.sourceExerciseCatalogId,
        stableKey: null,
        reason: "missing-stable-key",
      });
      continue;
    }

    if (!lookupExerciseMuscleMappingV7(stableKey)) {
      unresolved.push({
        sessionExerciseId: row.id,
        sourceExerciseCatalogId: row.sourceExerciseCatalogId,
        stableKey,
        reason: "unregistered-stable-key",
      });
      continue;
    }

    eligibleSessionExerciseIds.push(row.id);
    stableKeySet.add(stableKey);
  }

  return {
    mappingVersion: EXERCISE_MUSCLE_MAPPING_V7_VERSION,
    totalNullSnapshotRows: nullRows.length,
    alreadyMappedRows,
    eligibleMappedRows: eligibleSessionExerciseIds.length,
    unresolvedRows: unresolved.length,
    stableKeysInvolved: [...stableKeySet].sort((a, b) => a.localeCompare(b)),
    eligibleSessionExerciseIds,
    unresolved,
  };
}

/**
 * Apply approved V7 snapshots to eligible null rows only.
 * Never overwrites non-null snapshots; never mutates workouts/programs/sets.
 */
export async function applyNullMuscleMappingSnapshotBackfill(
  db: PrismaClient,
  options: { dryRun?: boolean; profileId?: number } = {},
): Promise<MuscleMappingSnapshotBackfillApplyResult> {
  const dryRun = options.dryRun ?? true;
  const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
  const report = await reportNullMuscleMappingSnapshotBackfill(db, profileId);

  if (dryRun || report.eligibleSessionExerciseIds.length === 0) {
    return { ...report, updatedRows: 0, dryRun };
  }

  const eligibleRows = await db.strengthSessionExercise.findMany({
    where: {
      AND: [
        { id: { in: report.eligibleSessionExerciseIds } },
        nullMappingSnapshotWhere(),
        { session: { profileId } },
      ],
    },
    select: {
      id: true,
      sourceExerciseCatalog: { select: { stableKey: true } },
    },
  });

  let updatedRows = 0;
  for (const row of eligibleRows) {
    const stableKey = row.sourceExerciseCatalog?.stableKey ?? null;
    const snapshot = muscleMappingSnapshotForCatalogStableKey(stableKey);
    if (snapshot.availability !== "available") continue;

    const result = await db.strengthSessionExercise.updateMany({
      where: {
        AND: [
          { id: row.id },
          nullMappingSnapshotWhere(),
        ],
      },
      data: {
        muscleMappingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    updatedRows += result.count;
  }

  return { ...report, updatedRows, dryRun: false };
}
