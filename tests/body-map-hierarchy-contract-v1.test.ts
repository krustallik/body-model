import { describe, expect, it } from "vitest";
import {
  aggregateExerciseAnatomyExposureV1,
  ANATOMY_ANALYTICS_CROSSWALK_V1,
  ANATOMY_TAXONOMY_V1,
  buildExerciseAnatomySnapshotV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";
import {
  BODY_MAP_GROUP_SUBREGION_IDS_V1,
  BODY_MAP_HIERARCHY_CONTRACT_V1,
  BODY_MAP_OVERVIEW_STATE_V1,
  BODY_MAP_NAVIGATION_MEMBERSHIP_V1,
  buildBodyMapHierarchyV1,
  primaryBodyMapPickGroupV1,
  transitionBodyMapNavigationV1,
  validateBodyMapHierarchyV1,
} from "@/modules/training/body-map-hierarchy-contract-v1";

describe("versioned hierarchical Body Map contract v1", () => {
  it("derives navigation labels and visual status from the shared taxonomy", () => {
    expect(validateBodyMapHierarchyV1()).toEqual([]);
    expect(BODY_MAP_HIERARCHY_CONTRACT_V1).toBe("bodycast-body-map-hierarchy-v1");
    const groups = buildBodyMapHierarchyV1();
    expect(groups.map(({ analyticsGroupId }) => analyticsGroupId)).toEqual([
      "chest", "deltoids", "triceps", "back", "biceps", "forearms", "spinal_extensors", "hip_extensors",
    ]);
    expect(groups.find(({ analyticsGroupId }) => analyticsGroupId === "chest")?.subregions.map(({ anatomyId, label }) => ({ anatomyId, label }))).toEqual([
      { anatomyId: "pectoralis_major", label: "Pectoralis major" },
      { anatomyId: "pectoralis_major_clavicular_head", label: "Clavicular head of pectoralis major" },
      { anatomyId: "pectoralis_major_sternocostal_head", label: "Sternocostal head of pectoralis major" },
    ]);
    expect(groups.flatMap(({ subregions }) => subregions).every((item) =>
      taxonomyHas(item.anatomyId) && item.visualAvailability === "unsupported-in-current-asset",
    )).toBe(true);
  });

  it("contains every taxonomy ID and exactly the 35 shared group membership pairs", () => {
    expect(new Set(ANATOMY_TAXONOMY_V1.map(({ id }) => id)).size).toBe(34);
    expect(BODY_MAP_NAVIGATION_MEMBERSHIP_V1.contract).toBe("bodycast-body-map-navigation-membership-v1");
    expect(BODY_MAP_NAVIGATION_MEMBERSHIP_V1.pairs).toHaveLength(35);
    const hierarchyPairs = buildBodyMapHierarchyV1().flatMap((group) => group.subregions.map(({ anatomyId }) => `${anatomyId}:${group.analyticsGroupId}`));
    expect(new Set(hierarchyPairs)).toEqual(new Set(BODY_MAP_NAVIGATION_MEMBERSHIP_V1.pairs.map(({ anatomyId, analyticsGroupId }) => `${anatomyId}:${analyticsGroupId}`)));
    expect(BODY_MAP_GROUP_SUBREGION_IDS_V1.biceps).toContain("biceps_brachii_long_head");
    expect(BODY_MAP_GROUP_SUBREGION_IDS_V1.triceps).toContain("triceps_brachii");
    expect(BODY_MAP_GROUP_SUBREGION_IDS_V1.chest).toContain("pectoralis_major");
  });

  it("keeps functional group membership separate from anatomical parentage and prevents double classification", () => {
    const nodes = new Map(ANATOMY_TAXONOMY_V1.map((node) => [node.id, node]));
    expect(nodes.get("brachialis")?.parentId).toBeNull();
    expect(BODY_MAP_GROUP_SUBREGION_IDS_V1.biceps).toContain("brachialis");
    expect(BODY_MAP_GROUP_SUBREGION_IDS_V1.back).not.toContain("deltoid_posterior");
    expect(BODY_MAP_GROUP_SUBREGION_IDS_V1.spinal_extensors).toContain("erector_spinae");
    expect(BODY_MAP_GROUP_SUBREGION_IDS_V1.spinal_extensors).toContain("erector_spinae_lumbar_region");
    expect(ANATOMY_ANALYTICS_CROSSWALK_V1.filter(({ anatomyId }) => anatomyId === "deltoid_posterior")).toEqual([
      { anatomyId: "deltoid_posterior", analyticsGroupId: "deltoids" },
    ]);
  });

  it("keeps parent-only set exposure at group/parent level without manufacturing child values", () => {
    const snapshot = buildExerciseAnatomySnapshotV1("pushup_handles");
    const result = aggregateExerciseAnatomyExposureV1([
      { setId: "demo-pushup-set-1", anatomySnapshot: snapshot },
    ]);
    expect(result.byAnalyticsGroupId).toContainEqual({ id: "chest", uniqueSetCount: 1 });
    expect(result.byAnatomyId).toContainEqual({ id: "pectoralis_major", uniqueSetCount: 1 });
    expect(result.byAnatomyId).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pectoralis_major_clavicular_head" }),
      expect.objectContaining({ id: "pectoralis_major_sternocostal_head" }),
    ]));
    expect(result.recordedSetCount).toBe(1);
  });

  it("navigates overview, group, subregion, back, and orbit without dropping selection", () => {
    const group = transitionBodyMapNavigationV1(BODY_MAP_OVERVIEW_STATE_V1, {
      type: "SELECT_GROUP", analyticsGroupId: "deltoids",
    });
    expect(group).toMatchObject({ level: "GROUP_DETAIL", analyticsGroupId: "deltoids", anatomyId: null });
    const selected = transitionBodyMapNavigationV1(group, {
      type: "SELECT_SUBREGION", anatomyId: "deltoid_middle",
    });
    expect(selected).toMatchObject({ level: "SUBREGION_DETAIL", analyticsGroupId: "deltoids", anatomyId: "deltoid_middle" });
    expect(transitionBodyMapNavigationV1(selected, { type: "CAMERA_ORBITED" })).toBe(selected);
    expect(transitionBodyMapNavigationV1(selected, { type: "BACK" })).toMatchObject({
      level: "GROUP_DETAIL", analyticsGroupId: "deltoids", anatomyId: null,
    });
    expect(transitionBodyMapNavigationV1(group, { type: "BACK" })).toEqual(BODY_MAP_OVERVIEW_STATE_V1);
    expect(transitionBodyMapNavigationV1(selected, { type: "OVERVIEW" })).toEqual(BODY_MAP_OVERVIEW_STATE_V1);
    expect(() => transitionBodyMapNavigationV1(group, {
      type: "SELECT_SUBREGION", anatomyId: "latissimus_dorsi",
    })).toThrow(/not in deltoids/);
  });

  it("resolves overview picking without choosing an arbitrary shared anatomy alias", () => {
    expect(primaryBodyMapPickGroupV1(["brachioradialis"])).toBe("forearms");
    expect(BODY_MAP_GROUP_SUBREGION_IDS_V1.biceps).toContain("brachioradialis");
    expect(BODY_MAP_GROUP_SUBREGION_IDS_V1.forearms).toContain("brachioradialis");
    expect(primaryBodyMapPickGroupV1(["pectoralis_major_clavicular_head"])).toBe("chest");
    expect(primaryBodyMapPickGroupV1([])).toBeNull();
  });
});

function taxonomyHas(anatomyId: string): boolean {
  return ANATOMY_TAXONOMY_V1.some(({ id }) => id === anatomyId);
}
