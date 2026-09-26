import {
  ANATOMY_ANALYTICS_CROSSWALK_V1,
  ANATOMY_ANALYTICS_GROUP_DEFINITIONS_V1,
  ANATOMY_ANALYTICS_GROUP_IDS_V1,
  ANATOMY_TAXONOMY_V1,
  ANATOMY_TAXONOMY_V1_VERSION,
  ANATOMY_VISUAL_REPRESENTATION_V1,
  ANATOMY_VISUAL_REPRESENTATION_V1_VERSION,
  type AnatomyAnalyticsGroupIdV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";

export const BODY_MAP_HIERARCHY_CONTRACT_V1 = "bodycast-body-map-hierarchy-v1" as const;
export const BODY_MAP_HIERARCHY_VERSION_V1 = "bodycast-body-map-hierarchy-v1.0.0" as const;
export const BODY_MAP_NAVIGATION_MEMBERSHIP_CONTRACT_V1 = "bodycast-body-map-navigation-membership-v1" as const;
export const BODY_MAP_NAVIGATION_MEMBERSHIP_VERSION_V1 = "bodycast-body-map-navigation-membership-v1.0.0" as const;

export type BodyMapNavigationLevelV1 = "OVERVIEW" | "GROUP_DETAIL" | "SUBREGION_DETAIL";
export type AnatomyIdV1 = (typeof ANATOMY_TAXONOMY_V1)[number]["id"];
export type BodyMapNavigationStateV1 = {
  level: BodyMapNavigationLevelV1;
  analyticsGroupId: AnatomyAnalyticsGroupIdV1 | null;
  anatomyId: AnatomyIdV1 | null;
};
export type BodyMapNavigationActionV1 =
  | { type: "SELECT_GROUP"; analyticsGroupId: AnatomyAnalyticsGroupIdV1 }
  | { type: "SELECT_SUBREGION"; anatomyId: AnatomyIdV1 }
  | { type: "BACK" }
  | { type: "OVERVIEW" }
  | { type: "CAMERA_ORBITED" };

export const BODY_MAP_OVERVIEW_STATE_V1: BodyMapNavigationStateV1 = Object.freeze({
  level: "OVERVIEW",
  analyticsGroupId: null,
  anatomyId: null,
});

/**
 * UI navigation membership is an explicit, versioned crosswalk. It references
 * anatomy IDs and never changes their anatomical parent-child relationships.
 */
/**
 * Navigation membership is the shared anatomy-to-group crosswalk, versioned
 * separately from exercise targets. This retains parent and child IDs and the
 * intentional brachioradialis membership in both groups.
 */
export const BODY_MAP_NAVIGATION_MEMBERSHIP_V1 = Object.freeze({
  contract: BODY_MAP_NAVIGATION_MEMBERSHIP_CONTRACT_V1,
  version: BODY_MAP_NAVIGATION_MEMBERSHIP_VERSION_V1,
  pairs: Object.freeze(ANATOMY_ANALYTICS_CROSSWALK_V1.map(({ anatomyId, analyticsGroupId }) =>
    Object.freeze({ anatomyId: anatomyId as AnatomyIdV1, analyticsGroupId }),
  )),
  primaryPickGroupByAnatomyId: Object.freeze({ brachioradialis: "forearms" as const }),
});

const mutableSubregionIdsByGroupV1 = Object.fromEntries(
  ANATOMY_ANALYTICS_GROUP_IDS_V1.map((groupId) => [
    groupId,
    BODY_MAP_NAVIGATION_MEMBERSHIP_V1.pairs
      .filter((entry) => entry.analyticsGroupId === groupId)
      .map((entry) => entry.anatomyId),
  ]),
) as unknown as Record<AnatomyAnalyticsGroupIdV1, readonly AnatomyIdV1[]>;

export const BODY_MAP_GROUP_SUBREGION_IDS_V1 = Object.freeze(
  Object.fromEntries(
    ANATOMY_ANALYTICS_GROUP_IDS_V1.map((groupId) => [
      groupId,
      Object.freeze([...mutableSubregionIdsByGroupV1[groupId]]),
    ]),
  ) as Record<AnatomyAnalyticsGroupIdV1, readonly AnatomyIdV1[]>,
);

export function primaryBodyMapPickGroupV1(
  anatomyIds: readonly AnatomyIdV1[],
): AnatomyAnalyticsGroupIdV1 | null {
  for (const anatomyId of anatomyIds) {
    const explicit = BODY_MAP_NAVIGATION_MEMBERSHIP_V1.primaryPickGroupByAnatomyId[
      anatomyId as keyof typeof BODY_MAP_NAVIGATION_MEMBERSHIP_V1.primaryPickGroupByAnatomyId
    ];
    if (explicit) return explicit;
  }
  return BODY_MAP_NAVIGATION_MEMBERSHIP_V1.pairs.find((entry) => anatomyIds.includes(entry.anatomyId))?.analyticsGroupId ?? null;
}

/** Camera interaction is deliberately outside navigation state. */
export function transitionBodyMapNavigationV1(
  state: BodyMapNavigationStateV1,
  action: BodyMapNavigationActionV1,
): BodyMapNavigationStateV1 {
  if (action.type === "OVERVIEW") return BODY_MAP_OVERVIEW_STATE_V1;
  if (action.type === "CAMERA_ORBITED") return state;
  if (action.type === "SELECT_GROUP") {
    return { level: "GROUP_DETAIL", analyticsGroupId: action.analyticsGroupId, anatomyId: null };
  }
  if (action.type === "SELECT_SUBREGION") {
    if (state.level !== "GROUP_DETAIL" || !state.analyticsGroupId) {
      throw new Error("Subregion selection requires GROUP_DETAIL state");
    }
    if (!(BODY_MAP_GROUP_SUBREGION_IDS_V1[state.analyticsGroupId] as readonly string[]).includes(action.anatomyId)) {
      throw new Error(`Subregion ${action.anatomyId} is not in ${state.analyticsGroupId}`);
    }
    return { ...state, level: "SUBREGION_DETAIL", anatomyId: action.anatomyId };
  }
  if (state.level === "SUBREGION_DETAIL") {
    return { level: "GROUP_DETAIL", analyticsGroupId: state.analyticsGroupId, anatomyId: null };
  }
  return BODY_MAP_OVERVIEW_STATE_V1;
}

export type BodyMapSubregionV1 = {
  anatomyId: AnatomyIdV1;
  label: string;
  parentAnatomyId: AnatomyIdV1 | null;
  kind: (typeof ANATOMY_TAXONOMY_V1)[number]["kind"];
  intendedRepresentation: (typeof ANATOMY_VISUAL_REPRESENTATION_V1)[number]["intendedRepresentation"];
  visualAvailability: "unsupported-in-current-asset";
  sideMode: "left-right" | "midline";
};

export type BodyMapGroupV1 = {
  analyticsGroupId: AnatomyAnalyticsGroupIdV1;
  kind: (typeof ANATOMY_ANALYTICS_GROUP_DEFINITIONS_V1)[number]["kind"];
  label: string;
  subregions: readonly BodyMapSubregionV1[];
};

/** A metric is absent/null when unsupported; consumers must not coerce it to zero. */
export type BodyMapMetricV1 = {
  status: "supported" | "partial" | "parent-only" | "unavailable";
  value: number | null;
  unit: string;
  reason: string | null;
};

export type BodyMapDetailPanelContractV1 = {
  anatomyId: AnatomyIdV1;
  analyticsGroupId: AnatomyAnalyticsGroupIdV1;
  taxonomyVersion: typeof ANATOMY_TAXONOMY_V1_VERSION;
  visualRepresentationVersion: typeof ANATOMY_VISUAL_REPRESENTATION_V1_VERSION;
  mappingVersion: string | null;
  provenance: "recorded-snapshot" | "retrospective-interpretation" | "demo-fixture" | "unavailable";
  coverage: "supported" | "partial" | "parent-only" | "unavailable";
  exerciseAssociations: readonly {
    exerciseStableKey: string;
    role: "primary-mover" | "secondary-mover" | "stabilizer" | "role-unspecified";
    coverage: "supported" | "partial" | "parent-only";
    mappedAnatomyId: AnatomyIdV1;
  }[];
  recordedSets: BodyMapMetricV1;
  repetitions: BodyMapMetricV1;
  externalLoadVolumeKgReps: BodyMapMetricV1;
  bandNominalVolumeIndexReps: BodyMapMetricV1;
  bodyweightExposure: {
    sets: BodyMapMetricV1;
    repetitions: BodyMapMetricV1;
  };
  rirContext: {
    unit: "self-reported RIR sets";
    groups: { "0-1": number | null; "2-3": number | null; "4+": number | null; unknown: number | null };
  };
  limitations: readonly string[];
};

export function buildBodyMapHierarchyV1(): readonly BodyMapGroupV1[] {
  const taxonomyById = new Map(ANATOMY_TAXONOMY_V1.map((node) => [node.id, node]));
  const visualById = new Map(ANATOMY_VISUAL_REPRESENTATION_V1.map((entry) => [entry.anatomyId, entry]));
  const definitionsById = new Map(ANATOMY_ANALYTICS_GROUP_DEFINITIONS_V1.map((group) => [group.id, group]));

  return Object.freeze(ANATOMY_ANALYTICS_GROUP_IDS_V1.map((analyticsGroupId) => {
    const definition = definitionsById.get(analyticsGroupId);
    if (!definition) throw new Error(`Missing analytics group definition: ${analyticsGroupId}`);
    const subregions = BODY_MAP_GROUP_SUBREGION_IDS_V1[analyticsGroupId].map((anatomyId) => {
      const node = taxonomyById.get(anatomyId);
      const visual = visualById.get(anatomyId);
      if (!node || !visual) throw new Error(`Missing shared anatomy/visual entry: ${anatomyId}`);
      if (!ANATOMY_ANALYTICS_CROSSWALK_V1.some((entry) =>
        entry.anatomyId === anatomyId && entry.analyticsGroupId === analyticsGroupId,
      )) throw new Error(`Subregion ${anatomyId} is not crosswalked to ${analyticsGroupId}`);
      return Object.freeze({
        anatomyId,
        label: node.label,
        parentAnatomyId: node.parentId,
        kind: node.kind,
        intendedRepresentation: visual.intendedRepresentation,
        visualAvailability: visual.currentAssetStatus,
        sideMode: visual.sideMode,
      });
    });
    return Object.freeze({ ...definition, analyticsGroupId, subregions: Object.freeze(subregions) });
  }));
}

export function validateBodyMapHierarchyV1(): readonly string[] {
  const errors: string[] = [];
  const knownGroups = new Set(ANATOMY_ANALYTICS_GROUP_IDS_V1);
  const taxonomyIds = new Set(ANATOMY_TAXONOMY_V1.map(({ id }) => id));
  const visualIds = new Set(ANATOMY_VISUAL_REPRESENTATION_V1.map(({ anatomyId }) => anatomyId));

  for (const groupId of Object.keys(mutableSubregionIdsByGroupV1)) {
    if (!knownGroups.has(groupId as AnatomyAnalyticsGroupIdV1)) errors.push(`Unknown group ${groupId}`);
  }
  for (const groupId of ANATOMY_ANALYTICS_GROUP_IDS_V1) {
    const subregionIds = BODY_MAP_GROUP_SUBREGION_IDS_V1[groupId];
    if (!subregionIds?.length) errors.push(`Missing subregions for ${groupId}`);
    if (new Set(subregionIds).size !== subregionIds.length) errors.push(`Duplicate subregion in ${groupId}`);
    for (const anatomyId of subregionIds) {
      if (!taxonomyIds.has(anatomyId)) errors.push(`Unknown anatomy ID ${anatomyId}`);
      if (!visualIds.has(anatomyId)) errors.push(`Missing visual status for ${anatomyId}`);
      if (!ANATOMY_ANALYTICS_CROSSWALK_V1.some((entry) =>
        entry.anatomyId === anatomyId && entry.analyticsGroupId === groupId,
      )) errors.push(`Missing group crosswalk ${anatomyId} -> ${groupId}`);
    }
  }
  const membershipPairs = BODY_MAP_NAVIGATION_MEMBERSHIP_V1.pairs;
  const pairKeys = membershipPairs.map(({ anatomyId, analyticsGroupId }) => `${anatomyId}:${analyticsGroupId}`);
  if (new Set(pairKeys).size !== pairKeys.length) errors.push("Duplicate navigation membership pair");
  if (pairKeys.length !== ANATOMY_ANALYTICS_CROSSWALK_V1.length) errors.push("Navigation membership differs from shared crosswalk");
  for (const entry of ANATOMY_ANALYTICS_CROSSWALK_V1) {
    if (!membershipPairs.some((pair) => pair.anatomyId === entry.anatomyId && pair.analyticsGroupId === entry.analyticsGroupId)) {
      errors.push(`Missing navigation membership ${entry.anatomyId} -> ${entry.analyticsGroupId}`);
    }
  }
  return errors;
}
