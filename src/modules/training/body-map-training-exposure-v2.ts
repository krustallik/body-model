import {
  BODY_MAP_GROUP_CATALOG_V2,
  BODY_MAP_MEMBERSHIP_V2,
  BODY_MAP_TAXONOMY_V2,
  type BodyMapGroupIdV2,
} from "@/modules/training/body-map-catalog-v2";
import {
  EXERCISE_ANATOMY_MAPPING_REGISTRY_V1,
  type ExerciseAnatomyMappingV1,
  type ExerciseAnatomyRoleV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";

export const BODY_MAP_EXPOSURE_CONTRACT_V2 = "bodycast-body-map-training-exposure-v2" as const;
export const BODY_MAP_EXPOSURE_VERSION_V2 = "bodycast-body-map-training-exposure-v2.0.0" as const;

export type BodyMapExposureStatusV2 =
  | "recorded-direct"
  | "recorded-indirect"
  | "no-recorded-mapped-exposure"
  | "partial-mapping"
  | "unavailable";
export type BodyMapExposureSourceV2 = "DEMO DATA" | "canonical-analytics-contract" | "unavailable";
export type BodyMapGroupExposureV2 = {
  groupId: BodyMapGroupIdV2;
  source: BodyMapExposureSourceV2;
  status: BodyMapExposureStatusV2;
  directUniqueSetCount: number | null;
  indirectUniqueSetCount: number | null;
  totalUniqueSetCount: number | null;
  mappingCoverage: "complete-for-input" | "partial" | "unsupported" | "unknown";
  note: string;
};

export type ExerciseAnatomyProjectionInputV2 = {
  stableKey: string;
  mappingVersion: string;
  targets: readonly { anatomyId: string; role: ExerciseAnatomyRoleV1; coverage: string }[];
};
export type BodyMapExposureEventV2 = {
  kind: "strength-set";
  physicalSetId: string;
  exerciseStableKey: string;
  mapping: ExerciseAnatomyProjectionInputV2;
};
export type BodyMapExposureInputV2 = {
  source: BodyMapExposureSourceV2;
  events: readonly BodyMapExposureEventV2[];
  mappingCoverage: "complete-for-input" | "partial" | "unknown";
  unavailableGroupIds?: readonly BodyMapGroupIdV2[];
};

export type BodyMapProjectedTargetV2 = {
  groupId: BodyMapGroupIdV2;
  anatomyId: string;
  exposure: "direct" | "indirect";
  physicalSetId: string;
  exerciseStableKey: string;
  mappingVersion: string;
};

/** Projects recorded anatomy targets to the shared catalog; no physiological score is calculated. */
export function projectExerciseAnatomyToBodyMapV2(
  physicalSetId: string,
  mapping: ExerciseAnatomyProjectionInputV2,
): BodyMapProjectedTargetV2[] {
  const projected: BodyMapProjectedTargetV2[] = [];
  for (const target of mapping.targets) {
    const groupIds = BODY_MAP_GROUP_CATALOG_V2
      .filter(({ id }) => BODY_MAP_MEMBERSHIP_V2.some((pair) => pair.groupId === id && pair.anatomyId === target.anatomyId))
      .map(({ id }) => id);
    const exposure = target.role === "primary-mover"
      ? "direct"
      : target.role === "secondary-mover" || target.role === "stabilizer"
        ? "indirect"
        : null;
    if (!exposure) continue;
    for (const groupId of groupIds) projected.push({
      groupId,
      anatomyId: target.anatomyId,
      exposure,
      physicalSetId,
      exerciseStableKey: mapping.stableKey,
      mappingVersion: mapping.mappingVersion,
    });
  }
  return projected;
}

export function projectExerciseMappingToBodyMapV2(
  physicalSetId: string,
  mapping: ExerciseAnatomyMappingV1,
): BodyMapProjectedTargetV2[] {
  return projectExerciseAnatomyToBodyMapV2(physicalSetId, mapping);
}

export function deriveBodyMapExposureV2(input: BodyMapExposureInputV2): readonly BodyMapGroupExposureV2[] {
  const knownAnatomyIds = new Set<string>(BODY_MAP_TAXONOMY_V2.map(({ id }) => id));
  const seenSetIds = new Set<string>();
  const direct = new Map<BodyMapGroupIdV2, Set<string>>();
  const indirect = new Map<BodyMapGroupIdV2, Set<string>>();
  const targetAnatomy = new Map<BodyMapGroupIdV2, Set<string>>();
  const invalidEvents = new Set<string>();

  for (const event of input.events) {
    if (!event.physicalSetId) {
      invalidEvents.add("<missing-set-id>");
      continue;
    }
    if (seenSetIds.has(event.physicalSetId)) continue;
    seenSetIds.add(event.physicalSetId);
    if (event.mapping.targets.some(({ anatomyId }) => !knownAnatomyIds.has(anatomyId)
      || !BODY_MAP_MEMBERSHIP_V2.some((pair) => pair.anatomyId === anatomyId))) {
      invalidEvents.add(event.physicalSetId);
    }
    const projected = projectExerciseAnatomyToBodyMapV2(event.physicalSetId, event.mapping);
    for (const row of projected) {
      const map = row.exposure === "direct" ? direct : indirect;
      const values = map.get(row.groupId) ?? new Set<string>();
      values.add(row.physicalSetId);
      map.set(row.groupId, values);
      const anatomyValues = targetAnatomy.get(row.groupId) ?? new Set<string>();
      anatomyValues.add(row.anatomyId);
      targetAnatomy.set(row.groupId, anatomyValues);
    }
  }

  return Object.freeze(BODY_MAP_GROUP_CATALOG_V2.map(({ id: groupId }) => {
    const directCount = direct.get(groupId)?.size ?? 0;
    const indirectCount = indirect.get(groupId)?.size ?? 0;
    const uniqueCount = new Set([...(direct.get(groupId) ?? []), ...(indirect.get(groupId) ?? [])]).size;
    const unsupported = input.source === "unavailable" || input.unavailableGroupIds?.includes(groupId) === true;
    const hasExposure = uniqueCount > 0;
    const hasPartialTargets = [...(targetAnatomy.get(groupId) ?? [])].some((anatomyId) =>
      input.events.some((event) => event.mapping.targets.some((target) => target.anatomyId === anatomyId && target.coverage !== "supported")),
    );
    const mappingCoverage = unsupported
      ? "unsupported"
      : input.mappingCoverage === "unknown"
        ? "unknown"
        : input.mappingCoverage === "partial" || hasPartialTargets || invalidEvents.size > 0
          ? "partial"
          : "complete-for-input";
    const status: BodyMapExposureStatusV2 = unsupported
      ? "unavailable"
      : hasExposure && mappingCoverage !== "partial"
        ? directCount > 0 ? "recorded-direct" : "recorded-indirect"
        : hasExposure
          ? directCount > 0 ? "recorded-direct" : "recorded-indirect"
          : mappingCoverage === "partial" || mappingCoverage === "unknown"
            ? "partial-mapping"
            : "no-recorded-mapped-exposure";
    return Object.freeze({
      groupId,
      source: input.source,
      status,
      directUniqueSetCount: unsupported ? null : directCount,
      indirectUniqueSetCount: unsupported ? null : indirectCount,
      totalUniqueSetCount: unsupported ? null : uniqueCount,
      mappingCoverage,
      note: input.source === "DEMO DATA"
        ? "Deterministic demo fixture only; no user training history or physiological activity is inferred."
        : unsupported
          ? "The canonical analytics input does not provide this group."
          : "Mapped exposure describes recorded targets, not a physiological dose or proof of muscle inactivity.",
    });
  }));
}

/** An isolated deterministic UI fixture projected through the real exercise mapping registry. */
export function buildBodyMapDemoExposureFixtureV2(): readonly BodyMapGroupExposureV2[] {
  const fixtureExerciseSetIds = [
    { stableKey: "incline_dumbbell_press_30deg", physicalSetId: "demo-set-press-001" },
    { stableKey: "one_arm_seated_cable_row", physicalSetId: "demo-set-row-001" },
    { stableKey: "hyperextension", physicalSetId: "demo-set-extension-001" },
  ] as const;
  const events = fixtureExerciseSetIds.map(({ stableKey, physicalSetId }) => {
    const mapping = EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.get(stableKey);
    if (!mapping) throw new Error(`Missing demo exercise mapping ${stableKey}`);
    return {
      kind: "strength-set" as const,
      physicalSetId,
      exerciseStableKey: stableKey,
      mapping: {
        stableKey: mapping.stableKey,
        mappingVersion: mapping.mappingVersion,
        targets: mapping.targets.map(({ anatomyId, role, coverage }) => ({ anatomyId, role, coverage })),
      },
    };
  });
  return deriveBodyMapExposureV2({
    source: "DEMO DATA",
    events,
    mappingCoverage: "complete-for-input",
    unavailableGroupIds: ["rotator_cuff"],
  });
}
