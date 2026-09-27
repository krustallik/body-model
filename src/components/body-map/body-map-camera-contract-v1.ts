import type { AnatomyAnalyticsGroupIdV1 } from "@/modules/training/exercise-anatomy-mapping-v1";

export const BODY_MAP_CAMERA_CONTRACT_V1 = "bodycast-body-map-camera-v1" as const;
export const BODY_MAP_CAMERA_VERSION_V1 = "bodycast-body-map-camera-v1.0.0" as const;
export const BODY_MAP_OVERVIEW_PADDING_FACTOR_V1 = 1.55 as const;

export const BODY_MAP_GROUP_CAMERA_DIRECTIONS_V1: Readonly<Record<AnatomyAnalyticsGroupIdV1, readonly [number, number, number]>> = Object.freeze({
  chest: Object.freeze([0, 0, 1] as const),
  deltoids: Object.freeze([0.48, 0, 1] as const),
  triceps: Object.freeze([0.48, 0, -1] as const),
  back: Object.freeze([0, 0, -1] as const),
  biceps: Object.freeze([-0.48, 0, 1] as const),
  forearms: Object.freeze([0.55, 0, 1] as const),
  spinal_extensors: Object.freeze([0, 0, -1] as const),
  hip_extensors: Object.freeze([0.48, 0, -1] as const),
});
