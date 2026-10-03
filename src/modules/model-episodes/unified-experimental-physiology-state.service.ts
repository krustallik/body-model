import { prisma } from "@/lib/db/prisma";
import { carryUnifiedUncertaintyV1, transitionUnifiedExperimentalPhysiologyV1, type UnifiedChildTransitionsV1 } from "@/model/unified-experimental-physiology-v1/transition";
import { buildUnifiedEnergyLedgerV1 } from "@/model/unified-experimental-physiology-v1/energy-ledger";
import { UnifiedExperimentalPhysiologySourceLoaderV1, type UnifiedDurableDayEvidenceV1 } from "@/model/unified-experimental-physiology-v1/source-loader";
import {
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION,
  serializeUnifiedExperimentalPhysiologyV1,
  type UnifiedExperimentalPhysiologyDayResultV1,
  type UnifiedExperimentalPhysiologyStateV1,
  type UnifiedNumericEnvelopeV1,
  type UnifiedQualityV1,
  type UnifiedUncertaintyV1,
} from "@/model/unified-experimental-physiology-v1/contracts";
import type { Prisma } from "@prisma/client";
import { PhysiologyV7ConcurrentSourceChangeError, PhysiologyV7PersistenceRepository } from "./physiology-v7-persistence.repository";
import { isProductionGenerationCurrentV1 } from "./publication-generation-v1";
import { replayTransientExerciseWaterV2, transientWaterV2ContributionKg, type ActiveTransientExerciseWaterImpulseV2, type TransientExerciseWaterImpulseV2, type TransientWaterV2Branch } from "@/model/physiology-v7/experimental-transient-exercise-water-v2";
import { rebuildExperimentalTransientExerciseWaterV2 } from "@/modules/training/experimental-transient-exercise-water-shadow.service";
import { readTransientExerciseWaterSourceTokenV2 } from "@/modules/training/experimental-transient-exercise-water-shadow.service";
import { addCalendarDays } from "./model-calendar";
import { buildTransientEpisodePartitionsV2 } from "@/modules/model-episodes/transient-exercise-water-episode-time-v2";
import { localDateTimeToInstant } from "@/model/time-zone";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export class ProductionPublicationUnavailableError extends Error {
  constructor() {
    super("Unified physiology requires a current production model generation");
  }
}

const envelope = (point: number | null, lower = point, upper = point): UnifiedNumericEnvelopeV1 => ({ point, lower, upper, representation: "engineering-range" });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numberValue = (value: unknown): number | null => finite(value) ? value : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

export function childTransitions(day: UnifiedDurableDayEvidenceV1, prior: UnifiedExperimentalPhysiologyStateV1 | null): UnifiedChildTransitionsV1 {
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
  const transientBoundaries = day.transientWaterBoundaries;
  if (transientBoundaries.length > 1) {
    throw new Error(`Unified V2 requires one canonical episode model-day per row (${day.date})`);
  }
  let transientWater: UnifiedChildTransitionsV1["transientWater"];
  if (transientBoundaries.length === 0) {
    if (transientRows.length > 0) throw new Error(`V2 transient impulses have no episode boundary on ${day.date}`);
    const previousTransient = object(prior?.transientWater);
    const previousLevel = object(previousTransient.levelKg);
    const previousLedger = previousTransient.activeImpulses;
    const canCarry = previousTransient.availability === "available"
      && [previousLevel.point, previousLevel.lower, previousLevel.upper].every(finite)
      && Array.isArray(previousLedger);
    transientWater = canCarry
      ? {
          availability: "available",
          levelKg: envelope(previousLevel.point as number, previousLevel.lower as number, previousLevel.upper as number),
          activeImpulses: previousLedger,
          relativeKg: envelope(0),
          provenance: "experimental-transient-exercise-water-v2-impulse-ledger",
          episodeId: numberValue(previousTransient.episodeId),
          modelDate: typeof previousTransient.modelDate === "string" ? previousTransient.modelDate : day.date,
          boundaryInstant: typeof previousTransient.boundaryInstant === "string" ? previousTransient.boundaryInstant : null,
        }
      : {
          availability: "unavailable", relativeKg: null, levelKg: null, activeImpulses: [],
          provenance: "unavailable", episodeId: null, modelDate: day.date, boundaryInstant: null,
        };
  } else {
    const currentImpulsesByBoundary = transientBoundaries.map((boundary) => ({
      boundary,
      impulses: transientRows
        .filter((row) => {
          const impulse = object(object(row.result).impulse);
          return impulse.modelEpisodeId === boundary.episodeId && impulse.modelDate === boundary.modelDate;
        })
        .map((row) => {
          if (row.modelRevision !== "experimental-transient-exercise-water-v2-impulse-ledger") {
            throw new Error(`Unified refuses non-V2 transient row ${row.id}`);
          }
          const impulse = object(object(row.result).impulse) as unknown as TransientExerciseWaterImpulseV2;
          if (impulse.contractVersion !== "experimental-transient-exercise-water-v2-impulse-ledger"
              || impulse.modelEpisodeId !== boundary.episodeId
              || impulse.modelDate !== boundary.modelDate
              || impulse.sourceFingerprint !== row.sourceFingerprint) {
            throw new Error(`invalid transient impulse provenance on row ${row.id}`);
          }
          return impulse;
        }),
    }));
    const matchedSessionIds = new Set(currentImpulsesByBoundary.flatMap(({ impulses }) =>
      impulses.map((impulse) => impulse.strengthDiarySessionId)));
    if (matchedSessionIds.size !== transientRows.length) {
      throw new Error(`V2 transient impulse has no matching episode boundary on ${day.date}`);
    }
    const priorLedgerValue = object(prior?.transientWater).activeImpulses;
    const priorLedger = Array.isArray(priorLedgerValue)
      ? priorLedgerValue as ActiveTransientExerciseWaterImpulseV2[]
      : [];
    const replay = replayTransientExerciseWaterV2({
      initialActiveImpulses: priorLedger,
      days: currentImpulsesByBoundary.map(({ boundary, impulses }) => ({ ...boundary, impulses })),
    });
    const first = replay.days[0]!;
    const replayed = replay.days.at(-1)!;
    const levelValues = [replayed.endOfDayLevelKg.lower, replayed.endOfDayLevelKg.point, replayed.endOfDayLevelKg.upper];
    const branchDeltaKg = {
      point: replayed.endOfDayLevelKg.point - first.startOfDayLevelKg.point,
      lower: replayed.endOfDayLevelKg.lower - first.startOfDayLevelKg.lower,
      upper: replayed.endOfDayLevelKg.upper - first.startOfDayLevelKg.upper,
    };
    const rankedDelta = [
      { branch: "point" as const, value: branchDeltaKg.point },
      { branch: "lower" as const, value: branchDeltaKg.lower },
      { branch: "upper" as const, value: branchDeltaKg.upper },
    ].sort((left, right) => left.value - right.value);
    const transientAvailable = levelValues.every(Number.isFinite);
    transientWater = {
      availability: transientAvailable ? "available" : "unavailable",
      levelKg: transientAvailable ? envelope(
        replayed.endOfDayLevelKg.point,
        Math.min(...levelValues),
        Math.max(...levelValues),
      ) : null,
      activeImpulses: replay.activeImpulses,
      relativeKg: transientAvailable ? envelope(
        branchDeltaKg.point,
        rankedDelta[0]!.value,
        rankedDelta.at(-1)!.value,
      ) : null,
      provenance: transientAvailable ? "experimental-transient-exercise-water-v2-impulse-ledger" : "unavailable",
      episodeId: replayed.episodeId,
      modelDate: replayed.modelDate,
      boundaryInstant: replayed.boundaryInstant,
    };
  }

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

function selectionCoverageNote(day: UnifiedDurableDayEvidenceV1): string | null {
  const quality = day.productionDailyState?.sourceQuality;
  if (quality === null || typeof quality !== "object" || Array.isArray(quality)) return null;
  const selection = (quality as { selectionV1?: unknown }).selectionV1;
  if (selection === null || typeof selection !== "object" || Array.isArray(selection)) return null;
  const coverage = (selection as { energyCoverage?: unknown }).energyCoverage;
  if (coverage === null || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  const unknown = (coverage as { unknownEventCount?: unknown }).unknownEventCount;
  const full = (coverage as { fullCoverage?: unknown }).fullCoverage;
  const known = (coverage as { knownSubtotalKcal?: unknown }).knownSubtotalKcal;
  return `selection-v1-energy-coverage:unknown=${String(unknown)};full=${String(full)};known=${String(known)}`;
}

function uncertainty(prior: UnifiedUncertaintyV1 | null, day: UnifiedDurableDayEvidenceV1, unknownEnergyCount: number): UnifiedUncertaintyV1 {
  const selectionNote = selectionCoverageNote(day);
  const reasons = [
    day.dailyHealthData === null ? "no-daily-health-observation" : "child-output-uncertainty-preserved",
    ...(unknownEnergyCount > 0 ? [`energy-coverage-unknown=${unknownEnergyCount}`] : []),
    ...(selectionNote !== null ? [selectionNote] : []),
  ];
  return carryUnifiedUncertaintyV1(prior, reasons.join("; "));
}

function sourceLineage(day: UnifiedDurableDayEvidenceV1) {
  const childOutputs: Array<{ kind: string; id: number; updatedAt: string; sourceFingerprint: string }> = [];
  for (const [kind, row] of [["slowTissue", day.childOutputs.slowTissue], ["glycogen", day.childOutputs.glycogen], ["glycogenWater", day.childOutputs.glycogenWater], ["relativeMuscle", day.childOutputs.relativeMuscle]] as const) {
    if (row) childOutputs.push({ kind, id: row.id, updatedAt: row.updatedAt, sourceFingerprint: row.sourceFingerprint });
  }
  for (const row of day.childOutputs.transientWater) childOutputs.push({ kind: "transientWater", id: row.id, updatedAt: row.updatedAt, sourceFingerprint: row.sourceFingerprint });
  return {
    modelEpisodeId: day.modelEpisodeId,
    modelDate: day.date,
    boundaryAt: day.boundaryAt,
    episodePartitionRevision: day.childModelRevisions.episodePartition ?? "missing-episode-partition-revision",
    dailyHealthData: day.dailyHealthData ? { id: day.dailyHealthData.id, updatedAt: day.dailyHealthData.updatedAt } : null,
    productionDailyState: day.productionDailyState ? { id: day.productionDailyState.id, updatedAt: day.productionDailyState.updatedAt, modelVersion: day.productionDailyState.modelVersion } : null,
    workouts: day.workouts.map((row) => ({
      id: row.id,
      updatedAt: row.updatedAt,
      sourceFingerprint: [
        row.sourceIdentity,
        row.canonicalEnergyResolution?.resolutionRevision ?? "no-canonical-resolution",
        row.canonicalEnergyResolution?.currentSource ?? "no-source",
        row.canonicalEnergyResolution?.currentKcal ?? "no-kcal",
        row.canonicalEnergyResolution?.isStale ?? false,
      ].join("|"),
    })),
    diarySessions: day.diarySessions.map((row) => ({ id: row.id, revision: row.revision, updatedAt: row.updatedAt })),
    childModelRevisions: day.childModelRevisions,
    childOutputs,
    transientWaterBoundaries: day.transientWaterBoundaries,
    sourceDate: day.date,
  };
}

function toPersisted(result: UnifiedExperimentalPhysiologyDayResultV1) {
  const json = (value: unknown) => value as Prisma.InputJsonValue;
  return { profileId: result.profileId, modelEpisodeId: result.modelEpisodeId, date: result.date, boundaryAt: new Date(result.boundaryAt), modelRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION, sourceFingerprint: result.sourceFingerprint, priorStateFingerprint: result.priorStateFingerprint, resultFingerprint: result.resultFingerprint, qualityStatus: result.quality.availability, gapSeverity: result.quality.gapSeverity, state: json(result.state), deltas: json(result.deltas), uncertainty: json(result.uncertainty), reconciliation: json(result.reconciliation), energyLedger: json(result.energyLedger), sourceLineage: json(result.sourceLineage), diagnostics: json(result.diagnostics) };
}

function compatiblePredecessorLedger(value: unknown): ActiveTransientExerciseWaterImpulseV2[] | null {
  try {
    const state = object(value);
    const transient = object(state.transientWater);
    const level = object(transient.levelKg);
    if (transient.availability !== "available"
        || transient.provenance !== "experimental-transient-exercise-water-v2-impulse-ledger"
        || !finite(level.point)
        || typeof transient.boundaryInstant !== "string"
        || !Number.isFinite(Date.parse(transient.boundaryInstant))
        || !Array.isArray(transient.activeImpulses)) return null;
    const ledger = transient.activeImpulses as ActiveTransientExerciseWaterImpulseV2[];
    if (ledger.some((entry) => !entry || !Number.isInteger(entry.ageModelDays) || entry.ageModelDays < 0
        || entry.impulse?.contractVersion !== "experimental-transient-exercise-water-v2-impulse-ledger"
        || entry.impulse?.replayRevision !== "transient-water-v2-model-day-impulse-age-coherent-branches"
        || !Number.isInteger(entry.impulse?.strengthDiarySessionId))) return null;
    const branches: TransientWaterV2Branch[] = ["point", "lower", "upper"];
    for (const branch of branches) {
      const expected = ledger.reduce((sum, entry) =>
        sum + transientWaterV2ContributionKg(entry.impulse, branch, entry.ageModelDays), 0);
      const actual = level[branch];
      if (!finite(actual) || Math.abs(actual - expected) > 1e-9) return null;
    }
    return ledger;
  } catch {
    return null;
  }
}

function unifiedRangeToken(profileId: number, fromInstant: string, throughInstant: string, days: UnifiedDurableDayEvidenceV1[]): string {
  return stableSha256({ profileId, fromInstant, throughInstant, days });
}

export async function rebuildUnifiedExperimentalPhysiologyStateV1(input: {
  profileId?: number;
  fromDate?: string;
  toDate?: string;
  onCandidateComputed?: () => Promise<void>;
}): Promise<void> {
  if (input.fromDate && input.toDate && input.toDate < input.fromDate) {
    throw new RangeError("toDate must not precede fromDate");
  }
  const profileId = input.profileId ?? 1;
  const episodeRows = await prisma.modelEpisode.findMany({
    where: { profileId },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true, timezone: true, active: true, deactivatedAt: true },
  });
  const episodePartitions = buildTransientEpisodePartitionsV2(episodeRows);
  const earliestPartition = episodePartitions[0];
  if (!earliestPartition) throw new ProductionPublicationUnavailableError();
  const latestPartition = episodePartitions.at(-1)!;
  const initialPublicationState = await prisma.physiologyV7Lifecycle.findUnique({
    where: { profileId },
    select: { invalidationGeneration: true, productionStaleFromDate: true, productionPublishedGeneration: true },
  });
  if (!isProductionGenerationCurrentV1(initialPublicationState)) {
    throw new ProductionPublicationUnavailableError();
  }
  const expectedGeneration = initialPublicationState.invalidationGeneration;
  const transientRebuild = await rebuildExperimentalTransientExerciseWaterV2({ profileId });
  const publicationState = await prisma.physiologyV7Lifecycle.findUnique({
    where: { profileId },
    select: { invalidationGeneration: true, productionStaleFromDate: true, productionPublishedGeneration: true, updatedAt: true },
  });
  if (!isProductionGenerationCurrentV1(publicationState)
      || publicationState.invalidationGeneration !== expectedGeneration) {
    throw new PhysiologyV7ConcurrentSourceChangeError();
  }
  const expectedLifecycleUpdatedAt = publicationState.updatedAt.toISOString();
  const latestDurable = await prisma.dailyHealthData.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  const requestedToDate = [input.toDate, latestDurable?.date, transientRebuild.earliestModelDate]
    .filter((date): date is string => date !== null && date !== undefined)
    .sort()
    .at(-1) ?? earliestPartition.episode.startDate;
  const effectiveToDate = [requestedToDate, earliestPartition.episode.startDate, latestPartition.episode.startDate]
    .sort()
    .at(-1)!;
  const dirtyCandidates = [input.fromDate, transientRebuild.earliestModelDate]
    .filter((date): date is string => date !== null && date !== undefined);
  const earliestDirtyDate = dirtyCandidates.sort()[0];
  const requestedFromDate = earliestDirtyDate && earliestDirtyDate > earliestPartition.episode.startDate
    ? earliestDirtyDate
    : earliestPartition.episode.startDate;
  const replayFromInstant = earliestPartition.startInstant;
  const replayThroughInstant = localDateTimeToInstant(
    addCalendarDays(effectiveToDate, 1),
    "00:00",
    latestPartition.episode.timezone,
  );
  if (replayThroughInstant.getTime() <= replayFromInstant.getTime()) {
    throw new RangeError("Unified absolute replay interval does not include an episode model day");
  }

  const sourceLoader = new UnifiedExperimentalPhysiologySourceLoaderV1(prisma);
  const fullRange = await sourceLoader.loadRange({ profileId, fromInstant: replayFromInstant, throughInstant: replayThroughInstant });
  if (fullRange.days.length === 0) throw new ProductionPublicationUnavailableError();
  for (let index = 1; index < fullRange.days.length; index += 1) {
    const prior = fullRange.days[index - 1]!;
    const current = fullRange.days[index]!;
    if (!Number.isFinite(Date.parse(current.boundaryAt))
        || Date.parse(current.boundaryAt) <= Date.parse(prior.boundaryAt)) {
      throw new Error("Unified V2 model-day boundaries must be strictly chronological");
    }
  }
  const hasNonIncreasingTextualDates = fullRange.days.some((day, index) => index > 0 && day.date <= fullRange.days[index - 1]!.date);
  const matchedStartIndex = fullRange.days.findIndex((day) => day.date >= requestedFromDate);
  // Date-only dirty markers cannot identify an exact suffix through a local
  // date reversal or repeated label, so fall back to absolute full replay.
  const requestedStartIndex = hasNonIncreasingTextualDates || matchedStartIndex < 0 ? 0 : matchedStartIndex;

  let predecessor: {
    modelEpisodeId: number;
    date: string;
    boundaryAt: Date;
    modelRevision: string;
    resultFingerprint: string;
    sourceFingerprint: string;
    state: unknown;
    uncertainty: unknown;
    sourceLineage: unknown;
  } | null = null;
  let priorLedger: ActiveTransientExerciseWaterImpulseV2[] | null = null;
  if (requestedStartIndex > 0) {
    const previousDay = fullRange.days[requestedStartIndex - 1]!;
    const persistedPrefix = await prisma.unifiedExperimentalPhysiologyStateV2.findMany({
      where: { profileId, boundaryAt: { lte: new Date(previousDay.boundaryAt) } },
      orderBy: { boundaryAt: "asc" },
      select: { modelEpisodeId: true, date: true, boundaryAt: true, modelRevision: true, sourceLineage: true },
    });
    const prefixCoverageMatches = persistedPrefix.length === requestedStartIndex
      && persistedPrefix.every((row, index) => {
        const expected = fullRange.days[index];
        return expected !== undefined
          && row.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION
          && row.modelEpisodeId === expected.modelEpisodeId
          && row.date === expected.date
          && row.boundaryAt.toISOString() === new Date(expected.boundaryAt).toISOString()
          && stableSha256(row.sourceLineage) === stableSha256(sourceLineage(expected));
      });
    const candidate = await prisma.unifiedExperimentalPhysiologyStateV2.findUnique({
      where: {
        profileId_modelEpisodeId_date: {
          profileId,
          modelEpisodeId: previousDay.modelEpisodeId,
          date: previousDay.date,
        },
      },
      select: {
        modelEpisodeId: true, date: true, boundaryAt: true, modelRevision: true,
        resultFingerprint: true, sourceFingerprint: true, state: true, uncertainty: true,
        sourceLineage: true,
      },
    });
    const candidateLedger = candidate?.modelRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION
      ? compatiblePredecessorLedger(candidate.state)
      : null;
    const lineage = object(candidate?.sourceLineage);
    const exactPredecessor = candidate !== null
      && candidate.modelEpisodeId === previousDay.modelEpisodeId
      && candidate.date === previousDay.date
      && candidate.boundaryAt.toISOString() === new Date(previousDay.boundaryAt).toISOString()
      && lineage.modelEpisodeId === previousDay.modelEpisodeId
      && lineage.modelDate === previousDay.date
      && lineage.boundaryAt === previousDay.boundaryAt
      && stableSha256(candidate.sourceLineage) === stableSha256(sourceLineage(previousDay));
    if (candidate && exactPredecessor && prefixCoverageMatches && candidateLedger !== null) {
      const ids = candidateLedger.map((entry) => entry.impulse.strengthDiarySessionId);
      const impulseRows = ids.length === 0 ? [] : await prisma.experimentalTransientExerciseWaterShadow.findMany({
        where: {
          profileId,
          modelRevision: "experimental-transient-exercise-water-v2-impulse-ledger",
          sessionId: { in: ids },
        },
        select: { sessionId: true, sourceFingerprint: true },
      });
      const fingerprints = new Map(impulseRows.map((row) => [row.sessionId, row.sourceFingerprint]));
      const ledgerMatchesCurrentRows = candidateLedger.every((entry) =>
        fingerprints.get(entry.impulse.strengthDiarySessionId) === entry.impulse.sourceFingerprint);
      if (ledgerMatchesCurrentRows) {
        predecessor = candidate;
        priorLedger = candidateLedger;
      }
    }
  }

  // The predecessor is the exact prior absolute boundary, not a lexical date
  // lookup. Any missing, stale, or boundary-incompatible row triggers full replay.
  const replayStartIndex = predecessor ? requestedStartIndex : 0;
  const replayDays = fullRange.days.slice(replayStartIndex);
  const prefixDays = fullRange.days.slice(0, replayStartIndex);
  const expectedRangeToken = unifiedRangeToken(profileId, fullRange.fromInstant, fullRange.throughInstant, fullRange.days);
  let priorState = predecessor?.state as UnifiedExperimentalPhysiologyStateV1 | null ?? null;
  if (priorLedger !== null && priorState !== null) {
    priorState = {
      ...priorState,
      transientWater: { ...priorState.transientWater, activeImpulses: priorLedger },
    };
  }
  let priorFingerprint = predecessor?.resultFingerprint ?? null;
  let priorUncertainty = predecessor?.uncertainty as UnifiedUncertaintyV1 | null ?? null;
  let previousDate: string | null = predecessor?.date ?? null;
  let previousObservedWeight: number | null = [...prefixDays]
    .reverse()
    .find((day) => day.dailyHealthData?.weightKg !== null && day.dailyHealthData?.weightKg !== undefined)
    ?.dailyHealthData?.weightKg ?? null;
  let gapRun = 0;
  for (const day of prefixDays) gapRun = day.dailyHealthData === null ? gapRun + 1 : 0;

  const serializedDays: ReturnType<typeof serializeUnifiedExperimentalPhysiologyV1>[] = [];
  for (const day of replayDays) {
    const gapDays = day.dailyHealthData === null ? ++gapRun : gapRun;
    const children = childTransitions(day, priorState);
    const production = day.productionDailyState;
    const activities = day.workouts.map((workout) => ({
      doseKey: "workout:" + workout.id,
      ...(workout.canonicalEnergyResolution === null || workout.canonicalEnergyResolution === undefined
        ? {}
        : { canonicalEventKey: "canonical-active-energy:" + workout.canonicalEnergyResolution.eventId }),
      kind: "workout" as const,
      garminActiveKcal: workout.activeEnergyKcal,
      bodyCastEstimateKcal: null,
      canonicalResolution: workout.canonicalEnergyResolution ? {
        kcal: workout.canonicalEnergyResolution.currentKcal,
        source: workout.canonicalEnergyResolution.currentSource,
        revision: workout.canonicalEnergyResolution.resolutionRevision,
        stale: workout.canonicalEnergyResolution.isStale,
      } : null,
    }));
    const unknownEnergyCount = activities.filter((activity) => activity.canonicalResolution
      ? activity.canonicalResolution.stale || activity.canonicalResolution.kcal === null
      : activity.garminActiveKcal === null).length;
    const ledger = buildUnifiedEnergyLedgerV1({
      production: {
        dynamicRmrKcalPerDay: production?.dynamicRmrKcalPerDay ?? null,
        tefKcalPerDay: production?.tefKcalPerDay ?? null,
        walkingKcalPerDay: null,
        occupationalKcalPerDay: null,
        workoutKcalPerDay: null,
        stepperKcalPerDay: null,
        activityKcalPerDay: production?.activityKcalPerDay ?? null,
        adaptiveThermogenesisKcalPerDay: production?.adaptiveThermogenesisKcalPerDay ?? null,
        personalOffsetKcalPerDay: null,
        productionTdeeKcalPerDay: production?.energyExpenditureKcal ?? null,
      },
      activities,
    });
    const observedWeight = day.dailyHealthData?.weightKg ?? null;
    const anchorWeight = previousObservedWeight;
    const selectionNote = selectionCoverageNote(day);
    const result = transitionUnifiedExperimentalPhysiologyV1({
      profileId,
      modelEpisodeId: day.modelEpisodeId,
      date: day.date,
      boundaryAt: day.boundaryAt,
      priorState,
      priorStateFingerprint: priorFingerprint,
      children,
      energyLedger: ledger,
      quality: quality(day, gapDays),
      uncertainty: uncertainty(priorUncertainty, day, unknownEnergyCount),
      reconciliation: {
        anchorDate: previousDate,
        anchorWeightKg: anchorWeight,
        observedWeightKg: observedWeight,
        reason: anchorWeight === null ? "no-prior-observed-weight" : null,
      },
      sourceLineage: sourceLineage(day),
      diagnostics: {
        notes: [
          "Unified V2 is shadow-only; production state is read-only input",
          "transient-output-count:" + day.childOutputs.transientWater.length,
          "energy-coverage:unknown=" + unknownEnergyCount,
          ...(selectionNote !== null ? [selectionNote] : []),
        ],
      },
    });
    const serialized = serializeUnifiedExperimentalPhysiologyV1(result);
    serializedDays.push(serialized);
    priorState = serialized.state;
    priorFingerprint = serialized.resultFingerprint;
    priorUncertainty = serialized.uncertainty;
    previousDate = day.date;
    if (observedWeight !== null) {
      previousObservedWeight = observedWeight;
      gapRun = 0;
    }
  }
  await input.onCandidateComputed?.();
  await prisma.$transaction(async (tx) => {
    const lifecycle = new PhysiologyV7PersistenceRepository(tx);
    await lifecycle.lockProfile(profileId);
    const current = await tx.physiologyV7Lifecycle.findUnique({
      where: { profileId },
      select: {
        invalidationGeneration: true, productionStaleFromDate: true,
        productionPublishedGeneration: true, updatedAt: true,
      },
    });
    if (!isProductionGenerationCurrentV1(current) || current.invalidationGeneration !== expectedGeneration
        || current.productionPublishedGeneration !== expectedGeneration
        || current.updatedAt.toISOString() !== expectedLifecycleUpdatedAt) {
      throw new PhysiologyV7ConcurrentSourceChangeError();
    }
    if (await readTransientExerciseWaterSourceTokenV2(tx, profileId) !== transientRebuild.sourceToken) {
      throw new PhysiologyV7ConcurrentSourceChangeError();
    }
    const currentRange = await new UnifiedExperimentalPhysiologySourceLoaderV1(tx).loadRange({
      profileId, fromInstant: replayFromInstant, throughInstant: replayThroughInstant,
    });
    if (unifiedRangeToken(profileId, currentRange.fromInstant, currentRange.throughInstant, currentRange.days) !== expectedRangeToken) {
      throw new PhysiologyV7ConcurrentSourceChangeError();
    }
    for (const result of serializedDays) {
      await tx.unifiedExperimentalPhysiologyStateV2.upsert({
        where: {
          profileId_modelEpisodeId_date: {
            profileId,
            modelEpisodeId: result.modelEpisodeId,
            date: result.date,
          },
        },
        create: toPersisted(result),
        update: toPersisted(result),
      });
    }
    const published = await tx.physiologyV7Lifecycle.updateMany({
      where: {
        profileId,
        invalidationGeneration: expectedGeneration,
        productionPublishedGeneration: expectedGeneration,
        productionStaleFromDate: null,
      },
      data: { unifiedPublishedGeneration: expectedGeneration },
    });
    if (published.count !== 1) throw new PhysiologyV7ConcurrentSourceChangeError();
  });
}
export const rebuildUnifiedExperimentalPhysiologyState = rebuildUnifiedExperimentalPhysiologyStateV1;
