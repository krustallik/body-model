import { describe, expect, it } from "vitest";
import {
  physicalGlycogenWaterDeltaV4,
  resolvePhysicalGlycogenWaterV4,
} from "@/model/body-composition/physical-glycogen-water-v4";

describe("physical glycogen and associated water V4", () => {
  it("uses the current production value and the canonical 2.7 multiplier", () => {
    expect(resolvePhysicalGlycogenWaterV4({
      productionRow: { status: "complete", glycogenKg: 0.5 },
      episodeInitialGlycogenKg: 0.9,
      episodeBaselineCarbIntakeG: 240,
    })).toEqual({
      availability: "available",
      glycogenKg: 0.5,
      glycogenWaterKg: 1.35,
      provenance: "production-daily-model-state",
      explicitZero: false,
    });
  });

  it("preserves explicit production zero as a distinct available value", () => {
    expect(resolvePhysicalGlycogenWaterV4({
      productionRow: { status: "complete", glycogenKg: 0 },
      episodeInitialGlycogenKg: 0.5,
      episodeBaselineCarbIntakeG: 240,
    })).toMatchObject({
      availability: "available",
      glycogenKg: 0,
      glycogenWaterKg: 0,
      provenance: "production-daily-model-state",
      explicitZero: true,
    });
  });

  it("blocks a present null production row instead of using episode initial state", () => {
    expect(resolvePhysicalGlycogenWaterV4({
      productionRow: { status: "complete", glycogenKg: null },
      episodeInitialGlycogenKg: 0.5,
      episodeBaselineCarbIntakeG: 240,
    })).toMatchObject({
      availability: "blocked",
      glycogenKg: null,
      glycogenWaterKg: null,
      provenance: "current-production-null",
    });
  });

  it("rejects incomplete and invalid production rows without falling back to episode initial state", () => {
    for (const productionRow of [
      { status: "stale", glycogenKg: 0.6 },
      { status: "complete", glycogenKg: -0.1 },
      { status: "complete", glycogenKg: Number.NaN },
      { status: "complete", glycogenKg: Number.POSITIVE_INFINITY },
    ]) {
      expect(resolvePhysicalGlycogenWaterV4({
        productionRow,
        episodeInitialGlycogenKg: 0.5,
        episodeBaselineCarbIntakeG: 240,
      })).toMatchObject({
        availability: "unavailable",
        glycogenKg: null,
        glycogenWaterKg: null,
        reason: "production-state-incomplete",
      });
    }
  });

  it("uses only a finite, strictly positive episode initial fallback when no row exists", () => {
    expect(resolvePhysicalGlycogenWaterV4({
      productionRow: null,
      episodeInitialGlycogenKg: 0.4,
      episodeBaselineCarbIntakeG: 240,
    })).toMatchObject({
      availability: "available",
      glycogenKg: 0.4,
      glycogenWaterKg: 1.08,
      provenance: "episode-initial-state",
      explicitZero: false,
    });
    for (const invalid of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(resolvePhysicalGlycogenWaterV4({
        productionRow: null,
        episodeInitialGlycogenKg: invalid,
        episodeBaselineCarbIntakeG: 240,
      }).availability).toBe("unavailable");
    }
  });

  it("does not bootstrap physical glycogen from missing or invalid baseline nutrition", () => {
    for (const baselineCarbIntakeG of [null, undefined, "240", 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolvePhysicalGlycogenWaterV4({
        productionRow: null,
        episodeInitialGlycogenKg: 0.4,
        episodeBaselineCarbIntakeG: baselineCarbIntakeG,
      })).toMatchObject({
        availability: "unavailable",
        glycogenKg: null,
        glycogenWaterKg: null,
        reason: "no-valid-production-or-initial-glycogen",
      });
    }
  });

  it("keeps missing deltas unavailable and preserves signed physical changes", () => {
    expect(physicalGlycogenWaterDeltaV4(null)).toBeNull();
    expect(physicalGlycogenWaterDeltaV4(0)).toBe(0);
    expect(physicalGlycogenWaterDeltaV4(0.2)).toBeCloseTo(0.54);
    expect(physicalGlycogenWaterDeltaV4(-0.2)).toBeCloseTo(-0.54);
    expect(() => physicalGlycogenWaterDeltaV4(Number.POSITIVE_INFINITY)).toThrow("glycogen delta must be finite");
  });
});
