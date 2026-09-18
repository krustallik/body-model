import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  PHYSIOLOGY_DAILY_RUNTIME_V7_VERSION,
  type PhysiologyDayResultV7,
  type PhysiologyRuntimeStateV7,
} from "@/model/physiology-v7/daily-runtime-v7";
import { PHYSIOLOGY_RANGE_REBUILD_V7_VERSION } from "@/model/physiology-v7/rebuild-v7";
import { PHYSIOLOGY_V7_CONTRACT_VERSION } from "@/model/physiology-v7/state";
import { PHYSIOLOGY_V7_REBUILD_SERVICE_VERSION } from "./physiology-v7-runtime.service";

export const PHYSIOLOGY_V7_SOURCE_NORMALIZATION_VERSION =
  "bodycast-v7-source-normalization-1" as const;
export const PHYSIOLOGY_V7_PERSISTENCE_VERSION =
  "bodycast-physiology-v7-persistence-1" as const;

export const currentPhysiologyV7Versions = {
  stateVersion: PHYSIOLOGY_V7_CONTRACT_VERSION,
  dailyRuntimeVersion: PHYSIOLOGY_DAILY_RUNTIME_V7_VERSION,
  rangeRebuildVersion: PHYSIOLOGY_RANGE_REBUILD_V7_VERSION,
  rebuildServiceVersion: PHYSIOLOGY_V7_REBUILD_SERVICE_VERSION,
  sourceNormalizationVersion: PHYSIOLOGY_V7_SOURCE_NORMALIZATION_VERSION,
} as const;

export function assertFiniteScientificNumbers(value: unknown, path = "result"): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${path} contains a non-finite scientific number`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteScientificNumbers(item, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertFiniteScientificNumbers(item, `${path}.${key}`);
    }
  }
}

export function serializePhysiologyDayResultV7(result: PhysiologyDayResultV7): unknown {
  assertFiniteScientificNumbers(result);
  return structuredClone(result);
}

export function deserializePhysiologyDayResultV7(value: unknown): PhysiologyDayResultV7 {
  assertFiniteScientificNumbers(value);
  if (!value || typeof value !== "object") throw new TypeError("persisted v7 result must be an object");
  const result = value as Partial<PhysiologyDayResultV7>;
  if (result.contractVersion !== PHYSIOLOGY_DAILY_RUNTIME_V7_VERSION) {
    throw new Error("persisted v7 result uses an incompatible daily runtime version");
  }
  if (typeof result.date !== "string" || typeof result.scientificFingerprint !== "string") {
    throw new TypeError("persisted v7 result is missing required identity fields");
  }
  const compartments = result.resultingState?.compartments;
  if (!compartments || Object.values(compartments).some((item) => (
    item.availability === "unavailable" ? item.valueKg !== null : !Number.isFinite(item.valueKg)
  ))) {
    throw new TypeError("persisted v7 availability state is invalid");
  }
  return structuredClone(value) as PhysiologyDayResultV7;
}

export function persistedResultFingerprint(result: PhysiologyDayResultV7): string {
  return stableSha256({
    persistenceVersion: PHYSIOLOGY_V7_PERSISTENCE_VERSION,
    versions: currentPhysiologyV7Versions,
    result,
  });
}

export function resultingRuntimeState(result: PhysiologyDayResultV7): PhysiologyRuntimeStateV7 {
  return deserializePhysiologyDayResultV7(result).resultingState;
}

export function mergeEarliestStaleDate(
  existing: string | null,
  affected: string,
): string {
  return existing === null || affected < existing ? affected : existing;
}

export function versionsAreCurrent(record: Record<string, unknown>): boolean {
  return Object.entries(currentPhysiologyV7Versions)
    .every(([key, value]) => record[key] === value);
}
