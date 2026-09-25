import { describe, expect, it } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import {
  aggregateExerciseAnatomyExposureV1,
  ANATOMY_ANALYTICS_CROSSWALK_V1,
  ANATOMY_ANALYTICS_GROUP_DEFINITIONS_V1,
  ANATOMY_ANALYTICS_GROUP_IDS_V1,
  ANATOMY_EVIDENCE_SOURCES_V1,
  ANATOMY_TAXONOMY_V1,
  ANATOMY_VISUAL_REPRESENTATION_V1,
  buildExerciseAnatomySnapshotV1,
  EXERCISE_ANATOMY_MAPPING_REGISTRY_V1,
  exerciseMappingSnapshotWithAnatomyV1,
  parseExerciseAnatomySnapshotFromCombinedV1,
  retrospectiveExerciseAnatomyInterpretationV1,
  resolveStoredExerciseAnatomySnapshotV1,
  stableVisualRegionIdV1,
  validateExerciseAnatomyRegistryV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";
import {
  buildExerciseMuscleMappingSnapshotV7,
  EXERCISE_MUSCLE_MAPPING_V7_VERSION,
  parseExerciseMuscleMappingSnapshotV7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";

describe("versioned exercise anatomy mapping v1", () => {
  it("covers each canonical stable key and validates taxonomy, crosswalk, and evidence references", () => {
    expect(validateExerciseAnatomyRegistryV1(CANONICAL_EXERCISE_IDENTITIES.map(({ stableKey }) => stableKey))).toEqual([]);
    expect(EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.size).toBe(13);
    expect(ANATOMY_ANALYTICS_GROUP_IDS_V1).toEqual([
      "chest", "deltoids", "triceps", "back", "biceps", "forearms", "spinal_extensors", "hip_extensors",
    ]);
    expect(new Set(ANATOMY_TAXONOMY_V1.map(({ id }) => id)).size).toBe(ANATOMY_TAXONOMY_V1.length);
    expect(new Set(ANATOMY_EVIDENCE_SOURCES_V1.map(({ id }) => id)).size).toBe(ANATOMY_EVIDENCE_SOURCES_V1.length);
    expect(new Set(ANATOMY_VISUAL_REPRESENTATION_V1.map(({ anatomyId }) => anatomyId))).toEqual(
      new Set(ANATOMY_TAXONOMY_V1.map(({ id }) => id)),
    );
    expect(ANATOMY_VISUAL_REPRESENTATION_V1.every(({ currentAssetStatus }) =>
      currentAssetStatus === "unsupported-in-current-asset",
    )).toBe(true);
    for (const mapping of EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.values()) {
      expect(mapping.targets.length).toBeGreaterThan(0);
      expect(JSON.stringify(mapping)).not.toMatch(/"(?:weight|coefficient|percent|credit|stimulusScore)"\s*:/i);
    }
  });

  it("keeps anatomy graph and legacy-group semantics explicit", () => {
    expect(ANATOMY_TAXONOMY_V1.find(({ id }) => id === "brachialis")).toMatchObject({
      parentId: null,
      kind: "muscle",
    });
    expect(ANATOMY_TAXONOMY_V1.find(({ id }) => id === "hip_extensors")).toBeUndefined();
    expect(ANATOMY_ANALYTICS_GROUP_DEFINITIONS_V1.find(({ id }) => id === "hip_extensors")).toMatchObject({
      kind: "functional-group",
    });
    expect(ANATOMY_ANALYTICS_CROSSWALK_V1.filter(({ anatomyId }) => anatomyId === "deltoid_posterior").map(({ analyticsGroupId }) => analyticsGroupId)).toEqual(["deltoids"]);
    expect(ANATOMY_ANALYTICS_CROSSWALK_V1.filter(({ anatomyId }) => anatomyId.startsWith("erector_spinae")).map(({ analyticsGroupId }) => analyticsGroupId)).toEqual([
      "spinal_extensors", "spinal_extensors", "spinal_extensors",
    ]);
    expect(stableVisualRegionIdV1("deltoid_middle", "left")).toBe(
      "bodycast.visual-region.v1.deltoid_middle.left.main",
    );
    expect(() => stableVisualRegionIdV1("invented_muscle", "left")).toThrow(/Unknown anatomy ID/);
  });

  it("keeps broad anatomy distinct from movement-role claims and qualitative regional associations", () => {
    const incline = EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.get("incline_dumbbell_press_30deg")!;
    expect(incline.supportedRegionalAssociations).toEqual([
      expect.objectContaining({
        anatomyId: "pectoralis_major_clavicular_head",
        kind: "qualitative-non-exclusive-association",
      }),
    ]);
    expect(incline.unresolvedDetails).toContain("No exclusive upper-chest claim");
    expect(incline.targets.find(({ anatomyId }) => anatomyId === "triceps_brachii")?.coverage).toBe("parent-only");

    const lateralRaise = EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.get("one_arm_lateral_raise")!;
    expect(lateralRaise.supportedRegionalAssociations[0]?.anatomyId).toBe("deltoid_middle");
    expect(lateralRaise.supportedRegionalAssociations[0]?.kind).toBe("qualitative-non-exclusive-association");

    const triceps = EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.get("one_arm_cable_triceps_extension")!;
    expect(triceps.targets.map(({ anatomyId }) => anatomyId)).toEqual(["triceps_brachii"]);
  });

  it("does not resolve custom exercises by display-name similarity", () => {
    const custom = buildExerciseAnatomySnapshotV1("custom incline press");
    expect(custom).toMatchObject({
      availability: "unavailable",
      reason: "unregistered-stable-key",
      targets: [],
    });
    expect(resolveStoredExerciseAnatomySnapshotV1(exerciseMappingSnapshotWithAnatomyV1("custom incline press"))).toMatchObject({
      availability: "unavailable",
      stableKey: "custom incline press",
      reason: "unregistered-stable-key",
    });
    expect(buildExerciseAnatomySnapshotV1(null)).toMatchObject({
      availability: "unavailable",
      reason: "missing-stable-key",
      targets: [],
    });
    expect(parseExerciseAnatomySnapshotFromCombinedV1({
      anatomyMappingSnapshotV1: {
        ...buildExerciseAnatomySnapshotV1(null),
        stableKey: "pull_up",
      },
    })).toBeNull();
  });

  it("adds an immutable anatomy snapshot while V7 readers see the exact prior mapping", () => {
    const combined = exerciseMappingSnapshotWithAnatomyV1("pull_up");
    expect(parseExerciseMuscleMappingSnapshotV7(combined)).toEqual(buildExerciseMuscleMappingSnapshotV7("pull_up"));
    expect(parseExerciseAnatomySnapshotFromCombinedV1(combined)).toMatchObject({
      availability: "available",
      mappingVersion: "bodycast-exercise-anatomy-mapping-v1",
      stableKey: "pull_up",
      provenance: "versioned-registry-snapshot",
    });

    const unknown = exerciseMappingSnapshotWithAnatomyV1(null);
    expect(parseExerciseMuscleMappingSnapshotV7(unknown)).toEqual(buildExerciseMuscleMappingSnapshotV7(null));
    expect(parseExerciseAnatomySnapshotFromCombinedV1(unknown)).toMatchObject({
      availability: "unavailable",
      reason: "missing-stable-key",
    });
  });

  it("parses persisted JSON independent of object-key order and accepts V7.1 historical identity", () => {
    const combined = exerciseMappingSnapshotWithAnatomyV1("incline_dumbbell_press_30deg");
    const value = structuredClone(combined) as Record<string, unknown>;
    const anatomy = value.anatomyMappingSnapshotV1 as Record<string, unknown>;
    anatomy.targets = (anatomy.targets as Array<Record<string, unknown>>).map((target) => ({
      coverage: target.coverage,
      role: target.role,
      anatomyId: target.anatomyId,
    }));
    anatomy.movementConvention = {
      notRecorded: (anatomy.movementConvention as Record<string, unknown>).notRecorded,
      version: (anatomy.movementConvention as Record<string, unknown>).version,
      known: (anatomy.movementConvention as Record<string, unknown>).known,
      id: (anatomy.movementConvention as Record<string, unknown>).id,
    };
    expect(parseExerciseAnatomySnapshotFromCombinedV1(value)?.availability).toBe("available");

    const v71 = {
      ...buildExerciseMuscleMappingSnapshotV7("pull_up"),
      mappingVersion: "bodycast-exercise-muscle-mapping-v7.1",
    };
    expect(parseExerciseMuscleMappingSnapshotV7(v71)?.mappingVersion).toBe("bodycast-exercise-muscle-mapping-v7.1");
    expect(retrospectiveExerciseAnatomyInterpretationV1(v71)).toMatchObject({
      provenance: "retrospective-interpretation",
      stableKey: "pull_up",
      sourceSnapshotMappingVersion: "bodycast-exercise-muscle-mapping-v7.1",
    });

    const v72 = {
      ...buildExerciseMuscleMappingSnapshotV7("pull_up"),
      mappingVersion: EXERCISE_MUSCLE_MAPPING_V7_VERSION,
    };
    expect(retrospectiveExerciseAnatomyInterpretationV1(v72)).toMatchObject({
      provenance: "retrospective-interpretation",
      sourceSnapshotMappingVersion: "bodycast-exercise-muscle-mapping-v7.2",
    });
  });

  it("resolves old V7-only rows retrospectively and refuses mutable-catalog fallback", () => {
    const v71 = {
      ...buildExerciseMuscleMappingSnapshotV7("pull_up"),
      mappingVersion: "bodycast-exercise-muscle-mapping-v7.1",
    };
    expect(resolveStoredExerciseAnatomySnapshotV1(v71)).toMatchObject({
      availability: "available",
      provenance: "retrospective-interpretation",
      stableKey: "pull_up",
      sourceSnapshotMappingVersion: "bodycast-exercise-muscle-mapping-v7.1",
    });

    const badExtension = {
      ...v71,
      anatomyMappingSnapshotV1: { contractVersion: "wrong" },
    };
    expect(resolveStoredExerciseAnatomySnapshotV1(badExtension)).toMatchObject({
      availability: "unavailable",
      reason: "invalid-recorded-snapshot",
    });
  });

  it("derives retrospective interpretation from recorded stable identity without mutating the historical snapshot", () => {
    const recorded = buildExerciseMuscleMappingSnapshotV7("hyperextension");
    const before = structuredClone(recorded);
    const interpretation = retrospectiveExerciseAnatomyInterpretationV1(recorded);
    expect(interpretation).toMatchObject({
      availability: "available",
      provenance: "retrospective-interpretation",
      stableKey: "hyperextension",
      sourceSnapshotContract: "bodycast-exercise-muscle-mapping-snapshot-v7-1",
    });
    expect(recorded).toEqual(before);

    expect(retrospectiveExerciseAnatomyInterpretationV1(null)).toMatchObject({
      availability: "unavailable",
      reason: "invalid-recorded-snapshot",
    });
  });

  it("deduplicates physical sets across multiple anatomy targets and parent rollups", () => {
    const snapshot = buildExerciseAnatomySnapshotV1("incline_dumbbell_press_30deg");
    const summary = aggregateExerciseAnatomyExposureV1([
      { setId: "set-1", anatomySnapshot: snapshot },
      { setId: "set-1", anatomySnapshot: snapshot },
      { setId: "set-2", anatomySnapshot: snapshot },
      { setId: "set-3", anatomySnapshot: null },
    ]);

    expect(summary).toMatchObject({
      unit: "unique-recorded-strength-sets",
      recordedSetCount: 3,
      mappedSetCount: 2,
      unavailableSetCount: 1,
    });
    expect(summary.byAnalyticsGroupId).toEqual(expect.arrayContaining([
      { id: "chest", uniqueSetCount: 2 },
      { id: "deltoids", uniqueSetCount: 2 },
      { id: "triceps", uniqueSetCount: 2 },
    ]));
    expect(summary.byAnatomyId.find(({ id }) => id === "pectoralis_major")?.uniqueSetCount).toBe(2);
    expect(summary.byAnatomyId.find(({ id }) => id === "pectoralis_major_clavicular_head")?.uniqueSetCount).toBe(2);
    expect(summary.byAnalyticsGroupRole).toEqual(expect.arrayContaining([
      { id: "chest", role: "primary-mover", uniqueSetCount: 2 },
      { id: "deltoids", role: "secondary-mover", uniqueSetCount: 2 },
      { id: "triceps", role: "secondary-mover", uniqueSetCount: 2 },
    ]));
    expect(summary.byAnalyticsGroupRole.some(({ id, role }) => id === "chest" && role === "secondary-mover")).toBe(false);
  });

  it("keeps parent-only mappings broad and does not invent one-arm side counts", () => {
    const extension = EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.get("one_arm_cable_triceps_extension")!;
    const parentOnly = buildExerciseAnatomySnapshotV1(extension.stableKey);
    const oneArmRaise = buildExerciseAnatomySnapshotV1("one_arm_lateral_raise");
    const summary = aggregateExerciseAnatomyExposureV1([
      { setId: "physical-set-1", anatomySnapshot: parentOnly },
      { setId: "physical-set-2", anatomySnapshot: oneArmRaise },
    ]);
    expect(summary.byAnatomyId.find(({ id }) => id === "triceps_brachii")?.uniqueSetCount).toBe(1);
    expect(summary.byAnatomyId.some(({ id }) => id.startsWith("triceps_") && id !== "triceps_brachii")).toBe(false);
    expect(summary.recordedSetCount).toBe(2);
    expect(summary.byAnalyticsGroupId.find(({ id }) => id === "deltoids")?.uniqueSetCount).toBe(1);
    expect(summary.byAnatomyRole.filter(({ id }) => id === "deltoid_middle")).toEqual([
      { id: "deltoid_middle", role: "primary-mover", uniqueSetCount: 1 },
    ]);
    expect(oneArmRaise).not.toHaveProperty("side");
  });

  it("does not expose mutable registry maps or mapping arrays", () => {
    const mapping = EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.get("pull_up")!;
    expect(Object.isFrozen(mapping)).toBe(true);
    expect(Object.isFrozen(mapping.targets)).toBe(true);
    expect(Object.isFrozen(mapping.targets[0]?.evidenceIds)).toBe(true);
    expect("set" in EXERCISE_ANATOMY_MAPPING_REGISTRY_V1).toBe(false);
  });

  it("aggregates a future exercise mapping without an exercise-specific reducer branch", () => {
    const knownShape = buildExerciseAnatomySnapshotV1("supported_dumbbell_wrist_curl");
    expect(knownShape.availability).toBe("available");
    const futureCatalogEntry = {
      ...knownShape,
      stableKey: "future_catalog_exercise",
    } as typeof knownShape;
    const summary = aggregateExerciseAnatomyExposureV1([
      { setId: "future-set-1", anatomySnapshot: futureCatalogEntry },
    ]);
    expect(summary.byAnalyticsGroupId).toEqual([{ id: "forearms", uniqueSetCount: 1 }]);
  });

  it("keeps the exercise-to-analytics crosswalk explicit and within existing group IDs", () => {
    expect(ANATOMY_ANALYTICS_CROSSWALK_V1.some(({ anatomyId, analyticsGroupId }) =>
      anatomyId === "brachialis" && analyticsGroupId === "biceps",
    )).toBe(true);
    expect(ANATOMY_ANALYTICS_CROSSWALK_V1.some(({ anatomyId, analyticsGroupId }) =>
      anatomyId === "brachialis" && analyticsGroupId === "forearms",
    )).toBe(false);
    expect(ANATOMY_ANALYTICS_CROSSWALK_V1.some(({ anatomyId, analyticsGroupId }) =>
      anatomyId === "brachioradialis" && analyticsGroupId === "forearms",
    )).toBe(true);
    expect(ANATOMY_ANALYTICS_CROSSWALK_V1.some(({ anatomyId, analyticsGroupId }) =>
      anatomyId === "brachialis" && analyticsGroupId === "triceps",
    )).toBe(false);
  });
});
