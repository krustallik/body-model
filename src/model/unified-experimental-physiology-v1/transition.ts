import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type {
  UnifiedDailyDeltasV1,
  UnifiedDiagnosticsV1,
  UnifiedEnergyLedgerV1,
  UnifiedExperimentalPhysiologyDayResultV1,
  UnifiedExperimentalPhysiologyStateV1,
  UnifiedQualityV1,
  UnifiedReconciliationV1,
  UnifiedSourceLineageV1,
  UnifiedUncertaintyV1,
} from "./contracts";
import { addEnvelopes, envelope } from "./mass-composition";

export type UnifiedChildTransitionsV1 = {
  slowTissue: UnifiedExperimentalPhysiologyStateV1["slowTissue"] & {
    dailyFatDeltaKg: number | null;
    dailySlowNonFatDeltaKg: number | null;
  };
  glycogen: UnifiedExperimentalPhysiologyStateV1["glycogen"];
  glycogenWater: UnifiedExperimentalPhysiologyStateV1["glycogenWater"];
  transientWater: UnifiedExperimentalPhysiologyStateV1["transientWater"];
  relativeMuscle: UnifiedExperimentalPhysiologyStateV1["relativeMuscle"];
  ecfContext: UnifiedExperimentalPhysiologyStateV1["ecfContext"];
};

export type UnifiedTransitionInputV1 = {
  profileId: number;
  date: string;
  priorState: UnifiedExperimentalPhysiologyStateV1 | null;
  priorStateFingerprint: string | null;
  children: UnifiedChildTransitionsV1;
  energyLedger: UnifiedEnergyLedgerV1;
  quality: UnifiedQualityV1;
  uncertainty: UnifiedUncertaintyV1;
  reconciliation: Pick<UnifiedReconciliationV1, "anchorDate" | "anchorWeightKg" | "observedWeightKg" | "reason">;
  sourceLineage: UnifiedSourceLineageV1;
  diagnostics?: Partial<UnifiedDiagnosticsV1>;
};

function emptyDiagnostics(input: Partial<UnifiedDiagnosticsV1>): UnifiedDiagnosticsV1 {
  return { componentComparisons: input.componentComparisons ?? {}, rejectedConversions: input.rejectedConversions ?? [], notes: input.notes ?? [] };
}

/**
 * Pure composition boundary for Unified V1. Child equations stay in their
 * existing tested modules; this function owns order, non-overlap and the
 * relative-versus-absolute mass contract.
 */
export function transitionUnifiedExperimentalPhysiologyV1(input: UnifiedTransitionInputV1): UnifiedExperimentalPhysiologyDayResultV1 {
  const slowTissueKg = {
    fat: input.children.slowTissue.dailyFatDeltaKg,
    slowNonFat: input.children.slowTissue.dailySlowNonFatDeltaKg,
  };
  const glycogenDelta = input.children.glycogen.dailyDeltaKg;
  const glycogenWaterDelta = input.children.glycogenWater.deltaKg;
  const transientWaterDelta = input.children.transientWater.relativeKg;
  const modeledChangeSinceAnchorKg = addEnvelopes([
    slowTissueKg.fat === null || slowTissueKg.slowNonFat === null ? null : envelope(slowTissueKg.fat + slowTissueKg.slowNonFat),
    glycogenDelta,
    glycogenWaterDelta,
    transientWaterDelta,
  ]);
  const observedChangeKg = input.reconciliation.anchorWeightKg === null || input.reconciliation.observedWeightKg === null
    ? null
    : input.reconciliation.observedWeightKg - input.reconciliation.anchorWeightKg;
  const unexplainedResidualKg = modeledChangeSinceAnchorKg === null || observedChangeKg === null
    ? null
    : envelope(observedChangeKg - modeledChangeSinceAnchorKg.point!, observedChangeKg - modeledChangeSinceAnchorKg.upper!, observedChangeKg - modeledChangeSinceAnchorKg.lower!);
  const reconciliation: UnifiedReconciliationV1 = {
    ...input.reconciliation,
    observedChangeKg,
    modeledChangeSinceAnchorKg,
    unexplainedResidualKg,
    handling: input.reconciliation.anchorDate === null ? "no-anchor" : observedChangeKg === null ? "comparison-only" : "anchor-and-comparison",
  };
  const state: UnifiedExperimentalPhysiologyStateV1 = {
    slowTissue: input.children.slowTissue,
    glycogen: input.children.glycogen,
    glycogenWater: input.children.glycogenWater,
    transientWater: input.children.transientWater,
    relativeMuscle: input.children.relativeMuscle,
    ecfContext: input.children.ecfContext,
  };
  const deltas: UnifiedDailyDeltasV1 = {
    slowTissueKg,
    glycogenKg: glycogenDelta,
    glycogenWaterKg: glycogenWaterDelta,
    transientWaterKg: transientWaterDelta,
    modeledChangeSinceAnchorKg,
  };
  const withoutFingerprint = {
    contractVersion: "unified-experimental-physiology-state-v1" as const,
    profileId: input.profileId,
    date: input.date,
    priorStateFingerprint: input.priorStateFingerprint ?? "initial-state",
    sourceFingerprint: stableSha256({ date: input.date, sourceLineage: input.sourceLineage, energyLedger: input.energyLedger, quality: input.quality }),
    state,
    deltas,
    energyLedger: input.energyLedger,
    quality: input.quality,
    uncertainty: input.uncertainty,
    reconciliation,
    sourceLineage: input.sourceLineage,
    diagnostics: emptyDiagnostics(input.diagnostics ?? {}),
  };
  return { ...withoutFingerprint, resultFingerprint: stableSha256(withoutFingerprint) };
}

export function initialUnifiedStateFromChildrenV1(children: UnifiedChildTransitionsV1): UnifiedExperimentalPhysiologyStateV1 {
  return {
    slowTissue: children.slowTissue,
    glycogen: children.glycogen,
    glycogenWater: children.glycogenWater,
    transientWater: children.transientWater,
    relativeMuscle: children.relativeMuscle,
    ecfContext: children.ecfContext,
  };
}

export function carryUnifiedUncertaintyV1(prior: UnifiedUncertaintyV1 | null, reason: string): UnifiedUncertaintyV1 {
  return {
    state: prior?.state ?? {},
    transition: prior?.transition ?? {},
    observation: prior?.observation ?? { scaleKg: null, bodyComposition: [] },
    model: [...(prior?.model ?? []), reason],
    gap: prior?.gap ?? [],
    dependencyNotes: [...(prior?.dependencyNotes ?? []), "engineering ranges are not calibrated confidence intervals"],
  };
}
