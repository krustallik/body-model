import {
  BODY_MAP_GROUP_CATALOG_V2,
  BODY_MAP_MEMBERSHIP_V2,
  BODY_MAP_TAXONOMY_V2,
  type AnatomyIdV2,
  type BodyMapGroupIdV2,
} from "@/modules/training/body-map-catalog-v2";

export const BODY_MAP_URL_STATE_CONTRACT_V1 = "bodycast-body-map-url-state-v1" as const;

export type BodyMapUrlViewV1 = "default" | "front" | "back" | "left" | "right";
export type BodyMapUrlModeV1 = "muscle" | "fascia" | "skeleton" | "both-context";

export type BodyMapUrlStateV1 = Readonly<{
  groupId: BodyMapGroupIdV2 | null;
  anatomyId: AnatomyIdV2 | null;
  view: BodyMapUrlViewV1;
  mode: BodyMapUrlModeV1;
  deep: boolean;
}>;

export const BODY_MAP_URL_OVERVIEW_V1: BodyMapUrlStateV1 = Object.freeze({
  groupId: null,
  anatomyId: null,
  view: "front",
  mode: "muscle",
  deep: false,
});

const groups = new Set<string>(BODY_MAP_GROUP_CATALOG_V2.map(({ id }) => id));
const anatomyIds = new Set<string>(BODY_MAP_TAXONOMY_V2.map(({ id }) => id));
const groupMemberships = new Map<string, BodyMapGroupIdV2[]>();
for (const { anatomyId, groupId } of BODY_MAP_MEMBERSHIP_V2) {
  groupMemberships.set(anatomyId, [...(groupMemberships.get(anatomyId) ?? []), groupId]);
}

const views = new Set<BodyMapUrlViewV1>(["default", "front", "back", "left", "right"]);
const modes = new Set<BodyMapUrlModeV1>(["muscle", "fascia", "skeleton", "both-context"]);
// `side` is retained only as an owned legacy query key so canonicalization removes it.
const ownedParams = ["group", "region", "side", "view", "mode", "deep"] as const;

function isGroupId(value: string | null): value is BodyMapGroupIdV2 {
  return value !== null && groups.has(value);
}

function isAnatomyId(value: string | null): value is AnatomyIdV2 {
  return value !== null && anatomyIds.has(value);
}

function membershipsFor(anatomyId: AnatomyIdV2) {
  return groupMemberships.get(anatomyId) ?? [];
}

/** Map a catalog camera to a named cardinal orientation when it is cardinal. */
export function defaultBodyMapGroupViewV1(groupId: BodyMapGroupIdV2): BodyMapUrlViewV1 {
  const group = BODY_MAP_GROUP_CATALOG_V2.find(({ id }) => id === groupId);
  if (!group) return "default";
  const [x, , z] = group.preferredDirection;
  if (Math.abs(x) < 0.001) return z < 0 ? "back" : "front";
  if (Math.abs(z) < 0.001) return x < 0 ? "left" : "right";
  return "default";
}

/** Default region camera may differ from the group overview camera for visibility. */
export function defaultBodyMapSubregionViewV1(groupId: BodyMapGroupIdV2): BodyMapUrlViewV1 {
  return groupId === "hip_adductors" ? "front" : defaultBodyMapGroupViewV1(groupId);
}

/** Parse a deep link and recover invalid selection to the nearest valid taxonomy state. */
export function parseBodyMapUrlStateV1(
  href: string | URL,
  options: { deepAnatomyIds?: ReadonlySet<string> } = {},
): BodyMapUrlStateV1 {
  const url = href instanceof URL ? href : new URL(href, "http://localhost");
  const query = url.searchParams;
  const rawGroup = query.get("group");
  const rawAnatomy = query.get("region");
  const validGroup = isGroupId(rawGroup) ? rawGroup : null;
  const validAnatomy = isAnatomyId(rawAnatomy) ? rawAnatomy : null;

  let groupId: BodyMapGroupIdV2 | null = validGroup;
  let anatomyId: AnatomyIdV2 | null = null;
  if (validAnatomy) {
    const memberships = membershipsFor(validAnatomy);
    if (!validGroup) {
      groupId = memberships[0] ?? null;
      anatomyId = groupId ? validAnatomy : null;
    } else if (memberships.includes(validGroup)) {
      anatomyId = validAnatomy;
    }
  }

  const rawView = query.get("view");
  const candidateView = rawView && views.has(rawView as BodyMapUrlViewV1)
    ? rawView as BodyMapUrlViewV1
    : groupId ? anatomyId ? defaultBodyMapSubregionViewV1(groupId) : defaultBodyMapGroupViewV1(groupId) : "front";
  const view = candidateView === "default" && !groupId ? "front"
    : candidateView === "default" && groupId && anatomyId ? defaultBodyMapSubregionViewV1(groupId)
      : candidateView;
  const rawMode = query.get("mode");
  const mode = rawMode && modes.has(rawMode as BodyMapUrlModeV1) ? rawMode as BodyMapUrlModeV1 : "muscle";
  let deep = query.get("deep") === "1";
  if (deep && anatomyId && options.deepAnatomyIds && !options.deepAnatomyIds.has(anatomyId)) deep = false;

  return {
    groupId,
    anatomyId,
    view,
    mode,
    deep,
  };
}

/** Serialize only durable Body Map state while retaining unrelated query parameters and hash. */
export function serializeBodyMapUrlStateV1(href: string | URL, state: BodyMapUrlStateV1): string {
  const url = href instanceof URL ? new URL(href.href) : new URL(href, "http://localhost");
  for (const key of ownedParams) url.searchParams.delete(key);

  if (state.groupId) url.searchParams.set("group", state.groupId);
  if (state.groupId && state.anatomyId) url.searchParams.set("region", state.anatomyId);
  if (state.groupId) {
    url.searchParams.set("view", state.view);
  } else if (state.view !== "front") {
    url.searchParams.set("view", state.view);
  }
  if (state.mode !== "muscle") url.searchParams.set("mode", state.mode);
  if (state.deep) url.searchParams.set("deep", "1");

  return `${url.pathname}${url.search}${url.hash}`;
}

export function isBodyMapUrlStateEqualV1(left: BodyMapUrlStateV1, right: BodyMapUrlStateV1) {
  return left.groupId === right.groupId
    && left.anatomyId === right.anatomyId
    && left.view === right.view
    && left.mode === right.mode
    && left.deep === right.deep;
}
