import {
  ANATOMY_ANALYTICS_CROSSWALK_V1,
  ANATOMY_TAXONOMY_V1,
  type AnatomyAnalyticsGroupIdV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";

/** Visual/navigation catalog only. It does not extend physiology-v7 group IDs. */
export const BODY_MAP_CATALOG_CONTRACT_V2 = "bodycast-body-map-catalog-v2" as const;
export const BODY_MAP_CATALOG_VERSION_V2 = "bodycast-body-map-catalog-v2.0.0" as const;
export const BODY_MAP_TAXONOMY_VERSION_V2 = "bodycast-anatomy-taxonomy-v2" as const;
export const BODY_MAP_MEMBERSHIP_CONTRACT_V2 = "bodycast-body-map-membership-v2" as const;
export const BODY_MAP_MEMBERSHIP_VERSION_V2 = "bodycast-body-map-membership-v2.0.0" as const;

export type BodyMapAnatomyKindV2 = "muscle" | "muscle-part" | "functional-region";
export type BodyMapGroupKindV2 = "anatomical-group" | "functional-group";
export type BodyMapCameraDirectionV2 = readonly [number, number, number];
export type BodyMapFallbackAnchorV2 = readonly [number, number];

export const BODY_MAP_GROUP_CATALOG_V2 = Object.freeze(([
  { id: "chest", kind: "anatomical-group", label: "Chest", note: "Pectoral anatomy; head-level exposure remains distinct from the whole muscle.", preferredDirection: [0, 0, 1], fallbackAnchor: [50, 27] },
  { id: "deltoids", kind: "anatomical-group", label: "Deltoids", note: "Anterior, acromial and posterior deltoid regions.", preferredDirection: [0.48, 0, 1], fallbackAnchor: [31, 29] },
  { id: "triceps", kind: "anatomical-group", label: "Triceps", note: "Triceps brachii and source-supported heads.", preferredDirection: [0.48, 0, -1], fallbackAnchor: [76, 39] },
  { id: "back", kind: "anatomical-group", label: "Back", note: "Upper-back anatomy; spinal extensors stay in their own group.", preferredDirection: [0, 0, -1], fallbackAnchor: [50, 39] },
  { id: "biceps", kind: "anatomical-group", label: "Elbow flexors", note: "Legacy exercise analytics group; not a claim that every member is a biceps head.", preferredDirection: [-0.48, 0, 1], fallbackAnchor: [25, 38] },
  { id: "forearms", kind: "anatomical-group", label: "Forearms", note: "Forearm regions and brachioradialis.", preferredDirection: [0.55, 0, 1], fallbackAnchor: [19, 50] },
  { id: "spinal_extensors", kind: "anatomical-group", label: "Spinal extensors", note: "Erector-spinae regions, separate from the upper-back crosswalk.", preferredDirection: [0, 0, -1], fallbackAnchor: [50, 49] },
  { id: "hip_extensors", kind: "functional-group", label: "Hip extensors", note: "Legacy functional analytics grouping. It intentionally overlaps gluteal and hamstring views.", preferredDirection: [0.42, 0, -1], fallbackAnchor: [50, 64] },
  { id: "core", kind: "anatomical-group", label: "Abdominal wall", note: "Rectus, oblique and transversus abdominis structures.", preferredDirection: [0, 0, 1], fallbackAnchor: [50, 43] },
  { id: "quadriceps", kind: "anatomical-group", label: "Quadriceps", note: "Rectus femoris and three vasti.", preferredDirection: [0.2, 0, 1], fallbackAnchor: [39, 76] },
  { id: "hamstrings", kind: "anatomical-group", label: "Hamstrings", note: "Posterior-thigh muscles; the short head of biceps femoris is shown as a knee-flexor structure.", preferredDirection: [0.15, 0, -1], fallbackAnchor: [61, 76] },
  { id: "gluteals", kind: "anatomical-group", label: "Gluteals", note: "Gluteus maximus, medius and minimus.", preferredDirection: [0.42, 0, -1], fallbackAnchor: [50, 64] },
  { id: "hip_adductors", kind: "anatomical-group", label: "Hip adductors", note: "Source-supported medial-thigh adductors.", preferredDirection: [0, 0, -1], fallbackAnchor: [50, 76] },
  { id: "hip_abductors", kind: "functional-group", label: "Hip abductors", note: "Gluteus medius/minimus and tensor fasciae latae; overlapping memberships are intentional.", preferredDirection: [-0.55, 0, -1], fallbackAnchor: [35, 63] },
  { id: "hip_flexors", kind: "functional-group", label: "Hip flexors", note: "Iliacus and psoas major as distinct source structures.", preferredDirection: [0.45, 0, 1], fallbackAnchor: [45, 57] },
  { id: "calves", kind: "anatomical-group", label: "Calves", note: "Medial/lateral gastrocnemius and soleus.", preferredDirection: [0, 0, -1], fallbackAnchor: [54, 89] },
  { id: "anterior_lower_leg", kind: "anatomical-group", label: "Anterior lower leg", note: "Tibialis anterior and extensor digitorum longus.", preferredDirection: [0, 0, 1], fallbackAnchor: [39, 88] },
  { id: "lateral_lower_leg", kind: "anatomical-group", label: "Lateral lower leg", note: "Fibularis longus and brevis.", preferredDirection: [1, 0, 0], fallbackAnchor: [66, 87] },
  { id: "rotator_cuff", kind: "anatomical-group", label: "Rotator cuff", note: "Supraspinatus, infraspinatus, teres minor and subscapularis; deep surfaces can be occluded in overview.", preferredDirection: [0, 0, -1], fallbackAnchor: [68, 30] },
  { id: "serratus_anterior", kind: "anatomical-group", label: "Serratus anterior", note: "Bilateral source muscle; do not infer numeric exercise stimulus.", preferredDirection: [0.65, 0, 1], fallbackAnchor: [40, 37] },
] as const).map((entry) => Object.freeze({
  ...entry,
  preferredDirection: Object.freeze(entry.preferredDirection) as BodyMapCameraDirectionV2,
  fallbackAnchor: Object.freeze(entry.fallbackAnchor) as BodyMapFallbackAnchorV2,
  legacyAnalyticsGroupId: (ANATOMY_ANALYTICS_CROSSWALK_V1.some((pair) => pair.analyticsGroupId === entry.id)
    ? entry.id
    : null) as AnatomyAnalyticsGroupIdV1 | null,
})));

export type BodyMapGroupIdV2 = (typeof BODY_MAP_GROUP_CATALOG_V2)[number]["id"];
export type BodyMapGroupDefinitionV2 = (typeof BODY_MAP_GROUP_CATALOG_V2)[number];

export type BodyMapAnatomyNodeV2 = {
  id: string;
  parentId: string | null;
  kind: BodyMapAnatomyKindV2;
  label: string;
  versionIntroduced: typeof BODY_MAP_TAXONOMY_VERSION_V2 | "bodycast-anatomy-taxonomy-v1";
};

const additions: readonly BodyMapAnatomyNodeV2[] = [
  { id: "abdominal_wall", parentId: null, kind: "functional-region", label: "Abdominal wall", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "rectus_abdominis", parentId: "abdominal_wall", kind: "muscle", label: "Rectus abdominis", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "external_oblique", parentId: "abdominal_wall", kind: "muscle", label: "External abdominal oblique", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "internal_oblique", parentId: "abdominal_wall", kind: "muscle", label: "Internal abdominal oblique", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "transversus_abdominis", parentId: "abdominal_wall", kind: "muscle", label: "Transversus abdominis", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "quadriceps_femoris", parentId: null, kind: "functional-region", label: "Quadriceps femoris", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "rectus_femoris", parentId: "quadriceps_femoris", kind: "muscle", label: "Rectus femoris", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "vastus_lateralis", parentId: "quadriceps_femoris", kind: "muscle", label: "Vastus lateralis", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "vastus_medialis", parentId: "quadriceps_femoris", kind: "muscle", label: "Vastus medialis", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "vastus_intermedius", parentId: "quadriceps_femoris", kind: "muscle", label: "Vastus intermedius", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "posterior_thigh", parentId: null, kind: "functional-region", label: "Posterior thigh", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "biceps_femoris_short_head", parentId: "posterior_thigh", kind: "muscle-part", label: "Short head of biceps femoris", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "gluteus_medius", parentId: null, kind: "muscle", label: "Gluteus medius", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "gluteus_minimus", parentId: null, kind: "muscle", label: "Gluteus minimus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "adductor_region", parentId: null, kind: "functional-region", label: "Hip adductor region", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "adductor_longus", parentId: "adductor_region", kind: "muscle", label: "Adductor longus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "adductor_brevis", parentId: "adductor_region", kind: "muscle", label: "Adductor brevis", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "adductor_magnus", parentId: "adductor_region", kind: "muscle", label: "Adductor magnus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "gracilis", parentId: "adductor_region", kind: "muscle", label: "Gracilis", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "pectineus", parentId: "adductor_region", kind: "muscle", label: "Pectineus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "hip_abductor_region", parentId: null, kind: "functional-region", label: "Hip abductor region", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "tensor_fasciae_latae", parentId: "hip_abductor_region", kind: "muscle", label: "Tensor fasciae latae", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "hip_flexor_region", parentId: null, kind: "functional-region", label: "Hip flexor region", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "iliacus", parentId: "hip_flexor_region", kind: "muscle", label: "Iliacus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "psoas_major", parentId: "hip_flexor_region", kind: "muscle", label: "Psoas major", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "calf_complex", parentId: null, kind: "functional-region", label: "Calf complex", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "gastrocnemius_lateral_head", parentId: "calf_complex", kind: "muscle-part", label: "Lateral head of gastrocnemius", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "gastrocnemius_medial_head", parentId: "calf_complex", kind: "muscle-part", label: "Medial head of gastrocnemius", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "soleus", parentId: "calf_complex", kind: "muscle", label: "Soleus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "anterior_lower_leg_compartment", parentId: null, kind: "functional-region", label: "Anterior lower-leg compartment", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "tibialis_anterior", parentId: "anterior_lower_leg_compartment", kind: "muscle", label: "Tibialis anterior", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "extensor_digitorum_longus", parentId: "anterior_lower_leg_compartment", kind: "muscle", label: "Extensor digitorum longus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "lateral_lower_leg_compartment", parentId: null, kind: "functional-region", label: "Lateral lower-leg compartment", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "fibularis_longus", parentId: "lateral_lower_leg_compartment", kind: "muscle", label: "Fibularis longus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "fibularis_brevis", parentId: "lateral_lower_leg_compartment", kind: "muscle", label: "Fibularis brevis", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "rotator_cuff", parentId: null, kind: "functional-region", label: "Rotator cuff", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "supraspinatus", parentId: "rotator_cuff", kind: "muscle", label: "Supraspinatus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "infraspinatus", parentId: "rotator_cuff", kind: "muscle", label: "Infraspinatus", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "teres_minor", parentId: "rotator_cuff", kind: "muscle", label: "Teres minor", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "subscapularis", parentId: "rotator_cuff", kind: "muscle", label: "Subscapularis", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
  { id: "serratus_anterior", parentId: null, kind: "muscle", label: "Serratus anterior", versionIntroduced: BODY_MAP_TAXONOMY_VERSION_V2 },
];

export const BODY_MAP_TAXONOMY_V2 = Object.freeze([
  ...ANATOMY_TAXONOMY_V1.map((node) => Object.freeze({
    ...node,
    parentId: node.id === "hamstrings" ? "posterior_thigh" : node.parentId,
    versionIntroduced: "bodycast-anatomy-taxonomy-v1" as const,
  })),
  ...additions.map((node) => Object.freeze(node)),
]);
export type AnatomyIdV2 = (typeof BODY_MAP_TAXONOMY_V2)[number]["id"];

const addedPairs: readonly { anatomyId: AnatomyIdV2; groupId: BodyMapGroupIdV2 }[] = [
  { anatomyId: "abdominal_wall", groupId: "core" },
  ...(["rectus_abdominis", "external_oblique", "internal_oblique", "transversus_abdominis"] as const).map((anatomyId) => ({ anatomyId, groupId: "core" as const })),
  { anatomyId: "quadriceps_femoris", groupId: "quadriceps" },
  ...(["rectus_femoris", "vastus_lateralis", "vastus_medialis", "vastus_intermedius"] as const).map((anatomyId) => ({ anatomyId, groupId: "quadriceps" as const })),
  ...(["posterior_thigh", "hamstrings", "biceps_femoris_long_head", "biceps_femoris_short_head", "semitendinosus", "semimembranosus"] as const).map((anatomyId) => ({ anatomyId, groupId: "hamstrings" as const })),
  ...(["gluteus_maximus", "gluteus_medius", "gluteus_minimus"] as const).map((anatomyId) => ({ anatomyId, groupId: "gluteals" as const })),
  { anatomyId: "adductor_region", groupId: "hip_adductors" },
  ...(["adductor_longus", "adductor_brevis", "adductor_magnus", "gracilis", "pectineus"] as const).map((anatomyId) => ({ anatomyId, groupId: "hip_adductors" as const })),
  { anatomyId: "hip_abductor_region", groupId: "hip_abductors" },
  ...(["gluteus_medius", "gluteus_minimus", "tensor_fasciae_latae"] as const).map((anatomyId) => ({ anatomyId, groupId: "hip_abductors" as const })),
  { anatomyId: "hip_flexor_region", groupId: "hip_flexors" },
  ...(["iliacus", "psoas_major", "tensor_fasciae_latae"] as const).map((anatomyId) => ({ anatomyId, groupId: "hip_flexors" as const })),
  { anatomyId: "calf_complex", groupId: "calves" },
  ...(["gastrocnemius_lateral_head", "gastrocnemius_medial_head", "soleus"] as const).map((anatomyId) => ({ anatomyId, groupId: "calves" as const })),
  { anatomyId: "anterior_lower_leg_compartment", groupId: "anterior_lower_leg" },
  ...(["tibialis_anterior", "extensor_digitorum_longus"] as const).map((anatomyId) => ({ anatomyId, groupId: "anterior_lower_leg" as const })),
  { anatomyId: "lateral_lower_leg_compartment", groupId: "lateral_lower_leg" },
  ...(["fibularis_longus", "fibularis_brevis"] as const).map((anatomyId) => ({ anatomyId, groupId: "lateral_lower_leg" as const })),
  { anatomyId: "rotator_cuff", groupId: "rotator_cuff" },
  ...(["supraspinatus", "infraspinatus", "teres_minor", "subscapularis"] as const).map((anatomyId) => ({ anatomyId, groupId: "rotator_cuff" as const })),
  { anatomyId: "serratus_anterior", groupId: "serratus_anterior" },
];

export type BodyMapMembershipPairV2 = { anatomyId: AnatomyIdV2; groupId: BodyMapGroupIdV2 };
export const BODY_MAP_MEMBERSHIP_V2: readonly BodyMapMembershipPairV2[] = Object.freeze([
  ...ANATOMY_ANALYTICS_CROSSWALK_V1.map(({ anatomyId, analyticsGroupId }) => Object.freeze({ anatomyId: anatomyId as AnatomyIdV2, groupId: analyticsGroupId as BodyMapGroupIdV2 })),
  ...addedPairs.map((pair) => Object.freeze(pair)),
]);

export const BODY_MAP_PRIMARY_PICK_GROUP_BY_ANATOMY_ID_V2: Readonly<Partial<Record<AnatomyIdV2, BodyMapGroupIdV2>>> = Object.freeze({
  brachioradialis: "forearms",
  gluteus_maximus: "gluteals",
  gluteus_medius: "gluteals",
  gluteus_minimus: "gluteals",
  hamstrings: "hamstrings",
  biceps_femoris_long_head: "hamstrings",
  semitendinosus: "hamstrings",
  semimembranosus: "hamstrings",
  tensor_fasciae_latae: "hip_abductors",
});

export function bodyMapGroupIdsForAnatomyV2(anatomyIds: readonly string[]): BodyMapGroupIdV2[] {
  return BODY_MAP_GROUP_CATALOG_V2
    .map(({ id }) => id)
    .filter((groupId) => BODY_MAP_MEMBERSHIP_V2.some((pair) => pair.groupId === groupId && anatomyIds.includes(pair.anatomyId)));
}

export function primaryBodyMapGroupForAnatomyV2(anatomyIds: readonly string[]): BodyMapGroupIdV2 | null {
  for (const anatomyId of anatomyIds) {
    const explicit = BODY_MAP_PRIMARY_PICK_GROUP_BY_ANATOMY_ID_V2[anatomyId as AnatomyIdV2];
    if (explicit) return explicit;
  }
  return bodyMapGroupIdsForAnatomyV2(anatomyIds)[0] ?? null;
}

export function bodyMapAnatomySubtreeIdsV2(rootId: string): AnatomyIdV2[] {
  const ids = new Set<AnatomyIdV2>([rootId as AnatomyIdV2]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of BODY_MAP_TAXONOMY_V2) {
      if (node.parentId && ids.has(node.parentId as AnatomyIdV2) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return [...ids];
}

export function buildBodyMapGroupsV2() {
  return BODY_MAP_GROUP_CATALOG_V2.map((group) => ({
    ...group,
    subregions: BODY_MAP_MEMBERSHIP_V2
      .filter(({ groupId }) => groupId === group.id)
      .map(({ anatomyId }) => BODY_MAP_TAXONOMY_V2.find((node) => node.id === anatomyId)!)
      .filter((node, index, all) => all.findIndex((candidate) => candidate.id === node.id) === index),
  }));
}

export function validateBodyMapCatalogV2(): string[] {
  const errors: string[] = [];
  const groups = new Set(BODY_MAP_GROUP_CATALOG_V2.map(({ id }) => id));
  const anatomy = new Map(BODY_MAP_TAXONOMY_V2.map((node) => [node.id, node]));
  if (groups.size !== BODY_MAP_GROUP_CATALOG_V2.length) errors.push("duplicate body map group id");
  if (anatomy.size !== BODY_MAP_TAXONOMY_V2.length) errors.push("duplicate anatomy id across taxonomy versions");
  const pairs = new Set<string>();
  for (const { anatomyId, groupId } of BODY_MAP_MEMBERSHIP_V2) {
    const key = `${anatomyId}:${groupId}`;
    if (pairs.has(key)) errors.push(`duplicate anatomy/group membership ${key}`);
    pairs.add(key);
    if (!anatomy.has(anatomyId)) errors.push(`unknown anatomy id in membership ${key}`);
    if (!groups.has(groupId)) errors.push(`unknown body map group in membership ${key}`);
  }
  for (const node of BODY_MAP_TAXONOMY_V2) {
    if (node.parentId && !anatomy.has(node.parentId)) errors.push(`unknown parent ${node.parentId} for ${node.id}`);
    if (!BODY_MAP_MEMBERSHIP_V2.some((pair) => pair.anatomyId === node.id)) errors.push(`taxonomy node has no group membership ${node.id}`);
  }
  for (const group of BODY_MAP_GROUP_CATALOG_V2) {
    if (!BODY_MAP_MEMBERSHIP_V2.some((pair) => pair.groupId === group.id)) errors.push(`empty body map group ${group.id}`);
    const [x, y, z] = group.preferredDirection;
    if (!Number.isFinite(x + y + z) || Math.hypot(x, y, z) === 0) errors.push(`invalid camera direction ${group.id}`);
  }
  return errors;
}
