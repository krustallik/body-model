import { prisma } from "@/lib/db/prisma";
import { carryUnifiedUncertaintyV1, transitionUnifiedExperimentalPhysiologyV1, type UnifiedChildTransitionsV1 } from "@/model/unified-experimental-physiology-v1/transition";
import { buildUnifiedEnergyLedgerV1 } from "@/model/unified-experimental-physiology-v1/energy-ledger";
import { UnifiedExperimentalPhysiologySourceLoaderV1, type UnifiedDurableDayEvidenceV1 } from "@/model/unified-experimental-physiology-v1/source-loader";
import {
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V1_REVISION,
  serializeUnifiedExperimentalPhysiologyV1,
  type UnifiedExperimentalPhysiologyDayResultV1,
  type UnifiedExperimentalPhysiologyStateV1,
  type UnifiedNumericEnvelopeV1,
  type UnifiedQualityV1,
  type UnifiedUncertaintyV1,
} from "@/model/unified-experimental-physiology-v1/contracts";
import type { Prisma } from "@prisma/client";

const envelope = (point: number | null, lower = point, upper = point): UnifiedNumericEnvelopeV1 => ({ point, lower, upper, representation: "engineering-range" });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numberValue = (value: unknown): number | null => finite(value) ? value : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

function childTransitions(day: UnifiedDurableDayEvidenceV1, prior: UnifiedExperimentalPhysiologyStateV1 | null): UnifiedChildTransitionsV1 {
  const slow = object(day.childOutputs.slowTissue?.result);
  const slowState = object(slow.state);
  const previousSlow = object(prior?.slowTissue);
  const fatMass = numberValue(slowState.fatMassKg);
  const slowNonFat = numberValue(slowState.slowNonFatKg);
  const fatDelta = fatMass !== null && finite(previousSlow.fatMassKg) ? fatMass - previousSlow.fatMassKg : null;
  const slowNonFatDelta = slowNonFat !== null && finite(previousSlow.slowNonFatKg) ? slowNonFat - previousSlow.slowNonFatKg : null;
  const slowAvailability = fatMass !== null && slowNonFat !== null ? "available" : "unavailable";

  const glycogen = object(day.childOutputs.glycogen?.result);
  const glycogenState = object(glycogen.state);
  const glycogenRelative = numberValue(glycogenState.relativeDeviationKg);
  const glycogenAvailable = glycogenRelative !== null;
  const glycogenDeltaPoint = numberValue(glycogen.netGlycogenDeltaKg);
  const glycogenDelta = glycogenDeltaPoint === null ? null : envelope(glycogenDeltaPoint, numberValue(glycogen.netGlycogenDeltaLowerKg) ?? glycogenDeltaPoint, numberValue(glycogen.netGlycogenDeltaUpperKg) ?? glycogenDeltaPoint);
  const glycogenChild: UnifiedChildTransitionsV1["glycogen"] = {
    availability: glycogenAvailable ? "available" : "unavailable",
    relativeDeviationKg: glycogenAvailable ? envelope(glycogenRelative, numberValue(glycogenState.relativeDeviationLowerKg), numberValue(glycogenState.relativeDeviationUpperKg)) : null,
    dailyDeltaKg: glycogenDelta,
    provenance: glycogenAvailable ? "experimental-glycogen-state-v2" : "unavailable",
  };

  const water = object(day.childOutputs.glycogenWater?.result);
  const waterPoint = numberValue(water.estimatedGlycogenWaterDeltaKg);
  const glycogenWater: UnifiedChildTransitionsV1["glycogenWater"] = {
    availability: waterPoint === null ? "unavailable" : "available",
    deltaKg: waterPoint === null ? null : envelope(waterPoint, numberValue(water.lowerBoundKg), numberValue(water.upperBoundKg)),
    provenance: waterPoint === null ? "unavailable" : "experimental-glycogen-associated-water-v1",
  };

  const transientRows = day.childOutputs.transientWater;
  const transientLatest = transientRows.at(-1);
  const transient = object(transientLatest?.result);
  const transientDelta = object(transient.transientWaterDeltaKg);
  const transientPoint = numberValue(transientDelta.point);
  const transientAvailable = transientPoint !== null;
  const transientWater: UnifiedChildTransitionsV1["transientWater"] = {
    availability: transientAvailable ? "available" : "unavailable",
    relativeKg: transientAvailable ? envelope(transientPoint, numberValue(transientDelta.lower), numberValue(transientDelta.upper)) : null,
    provenance: transientAvailable ? "experimental-transient-exercise-water-v1" : "unavailable",
  };

  const muscle = object(day.childOutputs.relativeMuscle?.result);
  const musclePoint = numberValue(muscle.estimatedSkeletalMuscleDeltaKg);
  const relativeMuscle: UnifiedChildTransitionsV1["relativeMuscle"] = {
    availability: musclePoint === null ? "unavailable" : "available",
    cumulativeDeltaKg: musclePoint === null ? null : envelope(musclePoint),
    supportStatus: object(muscle.support).status === "supported" ? "supported" : musclePoint === null ? "outside-supported-domain" : "degraded",
    authoritativeUse: "forbidden",
    reason: "relative diagnostic only; never added to body mass",
    provenance: musclePoint === null ? "unavailable" : "experimental-cessation-detraining-v1",
  };

  return {
    slowTissue: { availability: slowAvailability, fatMassKg: fatMass, slowNonFatKg: slowNonFat, provenance: slowAvailability === "available" ? "fat-weight-shadow-v1" : "unavailable", dailyFatDeltaKg: fatDelta, dailySlowNonFatDeltaKg: slowNonFatDelta },
    glycogen: glycogenChild,
    glycogenWater,
    transientWater,
    relativeMuscle,
    ecfContext: { availability: "unavailable", deviationKg: null, provenance: "unavailable" },
  };
}

function quality(day: UnifiedDurableDayEvidenceV1, gapDays: number): UnifiedQualityV1 {
  const missingFields: string[] = [];
  if (day.dailyHealthData === null) missingFields.push("dailyHealthData");
  if (day.productionDailyState === null) missingFields.push("productionDailyState");
  if (day.childOutputs.glycogen === null) missingFields.push("glycogen");
  if (day.childOutputs.slowTissue === null) missingFields.push("slowTissue");
  const gapSeverity = gapDays >= 30 ? "extended-gap" : gapDays >= 10 ? "large-gap" : gapDays >= 3 ? "short-gap" : "none";
  const availability = missingFields.length === 0 ? "available" : missingFields.length < 3 ? "partial" : "unavailable";
  return { availability, gapSeverity, sourceQuality: gapDays > 0 ? "modeled-gap-bridge" : availability === "available" ? "observed" : "missing", missingFields, reasons: missingFields.map((field) => `missing-${field}`), modeledGapBridge: gapDays > 0 };
}

function uncertainty(prior: UnifiedUncertaintyV1 | null, day: UnifiedDurableDayEvidenceV1): UnifiedUncertaintyV1 {
  return carryUnifiedUncertaintyV1(prior, day.dailyHealthData === null ? "no-daily-health-observation" : "child-output-uncertainty-preserved");
}

function sourceLineage(day: UnifiedDurableDayEvidenceV1) {
  const childOutputs: Array<{ kind: string; id: number; updatedAt: string; sourceFingerprint: string }> = [];
  for (const [kind, row] of [["slowTissue", day.childOutputs.slowTissue], ["glycogen", day.childOutputs.glycogen], ["glycogenWater", day.childOutputs.glycogenWater], ["relativeMuscle", day.childOutputs.relativeMuscle]] as const) {
    if (row) childOutputs.push({ kind, id: row.id, updatedAt: row.updatedAt, sourceFingerprint: row.sourceFingerprint });
  }
  for (const row of day.childOutputs.transientWater) childOutputs.push({ kind: "transientWater", id: row.id, updatedAt: row.updatedAt, sourceFingerprint: row.sourceFingerprint });
  return {
    dailyHealthData: day.dailyHealthData ? { id: day.dailyHealthData.id, updatedAt: day.dailyHealthData.updatedAt } : null,
    productionDailyState: day.productionDailyState ? { id: day.productionDailyState.id, updatedAt: day.productionDailyState.updatedAt, modelVersion: day.productionDailyState.modelVersion } : null,
    workouts: day.workouts.map((row) => ({ id: row.id, updatedAt: row.updatedAt, sourceFingerprint: row.sourceIdentity })),
    diarySessions: day.diarySessions.map((row) => ({ id: row.id, revision: row.revision, updatedAt: row.updatedAt })),
    childModelRevisions: day.childModelRevisions,
    childOutputs,
    sourceDate: day.date,
  };
}

function toPersisted(result: UnifiedExperimentalPhysiologyDayResultV1) {
  const json = (value: unknown) => value as Prisma.InputJsonValue;
  return { profileId: result.profileId, date: result.date, modelRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V1_REVISION, sourceFingerprint: result.sourceFingerprint, priorStateFingerprint: result.priorStateFingerprint, resultFingerprint: result.resultFingerprint, qualityStatus: result.quality.availability, gapSeverity: result.quality.gapSeverity, state: json(result.state), deltas: json(result.deltas), uncertainty: json(result.uncertainty), reconciliation: json(result.reconciliation), energyLedger: json(result.energyLedger), sourceLineage: json(result.sourceLineage), diagnostics: json(result.diagnostics) };
}

export async function rebuildUnifiedExperimentalPhysiologyStateV1(input: { profileId?: number; fromDate: string; toDate: string }): Promise<void> {
  if (input.toDate < input.fromDate) throw new RangeError("toDate must not precede fromDate");
  const profileId = input.profileId ?? 1;
  const sourceLoader = new UnifiedExperimentalPhysiologySourceLoaderV1(prisma);
  const [latestDurable, predecessor, priorObservation] = await Promise.all([
    prisma.dailyHealthData.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    prisma.unifiedExperimentalPhysiologyState.findFirst({ where: { profileId, date: { lt: input.fromDate }, modelRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V1_REVISION }, orderBy: { date: "desc" }, select: { resultFingerprint: true, state: true, uncertainty: true } }),
    prisma.dailyHealthData.findFirst({ where: { date: { lt: input.fromDate }, weightKg: { not: null } }, orderBy: { date: "desc" }, select: { date: true, weightKg: true } }),
  ]);
  const effectiveToDate = latestDurable?.date && latestDurable.date > input.toDate ? latestDurable.date : input.toDate;
  const range = await sourceLoader.loadRange({ profileId, fromDate: input.fromDate, toDate: effectiveToDate });
  let priorState = predecessor?.state as UnifiedExperimentalPhysiologyStateV1 | null ?? null;
  let priorFingerprint = predecessor?.resultFingerprint ?? null;
  let priorUncertainty = predecessor?.uncertainty as UnifiedUncertaintyV1 | null ?? null;
  let previousDate: string | null = null;
  let previousObservedWeight: number | null = priorObservation?.weightKg ?? null;
  let gapRun = 0;
  for (const day of range.days) {
    const gapDays = day.dailyHealthData === null ? ++gapRun : gapRun;
    const children = childTransitions(day, priorState);
    const production = day.productionDailyState;
    const ledger = buildUnifiedEnergyLedgerV1({ production: { dynamicRmrKcalPerDay: production?.dynamicRmrKcalPerDay ?? null, tefKcalPerDay: production?.tefKcalPerDay ?? null, walkingKcalPerDay: null, occupationalKcalPerDay: null, workoutKcalPerDay: null, stepperKcalPerDay: null, activityKcalPerDay: production?.activityKcalPerDay ?? null, adaptiveThermogenesisKcalPerDay: production?.adaptiveThermogenesisKcalPerDay ?? null, personalOffsetKcalPerDay: null, productionTdeeKcalPerDay: production?.energyExpenditureKcal ?? null }, activities: day.workouts.map((workout) => ({ doseKey: `workout:${workout.id}`, kind: "workout" as const, garminActiveKcal: workout.activeEnergyKcal, bodyCastEstimateKcal: null })) });
    const observedWeight = day.dailyHealthData?.weightKg ?? null;
    const anchorWeight = previousObservedWeight;
    const result = transitionUnifiedExperimentalPhysiologyV1({ profileId, date: day.date, priorState, priorStateFingerprint: priorFingerprint, children, energyLedger: ledger, quality: quality(day, gapDays), uncertainty: uncertainty(priorUncertainty, day), reconciliation: { anchorDate: previousDate, anchorWeightKg: anchorWeight, observedWeightKg: observedWeight, reason: anchorWeight === null ? "no-prior-observed-weight" : null }, sourceLineage: sourceLineage(day), diagnostics: { notes: ["Unified V1 is shadow-only; production state is read-only input", `transient-output-count:${day.childOutputs.transientWater.length}`] } });
    const serialized = serializeUnifiedExperimentalPhysiologyV1(result);
    await prisma.unifiedExperimentalPhysiologyState.upsert({ where: { profileId_date: { profileId, date: day.date } }, create: toPersisted(serialized), update: toPersisted(serialized) });
    priorState = serialized.state;
    priorFingerprint = serialized.resultFingerprint;
    priorUncertainty = serialized.uncertainty;
    previousDate = day.date;
    if (observedWeight !== null) {
      previousObservedWeight = observedWeight;
      gapRun = 0;
    }
  }
}

export const rebuildUnifiedExperimentalPhysiologyState = rebuildUnifiedExperimentalPhysiologyStateV1;
