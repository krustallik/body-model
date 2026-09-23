import { describe, expect, it } from "vitest";
import {
  buildPlanningActivityAdapter,
  PLANNING_ADAPTER_DEFAULT_WALKING_SPEED_KMH,
  PLANNING_ADAPTER_DEFAULT_WORK_WALKING_DISTANCE_KM,
  PLANNING_ADAPTER_KM_PER_STEP,
} from "@/modules/planning-activity/planning-activity-adapter";

describe("planning activity adapter", () => {
  it("converts zero and 10,000 daily steps deterministically", () => {
    expect(PLANNING_ADAPTER_KM_PER_STEP).toBe(0.00075);
    expect(buildPlanningActivityAdapter(0).outsideWorkWalkingDistanceKm).toBe(0);
    expect(buildPlanningActivityAdapter(10_000).outsideWorkWalkingDistanceKm).toBe(7.5);
  });

  it("keeps the supported 100,000-step planning boundary within the legacy km contract", () => {
    expect(buildPlanningActivityAdapter(100_000).outsideWorkWalkingDistanceKm).toBe(75);
  });

  it("provides the shared planning defaults for speed and work walking", () => {
    expect(PLANNING_ADAPTER_DEFAULT_WALKING_SPEED_KMH).toBe(5);
    expect(PLANNING_ADAPTER_DEFAULT_WORK_WALKING_DISTANCE_KM).toBe(0);
    expect(buildPlanningActivityAdapter(8_000)).toEqual({
      outsideWorkWalkingDistanceKm: 6,
      averageWalkingSpeedKmh: 5,
      workWalkingDistanceKm: 0,
      workWalkingSpeedKmh: 5,
    });
  });
});
