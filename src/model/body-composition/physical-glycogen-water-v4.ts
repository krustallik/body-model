import { calculateGlycogenAssociatedWaterKg } from "./state";
import { createGlycogenParameters } from "./glycogen";

export const PHYSICAL_GLYCOGEN_WATER_V4_REVISION =
  "physical-glycogen-water-v4-2p7" as const;

export type PhysicalGlycogenResolutionV4 =
  | {
      availability: "available";
      glycogenKg: number;
      glycogenWaterKg: number;
      provenance: "production-daily-model-state" | "episode-initial-state";
      explicitZero: boolean;
    }
  | {
      availability: "blocked";
      glycogenKg: null;
      glycogenWaterKg: null;
      provenance: "current-production-null";
      reason: "current-production-glycogen-unavailable";
    }
  | {
      availability: "unavailable";
      glycogenKg: null;
      glycogenWaterKg: null;
      provenance: "unavailable";
      reason: "no-valid-production-or-initial-glycogen" | "production-state-incomplete";
    };

/**
 * Resolve physical glycogen without consulting relative-glycogen shadows or
 * nutrition. A present production row is authoritative even when its value is
 * null; that case blocks the episode-initial fallback.
 */
export function resolvePhysicalGlycogenWaterV4(input: {
  productionRow: { status: string; glycogenKg: number | null } | null;
  episodeInitialGlycogenKg: unknown;
  episodeBaselineCarbIntakeG: unknown;
}): PhysicalGlycogenResolutionV4 {
  if (input.productionRow !== null) {
    const value = input.productionRow.glycogenKg;
    if (value === null) {
      return {
        availability: "blocked",
        glycogenKg: null,
        glycogenWaterKg: null,
        provenance: "current-production-null",
        reason: "current-production-glycogen-unavailable",
      };
    }
    if (input.productionRow.status !== "complete") {
      return {
        availability: "unavailable",
        glycogenKg: null,
        glycogenWaterKg: null,
        provenance: "unavailable",
        reason: "production-state-incomplete",
      };
    }
    if (!Number.isFinite(value) || value < 0) {
      return {
        availability: "unavailable",
        glycogenKg: null,
        glycogenWaterKg: null,
        provenance: "unavailable",
        reason: "production-state-incomplete",
      };
    }
    return {
      availability: "available",
      glycogenKg: value,
      glycogenWaterKg: calculateGlycogenAssociatedWaterKg(value),
      provenance: "production-daily-model-state",
      explicitZero: value === 0,
    };
  }

  const initial = input.episodeInitialGlycogenKg;
  if (typeof initial !== "number" || !Number.isFinite(initial) || initial <= 0) {
    return {
      availability: "unavailable",
      glycogenKg: null,
      glycogenWaterKg: null,
      provenance: "unavailable",
      reason: "no-valid-production-or-initial-glycogen",
    };
  }
  if (typeof input.episodeBaselineCarbIntakeG !== "number"
      || !Number.isFinite(input.episodeBaselineCarbIntakeG)) {
    return {
      availability: "unavailable",
      glycogenKg: null,
      glycogenWaterKg: null,
      provenance: "unavailable",
      reason: "no-valid-production-or-initial-glycogen",
    };
  }
  try {
    createGlycogenParameters({
      baselineCarbIntakeG: input.episodeBaselineCarbIntakeG,
      initialGlycogenKg: initial,
    });
  } catch {
    return {
      availability: "unavailable",
      glycogenKg: null,
      glycogenWaterKg: null,
      provenance: "unavailable",
      reason: "no-valid-production-or-initial-glycogen",
    };
  }
  return {
    availability: "available",
    glycogenKg: initial,
    glycogenWaterKg: calculateGlycogenAssociatedWaterKg(initial),
    provenance: "episode-initial-state",
    explicitZero: false,
  };
}

/** The same canonical conversion is used for physical glycogen changes. */
export function physicalGlycogenWaterDeltaV4(deltaGlycogenKg: number | null): number | null {
  if (deltaGlycogenKg === null) return null;
  if (!Number.isFinite(deltaGlycogenKg)) throw new TypeError("glycogen delta must be finite");
  const magnitude = calculateGlycogenAssociatedWaterKg(Math.abs(deltaGlycogenKg));
  return Math.sign(deltaGlycogenKg) * magnitude;
}
