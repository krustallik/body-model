import { describe, expect, it, vi } from "vitest";
import { UnifiedExperimentalPhysiologySourceLoaderV1 } from "@/model/unified-experimental-physiology-v1/source-loader";

function fakeClient() {
  const daily = {
    id: 1, date: "2065-01-01", updatedAt: new Date("2065-01-01T12:00:00Z"), weightKg: 80,
    bodyFatPercent: null, caloriesKcal: 2_400, proteinG: 150, fatG: 70, carbsG: 250,
    steps: 8_000, walkingDistanceKm: null, workoutFeedObserved: true,
  };
  return {
    dailyHealthData: { findMany: vi.fn().mockResolvedValue([daily]) },
    workout: { findMany: vi.fn().mockResolvedValue([]) },
    strengthDiarySession: { findMany: vi.fn().mockResolvedValue([]) },
    healthActivityInterval: { findMany: vi.fn().mockResolvedValue([]) },
    healthSyncSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    heartRateSample: { findMany: vi.fn().mockResolvedValue([]) },
    restingHeartRateSample: { findMany: vi.fn().mockResolvedValue([]) },
    sleepSegment: { findMany: vi.fn().mockResolvedValue([]) },
    dailyModelState: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("Unified V1 durable source loader", () => {
  it("is date-bounded and preserves missing versus observed fields", async () => {
    const client = fakeClient();
    const loader = new UnifiedExperimentalPhysiologySourceLoaderV1(client as never);
    const result = await loader.loadRange({ profileId: 1, fromDate: "2065-01-01", toDate: "2065-01-02" });
    expect(result.days).toHaveLength(2);
    expect(result.days[0]?.dailyHealthData?.steps).toBe(8_000);
    expect(result.days[1]?.dailyHealthData).toBeNull();
    expect(result.days[0]?.childModelRevisions.glycogenState).toBe("experimental-glycogen-state-v2");
    expect(client.workout.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { hiddenFromHistory: false, dailyHealthData: { date: { gte: "2065-01-01", lte: "2065-01-02" } } },
    }));
  });

  it("rejects reversed ranges", async () => {
    const loader = new UnifiedExperimentalPhysiologySourceLoaderV1(fakeClient() as never);
    await expect(loader.loadRange({ fromDate: "2065-01-02", toDate: "2065-01-01" })).rejects.toThrow(/toDate/);
  });
});
