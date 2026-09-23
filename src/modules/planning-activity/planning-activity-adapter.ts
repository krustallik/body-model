/**
 * UI planning adapter defaults. These are convenience conversions for the
 * planning forms and do not define physiological model constants.
 */
export const PLANNING_ADAPTER_KM_PER_STEP = 0.00075;
export const PLANNING_ADAPTER_DEFAULT_WALKING_SPEED_KMH = 5;
export const PLANNING_ADAPTER_DEFAULT_WORK_WALKING_DISTANCE_KM = 0;

export type PlanningActivityAdapter = {
  outsideWorkWalkingDistanceKm: number;
  averageWalkingSpeedKmh: number;
  workWalkingDistanceKm: number;
  workWalkingSpeedKmh: number;
};

/** Converts the user's daily step target into the legacy internal km/speed shape. */
export function buildPlanningActivityAdapter(averageStepsPerDay: number): PlanningActivityAdapter {
  return {
    outsideWorkWalkingDistanceKm: averageStepsPerDay * PLANNING_ADAPTER_KM_PER_STEP,
    averageWalkingSpeedKmh: PLANNING_ADAPTER_DEFAULT_WALKING_SPEED_KMH,
    workWalkingDistanceKm: PLANNING_ADAPTER_DEFAULT_WORK_WALKING_DISTANCE_KM,
    workWalkingSpeedKmh: PLANNING_ADAPTER_DEFAULT_WALKING_SPEED_KMH,
  };
}
