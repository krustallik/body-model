import { describe, expect, it } from "vitest";
import {
  ANATOMY_ANALYTICS_GROUP_IDS_V1,
  ANATOMY_TAXONOMY_V1,
  EXERCISE_ANATOMY_MAPPING_REGISTRY_V1,
} from "@/modules/training/exercise-anatomy-mapping-v1";
import {
  BODY_MAP_CATALOG_VERSION_V2,
  BODY_MAP_GROUP_CATALOG_V2,
  BODY_MAP_MEMBERSHIP_V2,
  BODY_MAP_TAXONOMY_V2,
  bodyMapGroupIdsForAnatomyV2,
  validateBodyMapCatalogV2,
} from "@/modules/training/body-map-catalog-v2";
import {
  BODY_MAP_NAVIGATION_MEMBERSHIP_V2,
  BODY_MAP_OVERVIEW_STATE_V2,
  transitionBodyMapNavigationV2,
  validateBodyMapNavigationV2,
} from "@/modules/training/body-map-navigation-contract-v2";
import {
  buildBodyMapDemoExposureFixtureV2,
  deriveBodyMapExposureV2,
  projectExerciseAnatomyToBodyMapV2,
} from "@/modules/training/body-map-training-exposure-v2";

describe("Body Map catalog, navigation and exposure contracts v2", () => {
  it("extends the visual catalog without changing the canonical physiology group or historical v1 taxonomy registries", () => {
    expect(ANATOMY_ANALYTICS_GROUP_IDS_V1).toHaveLength(8);
    expect(ANATOMY_TAXONOMY_V1).toHaveLength(34);
    expect(BODY_MAP_CATALOG_VERSION_V2).toBe("bodycast-body-map-catalog-v2.0.0");
    expect(BODY_MAP_TAXONOMY_V2.length).toBeGreaterThan(ANATOMY_TAXONOMY_V1.length);
    expect(BODY_MAP_GROUP_CATALOG_V2.map(({ id }) => id)).toEqual([
      "chest", "deltoids", "triceps", "back", "biceps", "forearms", "spinal_extensors", "hip_extensors",
      "core", "quadriceps", "hamstrings", "gluteals", "hip_adductors", "hip_abductors", "hip_flexors",
      "calves", "anterior_lower_leg", "lateral_lower_leg", "rotator_cuff", "serratus_anterior",
    ]);
    expect(validateBodyMapCatalogV2()).toEqual([]);
    expect(validateBodyMapNavigationV2()).toEqual([]);
    expect(BODY_MAP_NAVIGATION_MEMBERSHIP_V2.pairs).toHaveLength(BODY_MAP_MEMBERSHIP_V2.length);
  });

  it("preserves legacy memberships and exposes source-supported bilateral lower-body/core/shoulder groups", () => {
    expect(bodyMapGroupIdsForAnatomyV2(["gluteus_maximus"])).toEqual(["hip_extensors", "gluteals"]);
    expect(bodyMapGroupIdsForAnatomyV2(["gluteus_medius"])).toEqual(["gluteals", "hip_abductors"]);
    expect(bodyMapGroupIdsForAnatomyV2(["rectus_femoris"])).toContain("quadriceps");
    expect(bodyMapGroupIdsForAnatomyV2(["transversus_abdominis"])).toContain("core");
    expect(bodyMapGroupIdsForAnatomyV2(["gastrocnemius_medial_head", "soleus"])).toEqual(["calves"]);
    expect(bodyMapGroupIdsForAnatomyV2(["supraspinatus"])).toContain("rotator_cuff");
    expect(BODY_MAP_TAXONOMY_V2.find(({ id }) => id === "biceps_femoris_short_head")?.parentId).toBe("posterior_thigh");
  });

  it("opens hip adductors from the back without changing the other catalog camera directions", () => {
    const directions = Object.fromEntries(BODY_MAP_GROUP_CATALOG_V2.map(({ id, preferredDirection }) => [id, preferredDirection]));
    expect(directions.hip_adductors).toEqual([0, 0, -1]);
    expect(directions).toMatchObject({
      chest: [0, 0, 1], deltoids: [0.48, 0, 1], triceps: [0.48, 0, -1], back: [0, 0, -1],
      biceps: [-0.48, 0, 1], forearms: [0.55, 0, 1], spinal_extensors: [0, 0, -1], hip_extensors: [0.42, 0, -1],
      core: [0, 0, 1], quadriceps: [0.2, 0, 1], hamstrings: [0.15, 0, -1], gluteals: [0.42, 0, -1],
      hip_abductors: [-0.55, 0, -1], hip_flexors: [0.45, 0, 1], calves: [0, 0, -1],
      anterior_lower_leg: [0, 0, 1], lateral_lower_leg: [1, 0, 0], rotator_cuff: [0, 0, -1], serratus_anterior: [0.65, 0, 1],
    });
  });

  it("uses the catalog for overview and subregion routing without manual UI group edits", () => {
    const selected = transitionBodyMapNavigationV2(BODY_MAP_OVERVIEW_STATE_V2, { type: "SELECT_GROUP", groupId: "quadriceps" });
    expect(selected).toEqual({ level: "GROUP_DETAIL", groupId: "quadriceps", anatomyId: null });
    expect(transitionBodyMapNavigationV2(selected, { type: "SELECT_SUBREGION", anatomyId: "vastus_lateralis" })).toMatchObject({
      level: "SUBREGION_DETAIL", groupId: "quadriceps", anatomyId: "vastus_lateralis",
    });
    expect(() => transitionBodyMapNavigationV2(selected, { type: "SELECT_SUBREGION", anatomyId: "soleus" })).toThrow(/not in quadriceps/);
  });

  it("projects a future exercise mapping into new groups and unions parent/child rows by physical set ID", () => {
    const futureMapping = {
      stableKey: "future_split_squat",
      mappingVersion: "bodycast-exercise-anatomy-mapping-v2.0.0",
      targets: [
        { anatomyId: "quadriceps_femoris", role: "primary-mover" as const, coverage: "supported" },
        { anatomyId: "vastus_lateralis", role: "primary-mover" as const, coverage: "supported" },
        { anatomyId: "gluteus_maximus", role: "secondary-mover" as const, coverage: "partial" },
      ],
    };
    const projected = projectExerciseAnatomyToBodyMapV2("future-set-01", futureMapping);
    expect(new Set(projected.map(({ groupId }) => groupId))).toEqual(new Set(["quadriceps", "hip_extensors", "gluteals"]));
    const exposure = deriveBodyMapExposureV2({
      source: "canonical-analytics-contract",
      mappingCoverage: "complete-for-input",
      events: [
        { kind: "strength-set", physicalSetId: "future-set-01", exerciseStableKey: "future_split_squat", mapping: futureMapping },
        { kind: "strength-set", physicalSetId: "future-set-01", exerciseStableKey: "future_split_squat", mapping: futureMapping },
      ],
    });
    expect(exposure.find(({ groupId }) => groupId === "quadriceps")).toMatchObject({ status: "recorded-direct", directUniqueSetCount: 1, totalUniqueSetCount: 1 });
    expect(exposure.find(({ groupId }) => groupId === "gluteals")).toMatchObject({ status: "recorded-indirect", indirectUniqueSetCount: 1, mappingCoverage: "partial" });
  });

  it("keeps direct, indirect, no-mapped, partial and unavailable states distinct in the explicit demo fixture", () => {
    const fixture = buildBodyMapDemoExposureFixtureV2();
    expect(fixture.every(({ source, note }) => source === "DEMO DATA" && note.includes("no user training history"))).toBe(true);
    expect(fixture.find(({ groupId }) => groupId === "chest")?.status).toBe("recorded-direct");
    expect(fixture.find(({ groupId }) => groupId === "deltoids")?.status).toBe("recorded-indirect");
    expect(fixture.find(({ groupId }) => groupId === "quadriceps")?.status).toBe("no-recorded-mapped-exposure");
    expect(fixture.find(({ groupId }) => groupId === "rotator_cuff")?.status).toBe("unavailable");
    expect(EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.size).toBe(13);
  });

  it("keeps unknown anatomy mapping coverage out of the zero-activity state", () => {
    const result = deriveBodyMapExposureV2({
      source: "canonical-analytics-contract",
      mappingCoverage: "complete-for-input",
      events: [{
        kind: "strength-set",
        physicalSetId: "future-set-unknown-target",
        exerciseStableKey: "future_exercise",
        mapping: {
          stableKey: "future_exercise",
          mappingVersion: "future-mapping-v1",
          targets: [{ anatomyId: "unregistered_anatomy", role: "primary-mover", coverage: "supported" }],
        },
      }],
    });
    expect(result.every(({ status, mappingCoverage }) => status === "partial-mapping" && mappingCoverage === "partial")).toBe(true);
    expect(result.every(({ status }) => status !== "no-recorded-mapped-exposure")).toBe(true);
  });
});
