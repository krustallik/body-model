import {
  resolveStoredExerciseAnatomySnapshotV1,
  EXERCISE_ANATOMY_SNAPSHOT_PROPERTY as EXERCISE_ANATOMY_SNAPSHOT_V1_PROPERTY,
} from "./exercise-anatomy-mapping-v1";
import {
  EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY,
  parseExerciseAnatomySnapshotV2,
} from "./exercise-anatomy-mapping-v2";
import {
  buildExerciseAnatomySnapshotV3,
  EXERCISE_ANATOMY_SNAPSHOT_V3_PROPERTY,
  parseExerciseAnatomySnapshotV3,
} from "./exercise-anatomy-mapping-v3";

export type BodyMapExerciseMappingV3Projection = {
  stableKey: string;
  mappingVersion: string;
  targets: readonly { anatomyId: string; role: "primary-mover" | "secondary-mover" | "stabilizer" | "role-unspecified"; coverage: string }[];
};

function currentMapping(stableKey: string | null | undefined): BodyMapExerciseMappingV3Projection | null {
  const snapshot = buildExerciseAnatomySnapshotV3(stableKey);
  return snapshot ? {
    stableKey: snapshot.stableKey,
    mappingVersion: snapshot.mappingVersion,
    targets: snapshot.targets,
  } : null;
}

/**
 * Resolve an immutable exercise snapshot to the current, compatible Body Map
 * anatomy crosswalk. Old V1/V2 snapshots remain stored unchanged; only the
 * derived map interpretation advances to the versioned current registry.
 */
export function resolveBodyMapExerciseMappingV3(
  snapshotValue: unknown,
  sourceCatalogStableKey?: string | null,
): BodyMapExerciseMappingV3Projection | null {
  if (snapshotValue === null || snapshotValue === undefined) return currentMapping(sourceCatalogStableKey);
  if (!snapshotValue || typeof snapshotValue !== "object" || Array.isArray(snapshotValue)) return null;

  const record = snapshotValue as Record<string, unknown>;
  const hasV3 = Object.prototype.hasOwnProperty.call(record, EXERCISE_ANATOMY_SNAPSHOT_V3_PROPERTY);
  const hasV2 = Object.prototype.hasOwnProperty.call(record, EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY);
  const hasV1 = Object.prototype.hasOwnProperty.call(record, EXERCISE_ANATOMY_SNAPSHOT_V1_PROPERTY);

  // A present malformed snapshot is corruption, not permission to guess from the catalog.
  if (hasV2 && record[EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY] !== null
    && !parseExerciseAnatomySnapshotV2(record[EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY])) return null;
  if (hasV1) {
    const legacy = resolveStoredExerciseAnatomySnapshotV1(record);
    if (legacy.availability === "unavailable" && legacy.reason === "invalid-recorded-snapshot") return null;
  }

  if (hasV3 && record[EXERCISE_ANATOMY_SNAPSHOT_V3_PROPERTY] !== null) {
    const snapshot = parseExerciseAnatomySnapshotV3(record[EXERCISE_ANATOMY_SNAPSHOT_V3_PROPERTY]);
    return snapshot ? currentMapping(snapshot.stableKey) : null;
  }

  if (hasV2 && record[EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY] !== null) {
    const snapshot = parseExerciseAnatomySnapshotV2(record[EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY]);
    if (!snapshot) return null;
    return currentMapping(snapshot.stableKey) ?? {
      stableKey: snapshot.stableKey,
      mappingVersion: snapshot.mappingVersion,
      targets: snapshot.targets,
    };
  }

  const legacy = resolveStoredExerciseAnatomySnapshotV1(record);
  if (legacy.availability === "available") {
    return currentMapping(legacy.stableKey) ?? {
      stableKey: legacy.stableKey,
      mappingVersion: legacy.mappingVersion,
      targets: legacy.targets,
    };
  }
  if (legacy.stableKey) return currentMapping(legacy.stableKey);
  if (legacy.reason === "missing-stable-key" && sourceCatalogStableKey) return currentMapping(sourceCatalogStableKey);
  return null;
}
