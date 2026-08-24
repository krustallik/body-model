import { createHash } from "node:crypto";
import type { BuiltSimulationDay, PersistedEpisode } from "@/modules/model-episodes/model-episode.types";
import { DEFAULT_RECOVERY_CONFIG, type RecoveryConfig } from "./recovery.types";

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function stableSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function resolvedRecoveryConfig(config?: Partial<RecoveryConfig>): RecoveryConfig {
  return { ...DEFAULT_RECOVERY_CONFIG, ...config };
}

export function recoveryConfigFingerprint(config: RecoveryConfig): string {
  return stableSha256(config);
}

export function recoverySourceFingerprint(input: {
  episode: PersistedEpisode;
  days: readonly BuiltSimulationDay[];
  donorDays: readonly BuiltSimulationDay[];
}): string {
  return stableSha256({
    deterministicModelVersion: input.episode.modelVersion,
    ecfPolicy: input.episode.ecfPolicy,
    initialState: input.episode.initialState,
    simulatorParameters: input.episode.simulatorParameters,
    personalization: {
      personalOffsetKcalPerDay: input.episode.personalOffsetKcalPerDay,
      activityCalibration: input.episode.activityCalibration,
    },
    nutritionPolicy: {
      maxBridgeDays: input.episode.nutritionMaxBridgeDays,
      baselineFallback: input.episode.baselineNutritionFallback,
    },
    days: input.days,
    donorDays: input.donorDays,
  });
}
