import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/** Shared non-physiological coverage contract for experimental shadows. */
export type ExperimentalSourceCoverageV1 =
  | "observed" | "device-estimated" | "model-estimated" | "modeled-gap-bridge"
  | "carried-computational-state" | "partial" | "unresolved" | "missing";

export type ExperimentalDataGapContextV1 = {
  date: string;
  sources: Readonly<Record<string, ExperimentalSourceCoverageV1>>;
  gapLengthDays: number;
  gapSeverity: "none" | "short-data-gap" | "large-data-gap" | "extended-data-gap";
  bridgeProvenance: "none" | "modeled-gap-bridge";
  dataQuality: "complete" | "partial" | "degraded" | "limited" | "recovering";
  /** Epistemic width only; it never supplies a missing physiological value. */
  uncertaintyWidthMultiplier: number;
  rawSourceMutationAllowed: false;
  fingerprint: string;
};

export function transitionExperimentalDataGapContextV1(input: {
  date: string;
  sources: Readonly<Record<string, ExperimentalSourceCoverageV1>>;
  prior?: ExperimentalDataGapContextV1 | null;
}): ExperimentalDataGapContextV1 {
  const values = Object.values(input.sources);
  const hasObserved = values.some((value) => value === "observed" || value === "device-estimated");
  const allUnavailable = values.length > 0 && values.every((value) => value === "missing" || value === "unresolved");
  const priorGap = input.prior?.gapLengthDays ?? 0;
  const gapLengthDays = allUnavailable ? priorGap + 1 : 0;
  const priorWasGap = priorGap > 0;
  const gapSeverity = gapLengthDays === 0 ? "none" : gapLengthDays <= 3 ? "short-data-gap"
    : gapLengthDays <= 10 ? "large-data-gap" : "extended-data-gap";
  // A bridge is computational continuity, never a recovered observation or a
  // claim that the underlying biology did not change.
  const dataQuality = gapLengthDays > 10 ? "limited" : gapLengthDays > 3 ? "degraded"
    : gapLengthDays > 0 ? "partial" : priorWasGap && hasObserved ? "recovering"
      : values.every((value) => value === "observed") ? "complete" : "partial";
  const priorWidth = input.prior?.uncertaintyWidthMultiplier ?? 1;
  const uncertaintyWidthMultiplier = gapLengthDays > 0
    ? Math.min(3, priorWidth + (gapLengthDays <= 3 ? 0.05 : gapLengthDays <= 10 ? 0.15 : 0.2))
    // New observed coverage heals uncertainty gradually, never by the passage
    // of time alone and never instantly to the pre-gap floor.
    : priorWasGap && hasObserved ? Math.max(1, priorWidth - 0.05) : priorWidth;
  const result: ExperimentalDataGapContextV1 = {
    date: input.date, sources: { ...input.sources }, gapLengthDays, gapSeverity,
    bridgeProvenance: gapLengthDays > 0 ? "modeled-gap-bridge" : "none",
    dataQuality, uncertaintyWidthMultiplier, rawSourceMutationAllowed: false, fingerprint: "",
  };
  result.fingerprint = stableSha256({ ...result, fingerprint: undefined });
  return result;
}

export function rebuildExperimentalDataGapContextsV1(input: {
  prior?: ExperimentalDataGapContextV1 | null;
  days: readonly { date: string; sources: Readonly<Record<string, ExperimentalSourceCoverageV1>> }[];
}): ExperimentalDataGapContextV1[] {
  let prior = input.prior ?? null;
  return input.days.slice().sort((left, right) => left.date.localeCompare(right.date)).map((day) => {
    const next = transitionExperimentalDataGapContextV1({ ...day, prior });
    prior = next;
    return next;
  });
}
