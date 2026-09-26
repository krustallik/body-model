import {
  BODY_MAP_CATALOG_VERSION_V2,
  BODY_MAP_MEMBERSHIP_CONTRACT_V2,
  BODY_MAP_MEMBERSHIP_VERSION_V2,
  BODY_MAP_GROUP_CATALOG_V2,
  BODY_MAP_MEMBERSHIP_V2,
  BODY_MAP_TAXONOMY_V2,
  type AnatomyIdV2,
  type BodyMapGroupIdV2,
} from "@/modules/training/body-map-catalog-v2";

export const BODY_MAP_NAVIGATION_CONTRACT_V2 = "bodycast-body-map-navigation-v2" as const;
export const BODY_MAP_NAVIGATION_VERSION_V2 = "bodycast-body-map-navigation-v2.0.0" as const;

export type BodyMapNavigationLevelV2 = "OVERVIEW" | "GROUP_DETAIL" | "SUBREGION_DETAIL";
export type BodyMapNavigationStateV2 = {
  level: BodyMapNavigationLevelV2;
  groupId: BodyMapGroupIdV2 | null;
  anatomyId: AnatomyIdV2 | null;
};
export type BodyMapNavigationActionV2 =
  | { type: "SELECT_GROUP"; groupId: BodyMapGroupIdV2 }
  | { type: "SELECT_SUBREGION"; anatomyId: AnatomyIdV2 }
  | { type: "BACK" }
  | { type: "OVERVIEW" }
  | { type: "CAMERA_ORBITED" };

export const BODY_MAP_OVERVIEW_STATE_V2: BodyMapNavigationStateV2 = Object.freeze({
  level: "OVERVIEW",
  groupId: null,
  anatomyId: null,
});

export const BODY_MAP_NAVIGATION_MEMBERSHIP_V2 = Object.freeze({
  contract: BODY_MAP_MEMBERSHIP_CONTRACT_V2,
  version: BODY_MAP_MEMBERSHIP_VERSION_V2,
  catalogVersion: BODY_MAP_CATALOG_VERSION_V2,
  pairs: BODY_MAP_MEMBERSHIP_V2,
});

export function transitionBodyMapNavigationV2(
  state: BodyMapNavigationStateV2,
  action: BodyMapNavigationActionV2,
): BodyMapNavigationStateV2 {
  if (action.type === "OVERVIEW") return BODY_MAP_OVERVIEW_STATE_V2;
  if (action.type === "CAMERA_ORBITED") return state;
  if (action.type === "SELECT_GROUP") {
    if (!BODY_MAP_GROUP_CATALOG_V2.some(({ id }) => id === action.groupId)) throw new Error(`Unknown Body Map group: ${action.groupId}`);
    return { level: "GROUP_DETAIL", groupId: action.groupId, anatomyId: null };
  }
  if (action.type === "SELECT_SUBREGION") {
    if (state.level !== "GROUP_DETAIL" || !state.groupId) throw new Error("Subregion selection requires GROUP_DETAIL state");
    if (!BODY_MAP_NAVIGATION_MEMBERSHIP_V2.pairs.some(({ anatomyId, groupId }) => anatomyId === action.anatomyId && groupId === state.groupId)) {
      throw new Error(`Subregion ${action.anatomyId} is not in ${state.groupId}`);
    }
    return { ...state, level: "SUBREGION_DETAIL", anatomyId: action.anatomyId };
  }
  if (state.level === "SUBREGION_DETAIL") return { level: "GROUP_DETAIL", groupId: state.groupId, anatomyId: null };
  return BODY_MAP_OVERVIEW_STATE_V2;
}

export function validateBodyMapNavigationV2(): string[] {
  const errors: string[] = [];
  const groupIds = new Set(BODY_MAP_GROUP_CATALOG_V2.map(({ id }) => id));
  const anatomyIds = new Set(BODY_MAP_TAXONOMY_V2.map(({ id }) => id));
  const pairs = BODY_MAP_NAVIGATION_MEMBERSHIP_V2.pairs;
  const pairKeys = pairs.map(({ anatomyId, groupId }) => `${anatomyId}:${groupId}`);
  if (new Set(pairKeys).size !== pairKeys.length) errors.push("duplicate navigation membership pair");
  for (const { anatomyId, groupId } of pairs) {
    if (!anatomyIds.has(anatomyId)) errors.push(`unknown anatomy id ${anatomyId}`);
    if (!groupIds.has(groupId)) errors.push(`unknown group id ${groupId}`);
  }
  return errors;
}
