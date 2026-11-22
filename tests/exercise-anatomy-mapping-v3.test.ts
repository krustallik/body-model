import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveExerciseInfo } from "@/app/training/exercise-info";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import { BODY_MAP_MEMBERSHIP_V2 } from "@/modules/training/body-map-catalog-v2";
import {
  buildExerciseAnatomySnapshotV1,
  exerciseMappingSnapshotWithAnatomyV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";
import {
  EXERCISE_ANATOMY_MAPPING_REGISTRY_V3,
  EXERCISE_ANATOMY_MAPPING_V3_VERSION,
  validateExerciseAnatomyMappingRegistryV3,
} from "@/modules/training/exercise-anatomy-mapping-v3";
import { projectExerciseAnatomyToBodyMapV2, projectStoredExerciseMappingToBodyMapV2 } from "@/modules/training/body-map-training-exposure-v2";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";

type PublicManifest = {
  anatomyCoverage: Array<{
    anatomyId: string;
    visualAvailability: string;
    representedMeshIds: string[];
  }>;
};

const publicManifest = JSON.parse(readFileSync(
  resolve(process.cwd(), "public/body-map/bodyparts3d-v3/manifest.json"),
  "utf8",
)) as PublicManifest;

describe("complete exercise-to-Body Map anatomy mapping v3", () => {
  it("maps every canonical local exercise to primary anatomy represented by the actual 3D manifest", () => {
    expect(validateExerciseAnatomyMappingRegistryV3()).toEqual([]);
    expect(EXERCISE_ANATOMY_MAPPING_REGISTRY_V3.size).toBe(CANONICAL_EXERCISE_IDENTITIES.length);

    for (const { stableKey } of CANONICAL_EXERCISE_IDENTITIES) {
      const mapping = EXERCISE_ANATOMY_MAPPING_REGISTRY_V3.get(stableKey)!;
      expect(mapping.targets.some(({ role }) => role === "primary-mover"), stableKey).toBe(true);

      for (const target of mapping.targets) {
        const visual = publicManifest.anatomyCoverage.find(({ anatomyId }) => anatomyId === target.anatomyId);
        expect(visual, `${stableKey} -> ${target.anatomyId} must exist in the public anatomy map`).toBeDefined();
        expect(visual?.visualAvailability, `${stableKey} -> ${target.anatomyId}`).toBe("represented");
        expect(visual?.representedMeshIds.length, `${stableKey} -> ${target.anatomyId}`).toBeGreaterThan(0);
        expect(BODY_MAP_MEMBERSHIP_V2.some(({ anatomyId }) => anatomyId === target.anatomyId), `${stableKey} -> ${target.anatomyId}`).toBe(true);
      }

      const projection = projectExerciseAnatomyToBodyMapV2("audit-set", {
        stableKey: mapping.stableKey,
        mappingVersion: EXERCISE_ANATOMY_MAPPING_V3_VERSION,
        targets: mapping.targets,
      });
      expect(projection.length, `${stableKey} must project onto at least one real Body Map group`).toBeGreaterThan(0);
      for (const target of mapping.targets) {
        expect(projection.some((row) => row.anatomyId === target.anatomyId
          && row.exposure === (target.role === "primary-mover" ? "direct" : "indirect")), `${stableKey} -> ${target.anatomyId}`).toBe(true);
      }
    }
  });

  it("keeps exercise-detail primary/secondary copy available for every canonical catalog row", () => {
    for (const { stableKey, displayName } of CANONICAL_EXERCISE_IDENTITIES) {
      expect(resolveExerciseInfo({ catalogName: displayName }), `${stableKey} should have exercise muscle details`).not.toBeNull();
    }
  });

  it("projects existing hyperextension history through the current mapping without rewriting its legacy snapshot", () => {
    const legacySnapshot = {
      ...buildExerciseMuscleMappingSnapshotV7("hyperextension"),
      anatomyMappingSnapshotV1: buildExerciseAnatomySnapshotV1("hyperextension"),
    };
    const before = structuredClone(legacySnapshot);
    const projected = projectStoredExerciseMappingToBodyMapV2("old-hyperextension-set", legacySnapshot);

    expect(projected).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: "spinal_extensors", anatomyId: "erector_spinae", exposure: "direct" }),
      expect.objectContaining({ groupId: "gluteals", anatomyId: "gluteus_maximus", exposure: "direct" }),
      expect.objectContaining({ groupId: "hamstrings", anatomyId: "hamstrings", exposure: "direct" }),
    ]));
    expect(legacySnapshot).toEqual(before);
  });

  it("keeps arbitrary custom exercises unavailable instead of inferring by display name", () => {
    const custom = exerciseMappingSnapshotWithAnatomyV1("Присідання — QA без мапінгу");
    expect(projectStoredExerciseMappingToBodyMapV2("custom-set", custom)).toEqual([]);
  });

  it("fails closed when a present v3 snapshot is malformed", () => {
    const snapshot = exerciseMappingSnapshotWithAnatomyV1("hyperextension") as Record<string, unknown>;
    snapshot.anatomyMappingSnapshotV3 = { contractVersion: "wrong" };
    expect(projectStoredExerciseMappingToBodyMapV2("bad-set", snapshot)).toEqual([]);
  });
});
