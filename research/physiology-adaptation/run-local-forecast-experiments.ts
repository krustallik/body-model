import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { calculateEpisodeHistory } from "@/modules/model-episodes/episode-calculation";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { buildSimulationDays, eligibleHistoricalDonors } from "@/modules/model-episodes/simulation-input-builder";
import { analyzeStateContinuity } from "@/modules/model-episodes/unknown-intervals";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { localDateTimeToInstant } from "@/model/time-zone";
import { simulateDays, type PhysiologicalSimulatorState } from "@/model/physiological-simulator";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { DEFAULT_EXPENDITURE_PERSONALIZATION } from "@/model/dynamic-daily-expenditure";
import { resolveWorkoutFeedObserved } from "@/modules/health/workout-feed-coverage";
import { projectReliableForecastBehaviorDay } from "@/modules/model-forecast/model-forecast.service";
import { runForecastWithInternalArtifacts } from "@/modules/model-forecast/forecast-engine";
import { DEFAULT_FORECAST_CONFIG, type ForecastBehaviorDay, type ForecastDateSummary, type ForecastScenario } from "@/modules/model-forecast/forecast.types";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";
import { forecastRobustLogSpread as robustLogSpread, halfForecastDrift, withinDonorWindow } from "./methods";
import { adaptiveLocalLevelWeightFilterAsOf, assessUncertaintyAwareFallback, boundedOnlineCorrection, causalWeightFilterAsOf, estimateEnergyDriftCorrection, estimatePersistentBias, estimateResidualPersistence, estimateTwoTimescaleResidual, filterOnlyStateCorrection, latestWeightSnapshotsAsOf, newOutcomeResidualIfEligible, outcomeArrivedAfterCutoff, prequentialIntervalWidening, prepareActivityIntervalSnapshots, projectPreparedActivityIntervalsAsOf, residualsAvailableAt, robustTrendWeightForecast, selectAsOfSources, waterOnlyInitializationCorrection, weightOutcomeLabelsAsOf, type ForecastIntervalOutcome } from "./methods";

const DEFAULT_LOCAL_DB = { host: "127.0.0.1", port: 55449, serverPort: 55449,
  database: "bodycast_forensic_test", user: "bodycast_forensic" };
const LOCAL_DB = {
  host: process.env.BODYCAST_RESEARCH_DB_HOST ?? DEFAULT_LOCAL_DB.host,
  port: Number(process.env.BODYCAST_RESEARCH_DB_PORT ?? DEFAULT_LOCAL_DB.port),
  serverPort: Number(process.env.BODYCAST_RESEARCH_DB_SERVER_PORT ?? DEFAULT_LOCAL_DB.serverPort),
  database: process.env.BODYCAST_RESEARCH_DB_NAME ?? DEFAULT_LOCAL_DB.database,
  user: process.env.BODYCAST_RESEARCH_DB_USER ?? DEFAULT_LOCAL_DB.user,
};
const PROFILE_ID = Number(process.env.BODYCAST_RESEARCH_PROFILE_ID);
const CUTOFF_DATE = process.env.BODYCAST_RESEARCH_CUTOFF_DATE ?? "";
const ORIGIN_START = process.env.BODYCAST_RESEARCH_ORIGIN_START ?? "";
const ORIGIN_END = process.env.BODYCAST_RESEARCH_ORIGIN_END ?? "";
const ROOT = path.join(process.env.LOCALAPPDATA!, "BodyCastForensics", "physiology-research");
const OUTPUT = path.join(ROOT, "offline-experiments-trend-shrinkage-aligned.json");
const ISO = (value: Date | string) => value instanceof Date ? value.toISOString() : value;
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function healthSyncSnapshotFingerprint(rows: readonly unknown[]): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(JSON.stringify(row));
    hash.update("\n");
  }
  return hash.digest("hex");
}
const nextLocalMidnight = (date: string, timezone: string) => localDateTimeToInstant(addCalendarDays(date, 1), "00:00", timezone);

function metrics(rows: Array<{ prediction: number; observed: number; p05: number; p95: number }>) {
  if (rows.length === 0) return null;
  const errors = rows.map((r) => r.prediction - r.observed);
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const mae = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rmse = Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length);
  const errorMean = mean;
  const centered = errors.map((e) => e - errorMean);
  const denominator = centered.slice(1).reduce((sum, e) => sum + e * e, 0);
  const lag1 = denominator === 0 || centered.length < 3 ? null
    : centered.slice(1).reduce((sum, e, index) => sum + e * centered[index], 0) / denominator;
  return {
    n: rows.length,
    biasKg: mean,
    maeKg: mae,
    rmseKg: rmse,
    p90AbsoluteErrorKg: abs[Math.min(abs.length - 1, Math.ceil(abs.length * 0.9) - 1)],
    maxAbsoluteErrorKg: abs.at(-1),
    lag1ErrorAutocorrelation: lag1,
    p05p95Coverage: rows.filter((r) => r.observed >= r.p05 && r.observed <= r.p95).length / rows.length,
    meanP05P95WidthKg: rows.reduce((sum, r) => sum + r.p95 - r.p05, 0) / rows.length,
  };
}

function sourceNumber(value: unknown): number | null { return value == null ? null : Number(value); }
const clampResearchOffset = (value: number) => Math.min(500, Math.max(-500, value));

function errorMetrics(rows: Array<{ prediction: number; observed: number }>) {
  if (rows.length === 0) return null;
  const errors = rows.map((row) => row.prediction - row.observed);
  return {
    n: errors.length,
    biasKg: errors.reduce((sum, error) => sum + error, 0) / errors.length,
    maeKg: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
    rmseKg: Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length),
  };
}

function pairedBlockBootstrapDeltaMae(
  activeRows: readonly { prediction: number; observed: number }[],
  candidateRows: readonly { prediction: number; observed: number }[],
  blockLength: number,
  seedText: string,
) {
  if (activeRows.length !== candidateRows.length || activeRows.length === 0) return null;
  const lossDeltas = activeRows.map((active, index) =>
    Math.abs(active.prediction - active.observed)
      - Math.abs(candidateRows[index]!.prediction - candidateRows[index]!.observed));
  const point = lossDeltas.reduce((sum, value) => sum + value, 0) / lossDeltas.length;
  const seed = Number.parseInt(createHash("sha256").update(seedText).digest("hex").slice(0, 8), 16) || 1;
  let randomState = seed >>> 0;
  const random = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0x1_0000_0000;
  };
  const samples: number[] = [];
  for (let replicate = 0; replicate < 4000; replicate += 1) {
    const sample: number[] = [];
    while (sample.length < lossDeltas.length) {
      const start = Math.floor(random() * lossDeltas.length);
      for (let offset = 0; offset < blockLength && sample.length < lossDeltas.length; offset += 1) {
        sample.push(lossDeltas[(start + offset) % lossDeltas.length]!);
      }
    }
    samples.push(sample.reduce((sum, value) => sum + value, 0) / sample.length);
  }
  samples.sort((left, right) => left - right);
  return { meanDeltaMaeKg: point,
    percentile95IntervalKg: [samples[Math.floor((samples.length - 1) * 0.025)]!,
      samples[Math.ceil((samples.length - 1) * 0.975)]!],
    blockLengthOrigins: blockLength, resamples: samples.length };
}

async function main() {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (PROFILE_ID !== 1
      || !validDate(CUTOFF_DATE) || !validDate(ORIGIN_START) || !validDate(ORIGIN_END)
      || ORIGIN_START > ORIGIN_END) {
    throw new Error("Set BODYCAST_RESEARCH_PROFILE_ID=1 and valid cutoff/origin dates for the isolated Profile 1 dataset");
  }
  if (LOCAL_DB.host !== "127.0.0.1"
      || !/^bodycast_[a-z0-9_]*_test(?:_[0-9]{8})?$/.test(LOCAL_DB.database)
      || !(/^bodycast_[a-z0-9_]+_test$/.test(LOCAL_DB.user)
        || (LOCAL_DB.user === DEFAULT_LOCAL_DB.user && LOCAL_DB.database === DEFAULT_LOCAL_DB.database
          && LOCAL_DB.port === DEFAULT_LOCAL_DB.port && LOCAL_DB.serverPort === DEFAULT_LOCAL_DB.serverPort))
      || !Number.isInteger(LOCAL_DB.port) || LOCAL_DB.port < 1 || LOCAL_DB.port > 65535
      || !Number.isInteger(LOCAL_DB.serverPort) || LOCAL_DB.serverPort < 1 || LOCAL_DB.serverPort > 65535) {
    throw new Error("Research replay accepts only an explicit local bodycast *_test database identity");
  }
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  if (dbUrl.hostname !== LOCAL_DB.host || dbUrl.port !== String(LOCAL_DB.port)
      || dbUrl.pathname !== `/${LOCAL_DB.database}`) throw new Error("DB_GUARD");
  const identity = await prisma.$queryRaw<Array<{ database: string; port: number; user: string }>>`
    SELECT current_database() AS database, inet_server_port() AS port, current_user AS user`;
  if (identity[0]?.database !== LOCAL_DB.database || Number(identity[0]?.port) !== LOCAL_DB.serverPort
      || identity[0]?.user !== LOCAL_DB.user) throw new Error("DB_IDENTITY_GUARD");

  const episodeRepo = new ModelEpisodeRepository(PROFILE_ID, prisma);
  const episode = await episodeRepo.getActive();
  if (!episode) throw new Error("NO_ACTIVE_EPISODE");
  // Recalculation mutates calibration outputs and latestModeledDate, but the
  // episode's initialization inputs are frozen at creation. Rebuild each
  // historical origin from that initial personalization prior.
  const initialPersonalOffsetKcalPerDay = episode.initialPersonalOffsetKcalPerDay ?? 0;
  const episodeAtOrigin = {
    ...episode,
    initialPersonalOffsetKcalPerDay,
    personalOffsetKcalPerDay: initialPersonalOffsetKcalPerDay,
    activityCalibration: DEFAULT_EXPENDITURE_PERSONALIZATION.activityCalibration,
  };
  const summary = await prisma.dailyHealthData.findMany({
    where: { profileId: PROFILE_ID, date: { gte: episode.startDate, lte: CUTOFF_DATE } },
    select: { date: true, weightKg: true }, orderBy: { date: "asc" },
  });
  const finalWeights = new Map(summary.flatMap((row) => row.weightKg == null ? [] : [[row.date, Number(row.weightKg)] as const]));
  const snapshotWhere = { profileId: PROFILE_ID, date: { gte: episode.startDate, lte: CUTOFF_DATE } };
  const snapshotIds = await prisma.healthSyncSnapshot.findMany({
    where: snapshotWhere, orderBy: { id: "asc" }, select: { id: true },
  });
  const snapshotBatches = [];
  for (let offset = 0; offset < snapshotIds.length; offset += 128) {
    snapshotBatches.push(await prisma.healthSyncSnapshot.findMany({
      where: { id: { in: snapshotIds.slice(offset, offset + 128).map(({ id }) => id) } },
    }));
  }
  const allSnapshots = snapshotBatches.flat().sort((left, right) => left.date.localeCompare(right.date)
    || left.receivedAt.getTime() - right.receivedAt.getTime() || left.id - right.id);
  const outcomeLabelCutoff = nextLocalMidnight(CUTOFF_DATE, episode.timezone);
  const outcomeLabelsByDate = new Map(weightOutcomeLabelsAsOf(allSnapshots.map((row) => ({
    id: row.id, date: row.date, weightKg: row.weightKg == null ? null : Number(row.weightKg), receivedAt: row.receivedAt,
  })), outcomeLabelCutoff).map(({ date, weightKg, receivedAt, firstReceivedAt }) => [date, {
    date, weightKg, receivedAt, firstReceivedAt,
  }] as const));
  const preparedActivitySnapshots = prepareActivityIntervalSnapshots(allSnapshots.map((row) => ({
    id: row.id, profileId: PROFILE_ID, date: row.date, receivedAt: row.receivedAt,
    timezone: row.timezone, rawPayload: row.rawPayload,
  })));
  const [workMeta, workoutMeta, heartMeta, sessionMeta,
    aliasMeta, eventMeta, resolutionMeta] = await Promise.all([
    prisma.workInterval.findMany({ where: { profileId: PROFILE_ID }, select: { id: true, createdAt: true, updatedAt: true } }),
    prisma.workout.findMany({ where: { profileId: PROFILE_ID }, select: { id: true, createdAt: true, updatedAt: true } }),
    prisma.heartRateSample.findMany({ where: { profileId: PROFILE_ID }, select: { date: true, timestamp: true, bpm: true, source: true, createdAt: true, updatedAt: true } }),
    prisma.strengthDiarySession.findMany({ where: { profileId: PROFILE_ID }, select: { id: true, matchedWorkoutId: true, createdAt: true, updatedAt: true } }),
    prisma.activeEnergyEventAlias.findMany({ where: { profileId: PROFILE_ID, sourceType: { in: ["workout", "strength-session"] } }, select: { sourceId: true, workoutId: true, eventId: true, createdAt: true, sourceType: true } }),
    prisma.activeEnergyCanonicalEvent.findMany({ where: { profileId: PROFILE_ID }, select: { id: true, createdAt: true, updatedAt: true, currentKcal: true, currentSource: true, resolutionRevision: true, isStale: true } }),
    prisma.activeEnergyResolutionRevision.findMany({ where: { profileId: PROFILE_ID }, select: { eventId: true, revision: true, createdAt: true, source: true, valueKcal: true } }),
  ]);
  const canonicalRevisionRows = resolutionMeta.length;
  const workById = new Map(workMeta.map((r) => [r.id, r]));
  const workoutById = new Map(workoutMeta.map((r) => [r.id, r]));
  const heartKey = (r: { date: string; timestamp: Date; bpm: number; source: string }) => `${r.date}|${r.timestamp.getTime()}|${r.bpm}|${r.source}`;
  const heartMetaByKey = new Map(heartMeta.map((r) => [heartKey(r), r]));
  const sessionById = new Map(sessionMeta.map((r) => [r.id, r]));
  const sessionByWorkout = new Map(sessionMeta.filter((r) => r.matchedWorkoutId != null).map((r) => [r.matchedWorkoutId!, r]));
  const eventById = new Map(eventMeta.map((r) => [r.id, r]));
  const initialWindowEnd = addCalendarDays(episode.startDate, 6);
  const initialWeightObservationsAtCreation = latestWeightSnapshotsAsOf(allSnapshots.map((row) => ({
    id: row.id, date: row.date, weightKg: row.weightKg == null ? null : Number(row.weightKg), receivedAt: row.receivedAt,
  })), new Date(episode.createdAt))
    .filter((reading) => reading.date >= episode.startDate && reading.date <= initialWindowEnd);
  const initialWeightsAvailableAtCreation = initialWeightObservationsAtCreation.map((reading) => reading.weightKg);
  const initialWindowMedianKg = initialWeightsAvailableAtCreation.length >= 5
    ? medianOf(initialWeightsAvailableAtCreation) : null;
  const snapshotFingerprintBefore = healthSyncSnapshotFingerprint(allSnapshots);
  const replaySources = await episodeRepo.loadSources(episode.startDate, CUTOFF_DATE, episode.timezone);
  const replayDays = buildSimulationDays({ from: episode.startDate, to: CUTOFF_DATE, sources: replaySources,
    baselineNutritionFallback: episode.baselineNutritionFallback,
    nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    modelVersion: episode.modelVersion, timeZone: episode.timezone });
  const fullReplay = calculateEpisodeHistory({ episode: episodeAtOrigin, days: replayDays });
  const repeatedReplay = calculateEpisodeHistory({ episode: episodeAtOrigin, days: replayDays });
  const storedDailyStates = await prisma.dailyModelState.findMany({ where: { episodeId: episode.id },
    select: { date: true, status: true, endWeightKg: true, filteredWeightKg: true, fatMassKg: true,
      leanTissueKg: true, glycogenKg: true, extracellularFluidDeviationLiters: true,
      dynamicRmrKcalPerDay: true, tefKcalPerDay: true, activityKcalPerDay: true,
      adaptiveThermogenesisKcalPerDay: true, energyIntakeKcal: true, energyExpenditureKcal: true,
      energyBalanceKcal: true, deltaFatKg: true, deltaLeanTissueKg: true, deltaGlycogenKg: true,
      weightFilterVarianceKg2: true }, orderBy: { date: "asc" } });
  const storedByDate = new Map(storedDailyStates.map((row) => [row.date, row]));
  const replayNumericFields = ["endWeightKg", "filteredWeightKg", "fatMassKg", "leanTissueKg", "glycogenKg",
    "extracellularFluidDeviationLiters", "dynamicRmrKcalPerDay", "tefKcalPerDay", "activityKcalPerDay",
    "adaptiveThermogenesisKcalPerDay", "energyIntakeKcal", "energyExpenditureKcal", "energyBalanceKcal",
    "deltaFatKg", "deltaLeanTissueKg", "deltaGlycogenKg", "weightFilterVarianceKg2"] as const;
  const replayDiffs = Object.fromEntries(replayNumericFields.map((field) => [field, 0])) as Record<typeof replayNumericFields[number], number>;
  let replayComparedValues = 0;
  for (const state of fullReplay.dailyStates) {
    const stored = storedByDate.get(state.date);
    if (!stored) continue;
    for (const field of replayNumericFields) {
      const expected = state[field];
      const actual = stored[field];
      if (expected === null || actual === null) continue;
      replayDiffs[field] = Math.max(replayDiffs[field], Math.abs(expected - Number(actual)));
      replayComparedValues += 1;
    }
  }
  const observedReplayRows = fullReplay.dailyStates.flatMap((state) => {
    const observed = finalWeights.get(state.date);
    return observed == null || state.endWeightKg === null ? [] : [{ date: state.date, observed,
      predicted: state.endWeightKg, filtered: state.filteredWeightKg }];
  });
  const energyRows = fullReplay.dailyStates.filter((state) => state.energyIntakeKcal !== null
    && state.energyExpenditureKcal !== null && state.energyBalanceKcal !== null);
  const energyIdentityMaxErrorKcal = energyRows.reduce((max, state) => Math.max(max,
    Math.abs((state.energyIntakeKcal! - state.energyExpenditureKcal!) - state.energyBalanceKcal!)), 0);
  const firstWeekReplayStates = fullReplay.dailyStates.filter((state) => state.date >= episode.startDate
    && state.date <= initialWindowEnd && state.endWeightKg !== null);
  const episodeStartEpoch = Date.parse(`${episode.startDate}T00:00:00.000Z`);
  const stateFitWindows = [...new Set(observedReplayRows.map((row) => Math.floor(
    (Date.parse(`${row.date}T00:00:00.000Z`) - episodeStartEpoch) / (14 * 86_400_000),
  )))].sort((a, b) => a - b).map((windowIndex) => {
    const rows = observedReplayRows.filter((row) => Math.floor(
      (Date.parse(`${row.date}T00:00:00.000Z`) - episodeStartEpoch) / (14 * 86_400_000),
    ) === windowIndex);
    return { fromDate: addCalendarDays(episode.startDate, windowIndex * 14),
      throughDate: addCalendarDays(episode.startDate, windowIndex * 14 + 13),
      physiologicalWeight: errorMetrics(rows.map((row) => ({ prediction: row.predicted, observed: row.observed }))),
      filteredWeight: errorMetrics(rows.flatMap((row) => row.filtered === null ? [] : [{ prediction: row.filtered, observed: row.observed }])) };
  });
  const firstWeekStateByDate = new Map(firstWeekReplayStates.map((state) => [state.date, state]));
  const firstWeekWeightErrors = initialWeightObservationsAtCreation.flatMap((reading) => {
    const state = firstWeekStateByDate.get(reading.date);
    return state?.endWeightKg === null || !state ? [] : [{ prediction: state.endWeightKg, observed: reading.weightKg }];
  });
  const firstWeekModelledWeights = firstWeekReplayStates.flatMap((state) => state.endWeightKg === null ? [] : [state.endWeightKg]);
  const firstWeekReplayEnd = firstWeekReplayStates.at(-1);
  const firstWeekEnergyRows = firstWeekReplayStates.filter((state) => state.energyBalanceKcal !== null);
  const storedCalibrationFingerprint = episode.calibrationDiagnostics && typeof episode.calibrationDiagnostics === "object"
    ? (episode.calibrationDiagnostics as { calibrationInputFingerprint?: unknown }).calibrationInputFingerprint
    : null;
  const retrospectiveReplay = {
    deterministic: sha(fullReplay.dailyStates) === sha(repeatedReplay.dailyStates),
    outputDays: fullReplay.dailyStates.length,
    storedDays: storedDailyStates.length,
    comparedNumericValues: replayComparedValues,
    maxAbsDiffByField: replayDiffs,
    stateResidualMetrics: {
      physiologicalWeight: errorMetrics(observedReplayRows.map((row) => ({ prediction: row.predicted, observed: row.observed }))),
      filteredWeight: errorMetrics(observedReplayRows.flatMap((row) => row.filtered === null ? [] : [{ prediction: row.filtered, observed: row.observed }])) ,
    },
    stateFitWindows,
    meanFilterAdjustmentKg: observedReplayRows.length === 0 ? null
      : observedReplayRows.reduce((sum, row) => sum + (row.filtered ?? row.predicted) - row.predicted, 0) / observedReplayRows.length,
    firstObservedState: observedReplayRows[0] ?? null,
    lastObservedState: observedReplayRows.at(-1) ?? null,
    initialization: {
      status: episode.initializationStatus,
      observationDayCount: episode.baselineWeightObservationCount,
      reconstructedWeightKg: reconstructBodyWeightKg(episode.initialState),
      fatMassKg: episode.initialState.fatMassKg,
      leanTissueKg: episode.initialState.leanTissueKg,
      glycogenKg: episode.initialState.glycogenKg,
      glycogenAssociatedWaterKg: episode.initialState.glycogenKg * 2.7,
      baselineExtracellularFluidLiters: episode.initialState.baselineExtracellularFluidLiters,
      extracellularFluidDeviationLiters: episode.initialState.extracellularFluidDeviationLiters,
      ecfPolicy: episode.ecfPolicy,
      diagnostics: episode.initializationDiagnostics,
      firstSevenDayObservationsAvailableAtEpisodeCreation: initialWeightsAvailableAtCreation.length,
      firstSevenDayMedianKg: initialWindowMedianKg,
      firstSevenDayMedianDeltaKg: initialWindowMedianKg === null ? null
        : initialWindowMedianKg - reconstructBodyWeightKg(episode.initialState),
      firstWeekAtEpisodeCreationVsReplay: {
        interpretation: "retrospective replay diagnostic; not as-issued forecast accuracy or compartment evidence",
        observedWeightsKnownByEpisodeCreation: initialWeightObservationsAtCreation.length,
        observedMedianKg: initialWindowMedianKg,
        modelledWeightMedianKg: firstWeekModelledWeights.length === 0 ? null : medianOf(firstWeekModelledWeights),
        modelledMinusObservedWeightMetrics: errorMetrics(firstWeekWeightErrors),
        modelledWeightChangeFromInitialStateKg: firstWeekReplayEnd?.endWeightKg == null ? null
          : firstWeekReplayEnd.endWeightKg - reconstructBodyWeightKg(episode.initialState),
        cumulativeModelEnergyBalanceKcal: firstWeekEnergyRows.length === 0 ? null
          : firstWeekEnergyRows.reduce((sum, state) => sum + state.energyBalanceKcal!, 0),
        modelledTissueChangesKg: firstWeekReplayEnd ? {
          fat: (firstWeekReplayEnd.fatMassKg ?? episode.initialState.fatMassKg) - episode.initialState.fatMassKg,
          lean: (firstWeekReplayEnd.leanTissueKg ?? episode.initialState.leanTissueKg) - episode.initialState.leanTissueKg,
          glycogenAndAssociatedWater: ((firstWeekReplayEnd.glycogenKg ?? episode.initialState.glycogenKg)
            - episode.initialState.glycogenKg) * 3.7,
          ecfDeviationLiters: (firstWeekReplayEnd.extracellularFluidDeviationLiters
            ?? episode.initialState.extracellularFluidDeviationLiters) - episode.initialState.extracellularFluidDeviationLiters,
        } : null,
      },
    },
    energyAccounting: {
      completeEnergyDays: energyRows.length,
      meanIntakeKcal: energyRows.length ? energyRows.reduce((sum, row) => sum + row.energyIntakeKcal!, 0) / energyRows.length : null,
      meanExpenditureKcal: energyRows.length ? energyRows.reduce((sum, row) => sum + row.energyExpenditureKcal!, 0) / energyRows.length : null,
      meanDynamicRmrKcal: energyRows.length ? energyRows.reduce((sum, row) => sum + (row.dynamicRmrKcalPerDay ?? 0), 0) / energyRows.length : null,
      meanTefKcal: energyRows.length ? energyRows.reduce((sum, row) => sum + (row.tefKcalPerDay ?? 0), 0) / energyRows.length : null,
      meanActivityKcal: energyRows.length ? energyRows.reduce((sum, row) => sum + (row.activityKcalPerDay ?? 0), 0) / energyRows.length : null,
      meanAdaptiveThermogenesisKcal: energyRows.length ? energyRows.reduce((sum, row) => sum + (row.adaptiveThermogenesisKcalPerDay ?? 0), 0) / energyRows.length : null,
      meanBalanceKcal: energyRows.length ? energyRows.reduce((sum, row) => sum + row.energyBalanceKcal!, 0) / energyRows.length : null,
      energyBalanceIdentityMaxErrorKcal: energyIdentityMaxErrorKcal,
    },
    calibration: {
      status: fullReplay.calibration.status,
      accepted: fullReplay.calibration.diagnostics.personalizationAccepted,
      observationCount: fullReplay.calibration.diagnostics.observationCount,
      trainingObservationCount: fullReplay.calibration.diagnostics.trainingObservationCount,
      validationObservationCount: fullReplay.calibration.diagnostics.validationObservationCount,
      observationSpanDays: fullReplay.calibration.diagnostics.observationSpanDays,
      parameterAtBound: fullReplay.calibration.diagnostics.parameterAtBound,
      defaultValidationNis: fullReplay.calibration.diagnostics.defaultValidationNis,
      attemptedOffsetKcalPerDay: fullReplay.calibration.diagnostics.attemptedOffsetPersonalOffsetKcalPerDay,
      attemptedOffsetValidationNis: fullReplay.calibration.diagnostics.attemptedOffsetValidationNis,
      warnings: fullReplay.calibration.diagnostics.warnings,
    },
    calibrationInputFingerprint: {
      stored: typeof storedCalibrationFingerprint === "string" ? storedCalibrationFingerprint : null,
      recomputed: fullReplay.calibrationInputFingerprint,
    },
  };
  const originFirst = ORIGIN_START;
  const originLast = ORIGIN_END;
  const origins: string[] = [];
  for (let d = originFirst; d <= originLast; d = addCalendarDays(d, 1)) origins.push(d);
  const scenario: ForecastScenario = { mode: "recent-behavior", donorLookbackDays: 56, blockLengthDays: 7 };
  const config = { ...DEFAULT_FORECAST_CONFIG };
  const horizons = [1, 3, 7, 14] as const;
  const forecastByOrigin = new Map<string, { baseline: ForecastDateSummary[]; init: ForecastDateSummary[]; filter: ForecastDateSummary[]; energy: ForecastDateSummary[]; energyDrift: ForecastDateSummary[]; energyDriftDiagnostics: unknown; residualPersistenceDiagnostics: unknown; source: string; donorCount: number; originLatestWeightKg: number; effectiveOriginDate: string; calibration: unknown; initRequestedDeltaKg: number | null; initAppliedDeltaKg: number | null; onlineCorrectionKg: number | null }>();
  const weightBaselinesByOrigin = new Map<string, { lastKnownWeightKg: number | null; causalFilterWeightKg: number | null; adaptiveFilterWeightKg: number | null; adaptiveFilterVarianceKg2: number | null; adaptiveProcessNoiseVarianceKg2PerDay: number | null; robustTrend: Record<string, { estimateKg: number; slopeKgPerDay: number; observationCount: number } | null>; knownWeightCount: number }>();
  const errorsAvailableLater: Array<{ date: string; observedKg: number; predictedKg: number; availableAt: string }> = [];
  const coverageByOrigin: Array<{ origin: string; status: string; knownDays: number; donorCount: number; calibrationStatus: string; inputHash: string }> = [];
  let deterministicReplayVerified: boolean | null = null;
  let firstOriginCausalAssimilation: { observationCount: number; firstEstimateKg: number | null; latestObservationKg: number | null; latestPosteriorKg: number | null } | null = null;
  let lastOriginCausalAssimilation: { observationCount: number; latestObservationKg: number | null; latestPosteriorKg: number | null } | null = null;

  for (const originDate of origins) {
    const cutoff = nextLocalMidnight(originDate, episode.timezone);
    const episodeWasCreated = new Date(episode.createdAt) < cutoff;
    if (!episodeWasCreated) {
      coverageByOrigin.push({ origin: originDate,
        status: "episode-not-created",
        knownDays: 0, donorCount: 0, calibrationStatus: "not-run", inputHash: "" });
      continue;
    }
    const asOfSnaps = allSnapshots.filter((row) => row.date <= originDate && row.receivedAt < cutoff);
    const activityIntervalProjection = projectPreparedActivityIntervalsAsOf(preparedActivitySnapshots,
      { profileId: PROFILE_ID, originDate, inputAsOf: cutoff });
    const weightProjection = new Map<string, { weightKg: number | null; availableAt: Date | null }>();
    for (const row of asOfSnaps) {
      const payload = typeof row.rawPayload === "object" && row.rawPayload !== null && !Array.isArray(row.rawPayload)
        ? row.rawPayload as Record<string, unknown> : {};
      if (Object.prototype.hasOwnProperty.call(payload, "weightKg") || row.weightKg !== null) {
        weightProjection.set(row.date, { weightKg: sourceNumber(row.weightKg),
          availableAt: row.weightKg === null ? null : row.receivedAt });
      }
    }
    const asOfWeightObservations = [...weightProjection.entries()].flatMap(([date, row]) => (
      row.weightKg === null || row.availableAt === null ? [] : [{ date, weightKg: row.weightKg, availableAt: row.availableAt }]
    ));
    const latestAsOfWeight = [...asOfWeightObservations].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.weightKg ?? null;
    const causalFilter = causalWeightFilterAsOf(asOfWeightObservations.map(({ date, weightKg, availableAt }) => ({
      date, weightKg, receivedAt: availableAt,
    })), { originDate, inputAsOf: cutoff });
    const adaptiveFilter = adaptiveLocalLevelWeightFilterAsOf(asOfWeightObservations.map(({ date, weightKg, availableAt }) => ({
      date, weightKg, receivedAt: availableAt,
    })), { originDate, inputAsOf: cutoff });
    const firstUpdate = causalFilter.updates[0] ?? null;
    const latestUpdate = causalFilter.updates.at(-1) ?? null;
    if (originDate === originFirst) firstOriginCausalAssimilation = {
      observationCount: causalFilter.observationCount,
      firstEstimateKg: firstUpdate?.posteriorEstimateKg ?? null,
      latestObservationKg: latestUpdate?.observedWeightKg ?? null,
      latestPosteriorKg: latestUpdate?.posteriorEstimateKg ?? null,
    };
    if (originDate === originLast) lastOriginCausalAssimilation = {
      observationCount: causalFilter.observationCount,
      latestObservationKg: latestUpdate?.observedWeightKg ?? null,
      latestPosteriorKg: latestUpdate?.posteriorEstimateKg ?? null,
    };
    weightBaselinesByOrigin.set(originDate, {
      lastKnownWeightKg: latestAsOfWeight,
      causalFilterWeightKg: causalFilter.stateAtOriginDate?.estimatedWeightKg ?? null,
      adaptiveFilterWeightKg: adaptiveFilter.stateAtOriginDate?.estimatedWeightKg ?? null,
      adaptiveFilterVarianceKg2: adaptiveFilter.stateAtOriginDate?.varianceKg2 ?? null,
      adaptiveProcessNoiseVarianceKg2PerDay: adaptiveFilter.processNoiseVarianceKg2PerDay,
      knownWeightCount: asOfWeightObservations.length,
      robustTrend: Object.fromEntries(horizons.map((horizon) => [String(horizon), robustTrendWeightForecast(
        asOfWeightObservations,
        { originDate, inputAsOf: cutoff, targetDate: addCalendarDays(originDate, horizon) },
      )])),
    });
    if (!activityIntervalProjection.complete) {
      coverageByOrigin.push({ origin: originDate, status: "as-of-activity-interval-payload-gap",
        knownDays: asOfWeightObservations.length, donorCount: 0, calibrationStatus: "not-run", inputHash: "" });
      continue;
    }
    const contextFrom = addCalendarDays(episode.startDate, -2);
    const contextTo = addCalendarDays(originDate, 2);
    const workoutWindowStart = localDateTimeToInstant(episode.startDate, "00:00", episode.timezone);
    const workoutWindowEnd = localDateTimeToInstant(addCalendarDays(originDate, 1), "00:00", episode.timezone);
    // Mirror loadSources' relationship/date scope, but omit the current group-status filter
    // so rejected groups with later-mutated status cannot disappear from this guard.
    const reconciliationCandidates = await prisma.stepperReconciliationCandidate.findMany({
      where: { profileId: PROFILE_ID, OR: [
        { manualWorkout: { dailyHealthData: { date: { gte: contextFrom, lte: contextTo } } } },
        { garminWorkout: { dailyHealthData: { date: { gte: contextFrom, lte: contextTo } } } },
        { manualWorkout: { startAt: { gte: workoutWindowStart, lt: workoutWindowEnd } } },
        { garminWorkout: { startAt: { gte: workoutWindowStart, lt: workoutWindowEnd } } },
      ] },
      select: { group: { select: { id: true, profileId: true, createdAt: true, updatedAt: true, status: true } } },
    });
    const reconciliationGroups = [...new Map(reconciliationCandidates.map(({ group }) => [group.id, group])).values()];
    const reconciliationGroupsAsOf = selectAsOfSources(reconciliationGroups, PROFILE_ID, new Date(cutoff.getTime() - 1));
    if (reconciliationGroupsAsOf.length !== reconciliationGroups.length) {
      coverageByOrigin.push({ origin: originDate, status: "reconciliation-group-state-updated-after-origin",
        knownDays: 0, donorCount: 0, calibrationStatus: "not-run", inputHash: "" });
      continue;
    }
    const raw = await episodeRepo.loadSources(episode.startDate, originDate, episode.timezone);
    if ((raw.reconciliationLinks?.length ?? 0) > 0) {
      coverageByOrigin.push({ origin: originDate, status: "reconciliation-links-have-no-as-of-version",
        knownDays: 0, donorCount: 0, calibrationStatus: "not-run", inputHash: "" });
      continue;
    }
    // HealthSyncSnapshot is an append-only sync log, not a complete replacement
    // snapshot: omitted fields leave DailyHealthData unchanged. Project those
    // same semantics as-of receipt time, preserving explicit nulls when the
    // original payload contains that field.
    const projectedByDate = new Map<string, {
      date: string;
      weightKg: number | null;
      bodyFatPercent: number | null;
      caloriesKcal: number | null;
      proteinG: number | null;
      fatG: number | null;
      carbsG: number | null;
      averageWalkingSpeedKmh: number | null;
      walkingDistanceKm: number | null;
      strengthTrainingMinutes: number | null;
      workoutFeedObserved: boolean | null;
    }>();
    const projectedFields = [
      "weightKg", "bodyFatPercent", "caloriesKcal", "proteinG", "fatG", "carbsG",
      "averageWalkingSpeedKmh", "walkingDistanceKm", "strengthTrainingMinutes",
    ] as const;
    for (const row of asOfSnaps) {
      const projected = projectedByDate.get(row.date) ?? {
        date: row.date, weightKg: null, bodyFatPercent: null, caloriesKcal: null,
        proteinG: null, fatG: null, carbsG: null, averageWalkingSpeedKmh: null,
        walkingDistanceKm: null, strengthTrainingMinutes: null, workoutFeedObserved: null,
      };
      const payload = typeof row.rawPayload === "object" && row.rawPayload !== null && !Array.isArray(row.rawPayload)
        ? row.rawPayload as Record<string, unknown> : {};
      for (const field of projectedFields) {
        if (Object.prototype.hasOwnProperty.call(payload, field) || row[field] !== null) {
          projected[field] = sourceNumber(row[field]);
        }
      }
      const feedObserved = resolveWorkoutFeedObserved(row.rawPayload);
      if (feedObserved !== null) projected.workoutFeedObserved = feedObserved;
      projectedByDate.set(row.date, projected);
    }
    const walkingDistanceByDate = new Map<string, number>();
    for (const interval of activityIntervalProjection.rows) {
      if (interval.metric !== "walking-distance-km" || interval.startAt >= cutoff
          || interval.endAt > cutoff) continue;
      walkingDistanceByDate.set(interval.date,
        (walkingDistanceByDate.get(interval.date) ?? 0) + interval.value);
    }
    const days = [...projectedByDate.values()].map((day) => ({
      ...day,
      // Health sync persists interval-series distance as the daily aggregate;
      // derive that exact aggregate when the sync snapshot stored no scalar.
      walkingDistanceKm: day.walkingDistanceKm ?? walkingDistanceByDate.get(day.date) ?? null,
    })).sort((a, b) => a.date.localeCompare(b.date));
    const source: HistoricalModelSources = {
      ...raw,
      days,
      snapshots: raw.snapshots.filter((r) => r.date <= originDate && r.receivedAt < cutoff),
      activityIntervals: activityIntervalProjection.rows.filter((r) => r.startAt < cutoff && r.endAt <= cutoff),
      workIntervals: raw.workIntervals.filter((r) => {
        const m = workById.get(r.id); return r.startAt < cutoff && r.endAt <= cutoff && m && m.createdAt < cutoff && m.updatedAt < cutoff;
      }),
      heartRateSamples: (raw.heartRateSamples ?? []).filter((r) => {
        const m = heartMetaByKey.get(heartKey(r));
        return r.timestamp < cutoff && m && m.createdAt < cutoff && m.updatedAt < cutoff;
      }),
      workouts: (raw.workouts ?? []).filter((r) => {
        const m = workoutById.get(r.id); return r.startAt < cutoff && r.endAt <= cutoff && m && m.createdAt < cutoff && m.updatedAt < cutoff;
      }).map((r) => {
        const session = sessionByWorkout.get(r.id);
        const sessionKnown = session != null && session.createdAt < cutoff && session.updatedAt < cutoff;
        const sourceAlias = aliasMeta.find((a) => a.sourceType === "workout" && a.workoutId === r.id);
        const canonicalEvent = sourceAlias && sourceAlias.createdAt < cutoff ? eventById.get(sourceAlias.eventId) : null;
        const revision = canonicalEvent && canonicalEvent.createdAt < cutoff
          ? resolutionMeta.filter((x) => x.eventId === canonicalEvent.id && x.createdAt < cutoff).sort((a, b) => b.revision - a.revision)[0]
          : null;
        const currentAsOf = revision ? { currentKcal: revision.valueKcal, currentSource: revision.source, resolutionRevision: revision.revision, isStale: false }
          : canonicalEvent && canonicalEvent.updatedAt < cutoff && canonicalRevisionRows === 0
            ? { currentKcal: canonicalEvent.currentKcal, currentSource: canonicalEvent.currentSource, resolutionRevision: canonicalEvent.resolutionRevision, isStale: canonicalEvent.isStale }
            : null;
        return { ...r, canonicalEnergyResolution: currentAsOf,
          // The shadow's freshness also depends on persisted model-day context;
          // that context has no immutable as-of revision in this snapshot.
          bodyCastEstimateKcal: null,
          bodyCastEstimateFresh: false,
          strengthSessionCompleted: sessionKnown && r.strengthSessionCompleted === true,
        };
      }),
      webOnlyStrengthSessions: (raw.webOnlyStrengthSessions ?? []).filter((r) => {
        const session = sessionById.get(r.sessionId); return session && session.createdAt < cutoff && session.updatedAt < cutoff;
      }).map((r) => {
        const alias = aliasMeta.find((a) => a.sourceType === "strength-session" && a.sourceId === String(r.sessionId));
        const event = alias && alias.createdAt < cutoff ? eventById.get(alias.eventId) : null;
        const revision = event && event.createdAt < cutoff ? resolutionMeta.filter((x) => x.eventId === event.id && x.createdAt < cutoff).sort((a, b) => b.revision - a.revision)[0] : null;
        return { ...r, bodyCastEstimateKcal: null, bodyCastEstimateFresh: false,
          canonicalEnergyResolution: revision ? { currentKcal: revision.valueKcal, currentSource: revision.source, resolutionRevision: revision.revision, isStale: false } : null };
      }),
      reconciliationLinks: raw.reconciliationLinks ?? [],
    };
    const sourceHashBefore = sha(source);
    const inputHash = sha({ days: source.days, snapshots: source.snapshots, activityIntervals: source.activityIntervals,
      workIntervals: source.workIntervals, workouts: source.workouts, webOnlyStrengthSessions: source.webOnlyStrengthSessions,
      heartRateSamples: source.heartRateSamples, reconciliationLinks: source.reconciliationLinks });
    const built = buildSimulationDays({ from: episode.startDate, to: originDate, sources: source,
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays }, modelVersion: episode.modelVersion, timeZone: episode.timezone });
    const modelObs = built.flatMap((d) => d.input.measuredWeightKg == null ? [] : [d.input.measuredWeightKg]);
    const resolvedPrefix = analyzeStateContinuity(built, episode.ecfPolicy).resolvedDays;
    const effectiveOriginDate = resolvedPrefix.at(-1)?.input.date ?? null;
    if (effectiveOriginDate === null) {
      coverageByOrigin.push({ origin: originDate, status: "no-resolved-model-prefix",
        knownDays: modelObs.length, donorCount: 0, calibrationStatus: "not-run", inputHash }); continue;
    }
    if (effectiveOriginDate !== originDate) {
      coverageByOrigin.push({ origin: originDate, status: `as-of-input-gap:${effectiveOriginDate}`,
        knownDays: modelObs.length, donorCount: 0, calibrationStatus: "not-run", inputHash }); continue;
    }
    // Production publishes only the deterministic prefix before the first
    // unresolved transition. Historical counterfactuals anchor at that prefix
    // instead of rejecting an otherwise usable earlier state.
    const calibration = calculateEpisodeHistory({ episode: episodeAtOrigin, days: resolvedPrefix }).calibration;
    const simulation = simulateDays({ initialState: episodeAtOrigin.initialState, parameters: episodeAtOrigin.simulatorParameters,
      days: resolvedPrefix.map((d) => d.input), options: { ecfPolicy: episode.ecfPolicy },
      personalization: calibration.parameters });
    const current = simulation.at(-1);
    if (!current || current.status !== "complete") {
      coverageByOrigin.push({ origin: originDate, status: "resolved-prefix-replay-failed",
        knownDays: modelObs.length, donorCount: 0, calibrationStatus: calibration.status, inputHash }); continue;
    }
    const energyParams = calibration.diagnostics.personalizationAccepted && calibration.diagnostics.parameterAtBound.length === 0
      ? calibration.parameters
      : { ...DEFAULT_EXPENDITURE_PERSONALIZATION, personalOffsetKcalPerDay: episodeAtOrigin.personalOffsetKcalPerDay };
    const originLatestWeight = [...resolvedPrefix].reverse().find((d) => d.input.measuredWeightKg != null)?.input.measuredWeightKg ?? null;
    if (originLatestWeight == null) { coverageByOrigin.push({ origin: originDate, status: "no-origin-weight", knownDays: modelObs.length,
      donorCount: 0, calibrationStatus: calibration.status, inputHash }); continue; }
    const donorFrom = addCalendarDays(effectiveOriginDate, -55);
    const donorBuilt = resolvedPrefix.filter((d) => withinDonorWindow(d.input.date, donorFrom, effectiveOriginDate));
    const donors: ForecastBehaviorDay[] = eligibleHistoricalDonors(episode.modelVersion, donorBuilt)
      .map(projectReliableForecastBehaviorDay).filter((x): x is ForecastBehaviorDay => x !== null);
    const fallback = episode.baselineNutritionFallback;
    const engineeringFallbackDay: ForecastBehaviorDay | null = fallback ? {
      nutrition: { caloriesKcal: fallback.caloriesKcal, proteinG: fallback.proteinG, fatG: fallback.fatG, carbsG: fallback.carbsG },
      outsideWorkWalkingDistanceKm: 0, averageWalkingSpeedKmh: 5, strengthTrainingMinutes: 0, occupation: [], workoutFeedObserved: null,
    } : null;
    if (donors.length === 0 && engineeringFallbackDay === null) {
      coverageByOrigin.push({ origin: originDate, status: "no-as-of-donors-or-fallback", knownDays: modelObs.length, donorCount: 0,
        calibrationStatus: calibration.status, inputHash }); continue;
    }
    const enoughDonors = donors.length >= config.minimumReliableDonorDays;
    const evidence = { donorDayCount: donors.length, source: enoughDonors ? "observed-history" as const : "engineering-fallback" as const,
      nutritionLogStandardDeviation: enoughDonors ? robustLogSpread(donors.map((d) => d.nutrition.caloriesKcal), config.fallbackNutritionLogStandardDeviation) : config.fallbackNutritionLogStandardDeviation,
      macroCompositionLogStandardDeviation: enoughDonors ? robustLogSpread(donors.flatMap(({ nutrition }) => [nutrition.proteinG / nutrition.caloriesKcal, nutrition.fatG / nutrition.caloriesKcal, nutrition.carbsG / nutrition.caloriesKcal]), config.fallbackMacroCompositionLogStandardDeviation) : config.fallbackMacroCompositionLogStandardDeviation,
      walkingLogStandardDeviation: enoughDonors ? robustLogSpread(donors.map((d) => d.outsideWorkWalkingDistanceKm), config.fallbackWalkingLogStandardDeviation) : config.fallbackWalkingLogStandardDeviation };
    const common = { seed: 9000 + origins.indexOf(originDate), startDate: addCalendarDays(effectiveOriginDate, 1), horizonDays: 14,
      modelVersion: episode.modelVersion, recoveryVersion: null, sourceFingerprint: sha({ inputHash, episode: episode.id, originDate, effectiveOriginDate }),
      scenarioFingerprint: sha({ scenario, originDate, effectiveOriginDate, seed: 9000 + origins.indexOf(originDate) }), initialStateQuality: "deterministic" as const,
      anchorWeightKg: originLatestWeight, parameters: episode.simulatorParameters, ecfPolicy: episode.ecfPolicy,
      scenario, reliableDonorDays: donors, engineeringFallbackDay, variabilityEvidence: evidence, config };
    const baseline = runForecastWithInternalArtifacts({ ...common, initialParticles: [{ state: current.endState, weight: 1 }],
      personalization: calibration.parameters }).result.dates;
    if (deterministicReplayVerified === null) {
      const repeat = runForecastWithInternalArtifacts({ ...common, initialParticles: [{ state: current.endState, weight: 1 }],
        personalization: calibration.parameters }).result.dates;
      deterministicReplayVerified = sha(baseline) === sha(repeat);
    }
    const energySimulation = simulateDays({ initialState: episodeAtOrigin.initialState, parameters: episodeAtOrigin.simulatorParameters,
      days: resolvedPrefix.map((d) => d.input), options: { ecfPolicy: episode.ecfPolicy }, personalization: energyParams });
    const energyState = energySimulation.at(-1);
    const energy = energyState?.status === "complete"
      ? runForecastWithInternalArtifacts({ ...common, initialParticles: [{ state: energyState.endState, weight: 1 }], personalization: energyParams }).result.dates
      : baseline;
    const recentWindowStartDate = addCalendarDays(effectiveOriginDate, -27);
    const recentWindowStartIndex = Math.max(0, resolvedPrefix.findIndex((day) => day.input.date >= recentWindowStartDate));
    const recentWindowDays = resolvedPrefix.slice(recentWindowStartIndex).map((day) => day.input);
    const priorWindowState = recentWindowStartIndex === 0 ? null : simulation[recentWindowStartIndex - 1];
    const recentWindowCanReplay = recentWindowStartIndex === 0 || priorWindowState?.status === "complete";
    const recentInitialState = recentWindowStartIndex === 0 ? episodeAtOrigin.initialState
      : priorWindowState?.status === "complete" ? priorWindowState.endState : episodeAtOrigin.initialState;
    const basePersonalOffset = calibration.parameters.personalOffsetKcalPerDay;
    const finiteDifferenceKcalPerDay = 100;
    const plusWindow = recentWindowCanReplay ? simulateDays({ initialState: recentInitialState, parameters: episode.simulatorParameters,
      days: recentWindowDays, options: { ecfPolicy: episode.ecfPolicy },
      personalization: { ...calibration.parameters, personalOffsetKcalPerDay: basePersonalOffset + finiteDifferenceKcalPerDay } }) : [];
    const minusWindow = recentWindowCanReplay ? simulateDays({ initialState: recentInitialState, parameters: episode.simulatorParameters,
      days: recentWindowDays, options: { ecfPolicy: episode.ecfPolicy },
      personalization: { ...calibration.parameters, personalOffsetKcalPerDay: basePersonalOffset - finiteDifferenceKcalPerDay } }) : [];
    const energyDriftObservations = recentWindowDays.flatMap((day, index) => {
      const dayIndex = recentWindowStartIndex + index;
      const measuredWeightKg = day.measuredWeightKg;
      const baselineDay = simulation[dayIndex];
      const plusDay = plusWindow[index];
      const minusDay = minusWindow[index];
      if (measuredWeightKg == null || baselineDay?.status !== "complete"
          || plusDay?.status !== "complete" || minusDay?.status !== "complete") return [];
      return [{ date: day.date, residualKg: measuredWeightKg - reconstructBodyWeightKg(baselineDay.endState),
        massSensitivityKgPerKcalPerDay: (reconstructBodyWeightKg(plusDay.endState)
          - reconstructBodyWeightKg(minusDay.endState)) / (2 * finiteDifferenceKcalPerDay) }];
    });
    const energyDriftDiagnostics = estimateEnergyDriftCorrection(energyDriftObservations);
    const energyDriftParameters = { ...calibration.parameters,
      personalOffsetKcalPerDay: clampResearchOffset(basePersonalOffset + energyDriftDiagnostics.offsetCorrectionKcalPerDay) };
    const energyDrift = energyDriftDiagnostics.status === "estimated" && energyDriftDiagnostics.offsetCorrectionKcalPerDay !== 0
      ? runForecastWithInternalArtifacts({ ...common, initialParticles: [{ state: current.endState, weight: 1 }],
        personalization: energyDriftParameters }).result.dates
      : baseline;
    const weightsFirst7 = asOfWeightObservations.filter((row) => row.date >= episode.startDate
      && row.date <= addCalendarDays(episode.startDate, 6)).map((row) => row.weightKg);
    const initRequestedDeltaKg = weightsFirst7.length >= 5 ? medianOf(weightsFirst7) - reconstructBodyWeightKg(episode.initialState) : null;
    let initAppliedDeltaKg: number | null = null;
    const residualRows = residualsAvailableAt(errorsAvailableLater, originDate, new Date(cutoff.getTime() - 1));
    const onlineCorrectionKg = residualRows.length ? boundedOnlineCorrection(residualRows) : null;
    const residualPersistence = estimateResidualPersistence(residualRows);
    const residualPersistenceDiagnostics = residualPersistence ? {
      observationCount: residualPersistence.observationCount,
      persistencePerDay: residualPersistence.persistencePerDay,
      stationaryResidualKg: residualPersistence.stationaryResidualKg,
      innovationMadKg: residualPersistence.innovationMadKg,
    } : { observationCount: residualRows.length, persistencePerDay: null,
      stationaryResidualKg: null, innovationMadKg: null };
    let init = baseline;
    if (initRequestedDeltaKg !== null) {
      const adjusted = waterOnlyInitializationCorrection(episode.initialState, initRequestedDeltaKg);
      initAppliedDeltaKg = adjusted.appliedKg;
      const initSeed: PhysiologicalSimulatorState = adjusted.state;
      const initHistory = simulateDays({ initialState: initSeed, parameters: episode.simulatorParameters,
        days: resolvedPrefix.map((d) => d.input), options: { ecfPolicy: episode.ecfPolicy },
        personalization: calibration.parameters });
      const initEnd = initHistory.at(-1);
      if (initEnd?.status === "complete") init = runForecastWithInternalArtifacts({ ...common,
        initialParticles: [{ state: initEnd.endState, weight: 1 }],
        personalization: calibration.parameters }).result.dates;
    }
    let filter = baseline;
    if (onlineCorrectionKg !== null) {
      const adjustedState: PhysiologicalSimulatorState = filterOnlyStateCorrection(current.endState, onlineCorrectionKg);
      filter = runForecastWithInternalArtifacts({ ...common, initialParticles: [{ state: adjustedState, weight: 1 }],
        personalization: calibration.parameters }).result.dates;
    }
    if (baseline.length !== 14 || init.length !== 14 || filter.length !== 14 || energy.length !== 14) throw new Error("forecast horizon mismatch");
    if (sha(source) !== sourceHashBefore) throw new Error("AS_OF_SOURCE_MUTATED");
    forecastByOrigin.set(originDate, { baseline, init, filter, energy, energyDrift, energyDriftDiagnostics, residualPersistenceDiagnostics,
      source: inputHash, donorCount: donors.length, effectiveOriginDate,
      originLatestWeightKg: originLatestWeight,
      calibration: { status: calibration.status, accepted: calibration.diagnostics.personalizationAccepted,
        parameters: calibration.parameters,
        attemptedOffsetKcalPerDay: calibration.diagnostics.attemptedOffsetPersonalOffsetKcalPerDay,
        attemptedOffsetValidationNis: calibration.diagnostics.attemptedOffsetValidationNis,
        atBound: calibration.diagnostics.parameterAtBound, identifiability: calibration.diagnostics.twoParameterIdentifiability },
      initRequestedDeltaKg, initAppliedDeltaKg, onlineCorrectionKg });
    coverageByOrigin.push({ origin: originDate, status: "forecasted", knownDays: modelObs.length, donorCount: donors.length,
      calibrationStatus: calibration.status, inputHash });
    const targetDate = addCalendarDays(effectiveOriginDate, 1);
    const label = outcomeLabelsByDate.get(targetDate);
    const newResidual = newOutcomeResidualIfEligible(label, baseline[0].physiologicalBodyWeightKg.median, cutoff);
    if (newResidual) errorsAvailableLater.push({ ...newResidual, availableAt: ISO(newResidual.availableAt) });
  }

  const candidates = ["last-weight", "causal-physiology-baseline", "A-initial-7d-median-water-only", "B-bounded-filter-state-only", "C-two-timescale-residual", "D-bounded-persistent-bias", "E-offset-calibration-accepted-only"] as const;
  const scores: Record<string, Record<string, ReturnType<typeof metrics> | ReturnType<typeof errorMetrics>>> = {};
  for (const candidate of candidates) {
    scores[candidate] = {};
    for (const h of horizons) {
      const rows: Array<{ prediction: number; observed: number; p05: number; p95: number }> = [];
      for (const [originDate, forecast] of forecastByOrigin) {
        const targetDate = addCalendarDays(originDate, h);
        const label = outcomeLabelsByDate.get(targetDate);
        const issueCutoff = nextLocalMidnight(originDate, episode.timezone);
        if (!label || !outcomeArrivedAfterCutoff(label.firstReceivedAt, issueCutoff)) continue;
        const observed = label.weightKg;
        const f = candidate === "E-offset-calibration-accepted-only" ? forecast.energy
          : candidate === "A-initial-7d-median-water-only" ? forecast.init
            : candidate === "B-bounded-filter-state-only" ? forecast.filter : forecast.baseline;
        const dateRow = f[h - 1];
        let delta = 0;
        const availableErrors = residualsAvailableAt(errorsAvailableLater.filter((r) => r.date <= originDate), originDate,
          new Date(nextLocalMidnight(originDate, episode.timezone).getTime() - 1));
        if (candidate === "C-two-timescale-residual" && availableErrors.length >= 7) {
          const state = estimateTwoTimescaleResidual(availableErrors);
          delta = state.predictResidualKg(h);
        } else if (candidate === "D-bounded-persistent-bias" && availableErrors.length >= 7) {
          delta = estimatePersistentBias(availableErrors);
        }
        // A moves only initial mass into the water bucket; B only changes the
        // filter's display estimate. Neither reaches tissue or forecast mass.
        rows.push({ prediction: dateRow.physiologicalBodyWeightKg.median + delta, observed,
          p05: dateRow.physiologicalBodyWeightKg.p05 + delta, p95: dateRow.physiologicalBodyWeightKg.p95 + delta });
      }
      scores[candidate][String(h)] = metrics(rows);
    }
  }
  scores["robust-trend-theil-sen-14d"] = {};
  for (const h of horizons) {
    const lastWeightRows: Array<{ prediction: number; observed: number; p05: number; p95: number }> = [];
    const trendRows: Array<{ prediction: number; observed: number; p05: number; p95: number }> = [];
    for (const [originDate, baseline] of weightBaselinesByOrigin) {
      const targetDate = addCalendarDays(originDate, h);
      const label = outcomeLabelsByDate.get(targetDate);
      if (!label || !outcomeArrivedAfterCutoff(label.firstReceivedAt, nextLocalMidnight(originDate, episode.timezone))) continue;
      const observed = label.weightKg;
      if (baseline.lastKnownWeightKg !== null) lastWeightRows.push({ prediction: baseline.lastKnownWeightKg, observed,
        p05: baseline.lastKnownWeightKg, p95: baseline.lastKnownWeightKg });
      const trend = baseline.robustTrend[String(h)];
      if (trend) trendRows.push({ prediction: trend.estimateKg, observed,
        p05: trend.estimateKg, p95: trend.estimateKg });
    }
    scores["last-weight"][String(h)] = errorMetrics(lastWeightRows);
    scores["robust-trend-theil-sen-14d"][String(h)] = errorMetrics(trendRows);
  }
  scores["causal-local-level-weight-filter"] = {};
  for (const h of horizons) {
    const rows: Array<{ prediction: number; observed: number }> = [];
    for (const [originDate, baseline] of weightBaselinesByOrigin) {
      const targetDate = addCalendarDays(originDate, h);
      const label = outcomeLabelsByDate.get(targetDate);
      if (baseline.causalFilterWeightKg === null || !label
          || !outcomeArrivedAfterCutoff(label.firstReceivedAt, nextLocalMidnight(originDate, episode.timezone))) continue;
      rows.push({ prediction: baseline.causalFilterWeightKg, observed: label.weightKg });
    }
    scores["causal-local-level-weight-filter"][String(h)] = errorMetrics(rows);
  }
  // Score each challenger on its exact intersection with the unchanged
  // physiology forecast: same issue cutoff, target date, and newly received label.
  const pairedForecastMetrics = Object.fromEntries(horizons.map((horizon) => {
    type PairedRow = { originDate: string; prediction: number; observed: number; p05?: number; p95?: number; fallback: boolean };
    const rowsByCandidate: Record<string, PairedRow[]> = Object.fromEntries([
      "activeForecast", "lastKnownWeight", "fixedLocalLevelKalman", "adaptiveLocalLevelKalman",
      "fixedKalmanAnchor", "adaptiveKalmanAnchor",
      "robustTrendTheilSen", "initialLevelWaterSensitivity", "filterOnlyNegativeControl",
      "twoTimescaleResidual", "robustOnlineBias", "residualPersistenceAR1", "energyDriftCalibration",
      "prequentialConformalInterval", "acceptedEnergyCalibration", "uncertaintyFallback", "halfForecastDrift",
    ].map((key) => [key, []]));
    const fallbackAssessments: Array<{ originDate: string; sampleCount: number; intervalCoverage: number | null; fallbackToLastKnown: boolean }> = [];
    const conformalDiagnostics: Array<{ originDate: string; sampleCount: number; empiricalPriorCoverage: number | null; widenByKg: number | null }> = [];
    const intervalOutcomesFor = (originDate: string, cutoff: Date): ForecastIntervalOutcome[] => {
      const labelsAsOf = new Map(weightOutcomeLabelsAsOf(allSnapshots.map((row) => ({
        id: row.id, date: row.date, weightKg: row.weightKg == null ? null : Number(row.weightKg), receivedAt: row.receivedAt,
      })), cutoff).map((row) => [row.date, row] as const));
      const history: ForecastIntervalOutcome[] = [];
      for (const [pastOrigin, pastForecast] of forecastByOrigin) {
        if (pastOrigin >= originDate) continue;
        const issueCutoff = nextLocalMidnight(pastOrigin, episode.timezone);
        const targetDate = addCalendarDays(pastOrigin, horizon);
        const label = labelsAsOf.get(targetDate);
        if (!label || !outcomeArrivedAfterCutoff(label.firstReceivedAt, issueCutoff)) continue;
        const interval = pastForecast.baseline[horizon - 1]!;
        history.push({ originDate: pastOrigin, targetDate, horizonDays: horizon,
          issueCutoff, firstReceivedAt: label.firstReceivedAt, receivedAt: label.receivedAt,
          observedKg: label.weightKg, p05Kg: interval.physiologicalBodyWeightKg.p05,
          p95Kg: interval.physiologicalBodyWeightKg.p95 });
      }
      return history;
    };
    for (const [originDate, forecast] of forecastByOrigin) {
      const weightBaseline = weightBaselinesByOrigin.get(originDate);
      const label = outcomeLabelsByDate.get(addCalendarDays(originDate, horizon));
      if (!weightBaseline || !label
          || !outcomeArrivedAfterCutoff(label.firstReceivedAt, nextLocalMidnight(originDate, episode.timezone))) continue;
      const observed = label.weightKg;
      const active = forecast.baseline[horizon - 1]!.physiologicalBodyWeightKg;
      rowsByCandidate.activeForecast.push({ originDate, prediction: active.median, observed,
        p05: active.p05, p95: active.p95, fallback: false });
      const availableErrors = residualsAvailableAt(errorsAvailableLater.filter((row) => row.date <= originDate), originDate,
        new Date(nextLocalMidnight(originDate, episode.timezone).getTime() - 1));
      const twoTimescaleDelta = availableErrors.length >= 7 ? estimateTwoTimescaleResidual(availableErrors).predictResidualKg(horizon) : 0;
      const robustBiasDelta = availableErrors.length >= 7 ? estimatePersistentBias(availableErrors) : 0;
      const persistence = estimateResidualPersistence(availableErrors);
      const persistenceDelta = persistence?.predictResidualKg(horizon) ?? 0;
      const base = forecast.baseline[horizon - 1]!.physiologicalBodyWeightKg;
      const addShifted = (key: string, series: ForecastDateSummary[], delta: number) => {
        const point = series[horizon - 1]!.physiologicalBodyWeightKg;
        rowsByCandidate[key]!.push({ originDate, prediction: point.median + delta, observed,
          p05: point.p05 + delta, p95: point.p95 + delta, fallback: false });
      };
      addShifted("initialLevelWaterSensitivity", forecast.init, 0);
      addShifted("filterOnlyNegativeControl", forecast.filter, 0);
      addShifted("twoTimescaleResidual", forecast.baseline, twoTimescaleDelta);
      addShifted("robustOnlineBias", forecast.baseline, robustBiasDelta);
      addShifted("residualPersistenceAR1", forecast.baseline, persistenceDelta);
      addShifted("acceptedEnergyCalibration", forecast.energy, 0);
      addShifted("energyDriftCalibration", forecast.energyDrift, 0);
      if (weightBaseline.lastKnownWeightKg !== null && weightBaseline.causalFilterWeightKg !== null) {
        addShifted("fixedKalmanAnchor", forecast.baseline,
          weightBaseline.causalFilterWeightKg - weightBaseline.lastKnownWeightKg);
      }
      if (weightBaseline.lastKnownWeightKg !== null && weightBaseline.adaptiveFilterWeightKg !== null) {
        addShifted("adaptiveKalmanAnchor", forecast.baseline,
          weightBaseline.adaptiveFilterWeightKg - weightBaseline.lastKnownWeightKg);
      }
      if (weightBaseline.causalFilterWeightKg !== null) {
        rowsByCandidate.fixedLocalLevelKalman!.push({ originDate, prediction: weightBaseline.causalFilterWeightKg, observed, fallback: false });
      }
      if (weightBaseline.adaptiveFilterWeightKg !== null) {
        rowsByCandidate.adaptiveLocalLevelKalman!.push({ originDate, prediction: weightBaseline.adaptiveFilterWeightKg, observed, fallback: false });
      }
      if (weightBaseline.lastKnownWeightKg !== null) {
        rowsByCandidate.lastKnownWeight!.push({ originDate, prediction: weightBaseline.lastKnownWeightKg, observed, fallback: false });
        // Research hypothesis: regularize the simulated change toward persistence.
        // The weight anchor and physiology are both known at issue time.
        const prediction = halfForecastDrift(weightBaseline.lastKnownWeightKg, active.median)!;
        const shift = prediction - active.median;
        rowsByCandidate.halfForecastDrift!.push({ originDate, prediction, observed,
          p05: active.p05 + shift, p95: active.p95 + shift, fallback: false });
      }
      const trend = weightBaseline.robustTrend[String(horizon)];
      if (trend !== null) {
        rowsByCandidate.robustTrendTheilSen!.push({ originDate, prediction: trend.estimateKg, observed, fallback: false });
      }
      const cutoff = nextLocalMidnight(originDate, episode.timezone);
      const priorIntervals = intervalOutcomesFor(originDate, cutoff);
      const widening = prequentialIntervalWidening(priorIntervals,
        { originDate, inputAsOf: cutoff, horizonDays: horizon });
      conformalDiagnostics.push({ originDate, ...widening });
      rowsByCandidate.prequentialConformalInterval!.push({ originDate, prediction: active.median, observed,
        p05: active.p05 - (widening.widenByKg ?? 0), p95: active.p95 + (widening.widenByKg ?? 0), fallback: false });
      const fallbackAssessment = assessUncertaintyAwareFallback(priorIntervals,
        { originDate, inputAsOf: cutoff, horizonDays: horizon });
      fallbackAssessments.push({ originDate, ...fallbackAssessment });
      if (weightBaseline.lastKnownWeightKg !== null) {
        const fallbackDelta = fallbackAssessment.fallbackToLastKnown
          ? weightBaseline.lastKnownWeightKg - base.median : 0;
        rowsByCandidate.uncertaintyFallback!.push({ originDate, prediction: base.median + fallbackDelta, observed,
          p05: base.p05 + fallbackDelta, p95: base.p95 + fallbackDelta,
          fallback: fallbackAssessment.fallbackToLastKnown });
      }
    }
    const activeByOrigin = new Map(rowsByCandidate.activeForecast!.map((row) => [row.originDate, row] as const));
    const candidates = Object.fromEntries(Object.entries(rowsByCandidate).map(([candidate, rows]) => {
      const activeRows = rows.flatMap((row) => {
        const active = activeByOrigin.get(row.originDate);
        return active ? [{ prediction: active.prediction, observed: active.observed }] : [];
      });
      const pointRows = rows.map(({ prediction, observed }) => ({ prediction, observed }));
      const point = errorMetrics(pointRows);
      const activePoint = errorMetrics(activeRows);
      const deltaMaeUncertainty = candidate === "activeForecast" ? null
        : pairedBlockBootstrapDeltaMae(activeRows, pointRows, Math.min(horizon, rows.length), `${candidate}|${horizon}`);
      const intervalRows = rows.filter((row): row is PairedRow & { p05: number; p95: number } => row.p05 !== undefined && row.p95 !== undefined);
      const interval = intervalRows.length === 0 ? null : metrics(intervalRows.map((row) => ({
        prediction: row.prediction, observed: row.observed, p05: row.p05, p95: row.p95,
      })));
      const segmentSummary = (segmentRows: PairedRow[]) => {
        const candidatePoint = errorMetrics(segmentRows.map(({ prediction, observed }) => ({ prediction, observed })));
        const matchedActive = errorMetrics(segmentRows.flatMap((row) => {
          const active = activeByOrigin.get(row.originDate);
          return active ? [{ prediction: active.prediction, observed: active.observed }] : [];
        }));
        return { point: candidatePoint, activeForecastOnSamePairs: matchedActive,
          deltaMaeKg: matchedActive && candidatePoint ? matchedActive.maeKg - candidatePoint.maeKg : null };
      };
      const earlyRows = rows.filter((row) => row.originDate < "2026-10-10");
      const lateRows = rows.filter((row) => row.originDate >= "2026-10-10");
      const adaptiveRows = rowsByCandidate.adaptiveKalmanAnchor!;
      return [candidate, { point, activeForecastOnSamePairs: activePoint,
        deltaMaeKg: activePoint && point ? activePoint.maeKg - point.maeKg : null,
        deltaMaePercent: activePoint && point && activePoint.maeKg > 0
          ? 100 * (activePoint.maeKg - point.maeKg) / activePoint.maeKg : null,
        deltaMaeBlockBootstrap95: deltaMaeUncertainty,
        pairedOrigins: rows.map((row) => row.originDate),
        intervalCalibration: interval ? { n: interval.n, p05p95Coverage: interval.p05p95Coverage,
          meanP05P95WidthKg: interval.meanP05P95WidthKg } : null,
        fallbackCount: rows.filter((row) => row.fallback).length,
        earlyBefore2026_10_10: segmentSummary(earlyRows),
        lateFrom2026_10_10: segmentSummary(lateRows),
        adaptiveFilterDiagnostics: candidate === "adaptiveKalmanAnchor" ? {
          meanProcessNoiseVarianceKg2PerDay: adaptiveRows.length === 0 ? null
            : adaptiveRows.reduce((sum, row) => sum + (weightBaselinesByOrigin.get(row.originDate)?.adaptiveProcessNoiseVarianceKg2PerDay ?? 0), 0) / adaptiveRows.length,
          meanPosteriorVarianceKg2: adaptiveRows.length === 0 ? null
            : adaptiveRows.reduce((sum, row) => sum + (weightBaselinesByOrigin.get(row.originDate)?.adaptiveFilterVarianceKg2 ?? 0), 0) / adaptiveRows.length,
        } : null }];
    }));
    return [String(horizon), { commonOriginCount: rowsByCandidate.activeForecast!.length,
      candidates, uncertaintyFallbackDiagnostics: fallbackAssessments,
      prequentialConformalDiagnostics: conformalDiagnostics }];
  }));
  const calibrationCandidateSeries = [...forecastByOrigin.entries()].map(([origin, f]) => ({ origin, donors: f.donorCount,
    initRequestedDeltaKg: f.initRequestedDeltaKg, initAppliedDeltaKg: f.initAppliedDeltaKg,
    onlineCorrectionKg: f.onlineCorrectionKg, energyDrift: f.energyDriftDiagnostics,
    residualPersistence: f.residualPersistenceDiagnostics, calibration: f.calibration }));
  const snapshotBatchesAfter = [];
  for (let offset = 0; offset < snapshotIds.length; offset += 128) {
    snapshotBatchesAfter.push(await prisma.healthSyncSnapshot.findMany({
      where: { id: { in: snapshotIds.slice(offset, offset + 128).map(({ id }) => id) } },
    }));
  }
  const snapshotsAfter = snapshotBatchesAfter.flat().sort((left, right) => left.date.localeCompare(right.date)
    || left.receivedAt.getTime() - right.receivedAt.getTime() || left.id - right.id);
  const snapshotRowCountAfter = await prisma.healthSyncSnapshot.count({ where: snapshotWhere });
  const snapshotFingerprintAfter = healthSyncSnapshotFingerprint(snapshotsAfter);
  const healthSyncSnapshotFingerprintUnchanged = snapshotRowCountAfter === snapshotIds.length
    && snapshotsAfter.length === snapshotIds.length && snapshotFingerprintBefore === snapshotFingerprintAfter;
  if (!healthSyncSnapshotFingerprintUnchanged) throw new Error("HEALTH_SYNC_SNAPSHOT_ROWS_CHANGED_DURING_REPLAY");
  const out = {
    version: "profile1-offline-forecast-experiments-v1", databaseIdentity: identity[0], profileId: PROFILE_ID,
    pipeline: { episodeModelVersion: episode.modelVersion,
      stateReplay: "calculateEpisodeHistory + simulateDays (legacy episode-calculation path)",
      v7DailyRuntimeReplayed: false },
    episode: { startDate: episode.startDate, latestSourceDate: CUTOFF_DATE, modelVersion: episode.modelVersion,
      createdAt: ISO(episode.createdAt), updatedAt: ISO(episode.updatedAt), initializationStatus: episode.initializationStatus,
      initializationInputDayCount: episode.baselineWeightObservationCount, initialWeightKg: reconstructBodyWeightKg(episode.initialState) },
    asOf: { originFirst, originLast, originsAttempted: origins.length, forecastsCompleted: forecastByOrigin.size,
      ingestionCutoff: "end of BodyCast local origin date (exclusive next local midnight)",
      primarySnapshotRowsProjectedByReceiptTime: true,
      activeEpisodeCreatedBeforeCutoffRequired: true,
      episodeAsOfEligibleOrigins: coverageByOrigin.filter((r) => r.status !== "episode-state-updated-after-origin" && r.status !== "episode-not-created").length,
      strengthShadowEnergyExcludedWithoutAsOfModelDayVersion: true,
      reconciliationLinksRequireAsOfVersion: true,
      delayedRowsAreDroppedWhenNoImmutablePriorVersionExists: true, canonicalResolutionRevisionRowsAvailable: canonicalRevisionRows,
      predictionUsesOnlyPreOriginDonors: true,
      scoringRequiresFirstTargetWeightReceivedAtOrAfterLocalIssueCutoff: true,
      targetValueUsesLatestSnapshotWeightAtEvaluationCutoff: true,
      targetLabelsShareSourceAcrossAllCandidates: true,
      outcomeLabelSource: "latest-non-null-HealthSyncSnapshot-weight-per-local-date",
      outcomeLabelCutoff: ISO(outcomeLabelCutoff),
      outcomeLabelCount: outcomeLabelsByDate.size },
    replay: { deterministic: deterministicReplayVerified, healthSyncSnapshotFingerprint: snapshotFingerprintBefore,
      healthSyncSnapshotFingerprintUnchanged },
    retrospectiveReplay,
    causalScaleAssimilation: {
      estimator: "existing local-level Kalman filter, research-only; Q=0.01 kg2/day and R=0.25 kg2",
      stateBoundary: "observed scale-weight belief only; no tissue, fluid compartment, or energy-balance state is an input or output",
      firstRollingOrigin: firstOriginCausalAssimilation,
      lastRollingOrigin: lastOriginCausalAssimilation,
      forecastMetricsKey: "causal-local-level-weight-filter",
    },
    metrics: scores, pairedForecastMetrics, calibrationCandidateSeries, originCoverage: coverageByOrigin,
    weightOnlyBaselineCoverage: Object.fromEntries(horizons.map((horizon) => {
      const eligibleOrigins = [...weightBaselinesByOrigin.entries()].filter(([origin, baseline]) => {
        const label = outcomeLabelsByDate.get(addCalendarDays(origin, horizon));
        return label !== undefined && outcomeArrivedAfterCutoff(label.firstReceivedAt, nextLocalMidnight(origin, episode.timezone))
          && baseline.lastKnownWeightKg !== null;
      });
      const trendOrigins = eligibleOrigins.filter(([origin, baseline]) => {
        const label = outcomeLabelsByDate.get(addCalendarDays(origin, horizon));
        return label !== undefined && outcomeArrivedAfterCutoff(label.firstReceivedAt, nextLocalMidnight(origin, episode.timezone))
          && baseline.robustTrend[String(horizon)] !== null;
      });
      return [String(horizon), { lastKnown: eligibleOrigins.length, robustTrend: trendOrigins.length,
        causalLocalLevelFilter: trendOrigins.filter(([, baseline]) => baseline.causalFilterWeightKg !== null).length }];
    })),
    notes: [
      "These are conditional counterfactual rolling-origin reconstructions, not as-issued forecasts; historical forecast snapshots were not persisted.",
      "activeForecast is the reconstructed counterfactual comparator, not a stored as-issued forecast; current-day anchor and source revision histories may differ.",
      "Inputs after the configured local cutoff are excluded. Episode-calculation physiology forecasts are scored only when the full deterministic source prefix through that issue date is available; this runner does not replay the V7 daily runtime.",
      "Weight-only last-known and Theil-Sen 14-day baselines are evaluated independently at the same local-date cutoff. They use only scale observations received before the cutoff and score only labels first received after it.",
      "HealthSyncSnapshot records are sparse updates. The as-of projection merges field-present values by receipt time, follows the sync writer's omitted-versus-explicit-null semantics, and reconstructs daily walking totals from timestamped raw snapshots. Origins with unreconstructable source gaps fail closed.",
      "BodyCast strength shadow energy is excluded because this snapshot has no as-of model-day revision history for verifying estimate freshness. Reconciliation links are preserved and origins fail closed if links are present without as-of versions.",
      "Each workout is projected from the latest ActiveEnergyResolutionRevision received before the origin cutoff. Current aliases without an as-of revision are not substituted.",
      "Every rolling-origin method uses the same latest non-null immutable HealthSyncSnapshot weight per target date, as available by the evaluation cutoff. An outcome is eligible only when its first non-null observation arrived after issue time; residual adaptation waits until the selected (possibly corrected) label version arrived. Mutable DailyHealthData weights are used only for retrospective state-fit diagnostics.",
      "A is a bounded initial-water reallocation sensitivity scenario; it changes the physiology forecast and does not identify a valid compartment assignment. B changes only the legacy filter state and is a negative control: the full physiology forecast should remain identical to baseline.",
      "B/C/D residual challengers process dated observations using elapsed calendar days. Their prediction intervals are shifted without widening, so interval coverage is a diagnostic, not calibrated predictive uncertainty.",
      "causal-local-level-weight-filter is an observation-only Kalman state replay over weight snapshots available by each origin; it does not update tissue, water compartments, or energy balance. Its flat-origin predictions are a weight-only candidate, not a full physiological forecast.",
      "Retrospective full-history residuals are state-replay diagnostics, not future-forecast accuracy. A previous validation window is not treated as an independent blind holdout.",
    ],
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2), { encoding: "utf8", flag: "w" });
  console.log(JSON.stringify({ output: OUTPUT, databaseIdentity: identity[0], episode: out.episode,
    asOf: out.asOf, retrospectiveReplay: out.retrospectiveReplay, scores: out.metrics,
    healthSyncSnapshotFingerprintUnchanged: out.replay.healthSyncSnapshotFingerprintUnchanged,
    failedOriginsByStatus: Object.fromEntries([...new Set(coverageByOrigin.map((r) => r.status))]
      .map((status) => [status, coverageByOrigin.filter((r) => r.status === status).length])) }, null, 2));
  await prisma.$disconnect();
}

function medianOf(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

main().catch(async (error) => {
  console.error(`Offline experiment failed: ${error instanceof Error ? error.name + ":" + error.message : "unknown"}`);
  await prisma.$disconnect();
  process.exitCode = 1;
});
