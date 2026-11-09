import { PrismaClient } from "@prisma/client";
import { PhysiologyV7RuntimeRepository } from "@/modules/model-episodes/physiology-v7-runtime.repository";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { localDateTimeToInstant } from "@/model/time-zone";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { createUnavailablePhysiologyRuntimeStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import { rebuildPhysiologyRangeV7WithProgress } from "@/model/physiology-v7/rebuild-v7";
import { assimilateV7ScaleStateAsOf } from "./v7-causal-assimilation";

const local = { host: "127.0.0.1", port: 55449, database: "bodycast_forensic_test", user: "bodycast_forensic" };
const profileId = Number(process.env.BODYCAST_RESEARCH_PROFILE_ID);
const cutoffDate = process.env.BODYCAST_RESEARCH_CUTOFF_DATE ?? "";
if (profileId !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
  throw new Error("Set BODYCAST_RESEARCH_PROFILE_ID=1 and a valid BODYCAST_RESEARCH_CUTOFF_DATE for the isolated dataset");
}
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (databaseUrl.hostname !== local.host || databaseUrl.port !== String(local.port)
    || databaseUrl.pathname !== `/${local.database}`) {
  throw new Error("Refusing any database except isolated forensic PostgreSQL");
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  const identity = await prisma.$queryRaw<Array<{ database: string; user: string; port: number }>>`
    SELECT current_database() AS database, current_user AS user, inet_server_port() AS port`;
  if (identity[0]?.database !== local.database || identity[0]?.user !== local.user
      || Number(identity[0]?.port) !== local.port) {
    throw new Error("Isolated database identity guard failed");
  }

  const persisted = await prisma.physiologyV7DailyResult.findMany({
    where: { profileId, date: { lte: cutoffDate } },
    orderBy: { date: "asc" },
    select: { date: true, sourceFingerprint: true, resultFingerprint: true, result: true },
  });
  const lifecycle = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } });
  const episode = await prisma.modelEpisode.findFirst({
    where: { profileId, active: true },
    select: { startDate: true, timezone: true },
  });
  if (!episode || persisted.length === 0) throw new Error("Missing active episode or persisted V7 rows");

  const fromDate = episode.startDate;
  const toDate = persisted.at(-1)!.date;
  const episodeRows = persisted.filter((row) => row.date >= fromDate);
  const repository = new PhysiologyV7RuntimeRepository(prisma);
  const sources = await repository.loadRangeSources({
    profileId,
    fromDate,
    toDate,
    historyFromDate: fromDate,
    timeZone: episode.timezone,
  });
  const rebuilt = await rebuildPhysiologyRangeV7WithProgress({
    fromDate,
    toDate,
    initialState: createUnavailablePhysiologyRuntimeStateV7(),
    sources,
  });
  const weightRows = await prisma.healthSyncSnapshot.findMany({
    where: { profileId, date: { gte: fromDate, lte: toDate } },
    orderBy: [{ date: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
    select: { id: true, date: true, weightKg: true, receivedAt: true },
  });
  const weightSnapshots = weightRows.map((row) => ({
    id: row.id,
    date: row.date,
    weightKg: row.weightKg === null ? null : Number(row.weightKg),
    receivedAt: row.receivedAt,
  }));
  const causalAssimilation = rebuilt.days.map((day) => {
    const inputAsOf = localDateTimeToInstant(addCalendarDays(day.date, 1), "00:00", episode.timezone);
    const candidate = assimilateV7ScaleStateAsOf(day.resultingState, weightSnapshots, {
      fromDate,
      originDate: day.date,
      inputAsOf,
    });
    const independentlyPrefiltered = weightSnapshots.filter((row) => (
      row.date >= fromDate
      && row.date <= day.date
      && row.receivedAt.getTime() < inputAsOf.getTime()
    ));
    const receiptTimeExcludedRows = weightSnapshots.filter((row) => (
      row.weightKg !== null
      && row.date >= fromDate
      && row.date <= day.date
      && row.receivedAt.getTime() >= inputAsOf.getTime()
    )).length;
    const asOfOnly = assimilateV7ScaleStateAsOf(day.resultingState,
      independentlyPrefiltered, {
        fromDate,
        originDate: day.date,
        inputAsOf,
      });
    if (stableSha256(candidate.resultingState.compartments)
        !== stableSha256(day.resultingState.compartments)) {
      throw new Error(`CAUSAL_ASSIMILATION_CHANGED_COMPARTMENT:${day.date}`);
    }
    if (stableSha256(candidate) !== stableSha256(asOfOnly)) {
      throw new Error(`CAUSAL_ASSIMILATION_RECEIPT_CUTOFF_MISMATCH:${day.date}`);
    }
    return {
      date: day.date,
      candidate,
      baselineWeightFilterState: day.resultingState.weightFilterState,
      receiptTimeExcludedRows,
    };
  });
  const runtimeFilterComparison = causalAssimilation.map(({ date, candidate, baselineWeightFilterState }) => {
    const actual = candidate.resultingState.weightFilterState;
    if (actual === null || baselineWeightFilterState === null) {
      return { date, same: actual === baselineWeightFilterState, levelDiffers: actual !== baselineWeightFilterState,
        varianceDiffers: actual !== baselineWeightFilterState };
    }
    return {
      date,
      same: Math.abs(actual.estimatedWeightKg - baselineWeightFilterState.estimatedWeightKg) <= 1e-10
        && Math.abs(actual.varianceKg2 - baselineWeightFilterState.varianceKg2) <= 1e-10,
      levelDiffers: Math.abs(actual.estimatedWeightKg - baselineWeightFilterState.estimatedWeightKg) > 1e-10,
      varianceDiffers: Math.abs(actual.varianceKg2 - baselineWeightFilterState.varianceKg2) > 1e-10,
    };
  });
  const withoutScaleObservations = await rebuildPhysiologyRangeV7WithProgress({
    fromDate,
    toDate,
    initialState: createUnavailablePhysiologyRuntimeStateV7(),
    sources: {
      ...sources,
      days: sources.days.map((day) => ({
        ...day,
        observedWeightKg: null,
        weightFilterObservation: null,
        weightFilterAsOf: null,
      })),
    },
  });
  const tissueChangedDates = rebuilt.days.flatMap((day, index) => (
    JSON.stringify(day.resultingState.compartments)
      === JSON.stringify(withoutScaleObservations.days[index]?.resultingState.compartments)
      ? [] : [day.date]
  ));
  const savedByDate = new Map(episodeRows.map((row) => [row.date, row] as const));
  const sameResultPayloads = rebuilt.days.filter((day) => (
    stableSha256(savedByDate.get(day.date)?.result ?? null) === stableSha256(day)
  )).length;
  const samePersistedCompartments = rebuilt.days.filter((day) => (
    stableSha256((savedByDate.get(day.date)?.result as { resultingState?: { compartments?: unknown } } | undefined)
      ?.resultingState?.compartments ?? null) === stableSha256(day.resultingState.compartments)
  )).length;
  const sameSourceFingerprints = rebuilt.days.filter((day) => (
    savedByDate.get(day.date)?.sourceFingerprint === day.inputSourceFingerprint
  )).length;
  const countBy = (values: readonly string[]) => Object.fromEntries(
    [...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]),
  );
  const blockers = rebuilt.days.flatMap((day) => day.blockers);
  const compartmentAvailability = rebuilt.days.flatMap((day) => (
    Object.values(day.resultingState.compartments).map((compartment) => compartment.availability)
  ));
  const observedWeightDays = rebuilt.days.filter((day) => day.observations.weightFilterObservation !== null);
  const weightObservationDays = observedWeightDays.length;
  const weightFilterStateDays = rebuilt.days.filter((day) => day.resultingState.weightFilterState !== null).length;
  const finalCandidateFilterState = causalAssimilation.at(-1)?.candidate.resultingState.weightFilterState ?? null;
  const finalRuntimeFilterState = rebuilt.days.at(-1)?.resultingState.weightFilterState ?? null;
  const seventhDate = addCalendarDays(fromDate, 6);

  console.log(JSON.stringify({
    profileId,
    cutoffDate,
    database: identity[0],
    range: { fromDate, toDate, persistedRows: episodeRows.length, allProfileRows: persisted.length, rebuiltRows: rebuilt.days.length },
    persistedReplay: {
      sameResultPayloads,
      samePersistedCompartments,
      sameSourceFingerprints,
      differingResultDates: rebuilt.days
        .filter((day) => stableSha256(savedByDate.get(day.date)?.result ?? null) !== stableSha256(day))
        .slice(0, 10).map((day) => day.date),
      differingSourceDates: rebuilt.days
        .filter((day) => savedByDate.get(day.date)?.sourceFingerprint !== day.inputSourceFingerprint)
        .slice(0, 10).map((day) => day.date),
    },
    currentness: lifecycle === null ? null : {
      invalidationGeneration: lifecycle.invalidationGeneration,
      productionPublishedGeneration: lifecycle.productionPublishedGeneration,
      unifiedPublishedGeneration: lifecycle.unifiedPublishedGeneration,
      currentThroughDate: lifecycle.currentThroughDate,
      staleFromDate: lifecycle.staleFromDate,
      unifiedPublishedRolloutEpoch: lifecycle.unifiedPublishedRolloutEpoch,
      unifiedRolloutEpoch: lifecycle.unifiedRolloutEpoch,
      unifiedPublicationBlockedFromDate: lifecycle.unifiedPublicationBlockedFromDate,
    },
    physiologyAvailability: {
      compartmentValues: countBy(compartmentAvailability),
      massReconstruction: countBy(rebuilt.days.map((day) => day.massReconstruction.availability)),
      blockers: countBy(blockers),
    },
    observationAssimilation: { weightObservationDays, weightFilterStateDays },
    causalScaleAssimilationCandidate: {
      status: "isolated-runtime-replay-not-deployed",
      algorithm: "V7 local-level Kalman filter replayed from latest immutable weight snapshots available by each local-day cutoff",
      originsEvaluated: causalAssimilation.length,
      originsMatchingCurrentV7RuntimeFilter: runtimeFilterComparison.filter((row) => row.same).length,
      originsDifferingFromCurrentV7RuntimeFilter: runtimeFilterComparison.filter((row) => !row.same).length,
      differingOrigins: runtimeFilterComparison.filter((row) => !row.same).slice(0, 10).map((row) => row.date),
      differingOriginStateParts: {
        weightLevel: runtimeFilterComparison.filter((row) => row.levelDiffers).length,
        uncertainty: runtimeFilterComparison.filter((row) => row.varianceDiffers).length,
      },
      originDatesWithLateWeightRowsExcluded: causalAssimilation.filter(({ receiptTimeExcludedRows }) => (
        receiptTimeExcludedRows > 0
      )).length,
      measuredRowsExcludedByReceiptCutoffAcrossOrigins: causalAssimilation.reduce((sum, row) => (
        sum + row.receiptTimeExcludedRows
      ), 0),
      finalObservationCount: causalAssimilation.at(-1)?.candidate.observationCount ?? 0,
      finalObservationDate: causalAssimilation.at(-1)?.candidate.lastObservationDate ?? null,
      finalWeightFilterState: finalCandidateFilterState,
      finalCurrentV7RuntimeFilterState: finalRuntimeFilterState,
      finalEstimateDifferenceKg: finalCandidateFilterState === null || finalRuntimeFilterState === null
        ? null : finalCandidateFilterState.estimatedWeightKg - finalRuntimeFilterState.estimatedWeightKg,
      finalUncertaintyDifferenceKg2: finalCandidateFilterState === null || finalRuntimeFilterState === null
        ? null : finalCandidateFilterState.varianceKg2 - finalRuntimeFilterState.varianceKg2,
      tissueAndWaterCompartmentsUnchanged: true,
      futureLeakage: "none-detected-by-full-vs-independent-date-and-receipt-time-prefiltered replay",
      note: "The runtime replays the latest version of each measurement date as of each origin cutoff. Independent receipt-time prefiler must match exactly; prior cutoffs cannot see later corrections. Candidate changes only the observation-layer filter; no serving recommendation is made.",
    },
    scaleAssimilation: {
      measurementStateDays: weightFilterStateDays,
      observationDays: weightObservationDays,
      firstObservedWeightKg: observedWeightDays[0]?.observations.weightFilterObservation?.valueKg ?? null,
      firstPosteriorWeightKg: observedWeightDays[0]
        ?.resultingState.weightFilterState?.estimatedWeightKg ?? null,
      seventhDayPosteriorWeightKg: rebuilt.days.find((day) => day.date === seventhDate)
        ?.resultingState.weightFilterState?.estimatedWeightKg ?? null,
      lastPosteriorWeightKg: rebuilt.days.at(-1)?.resultingState.weightFilterState?.estimatedWeightKg ?? null,
      tissueChangedDatesWhenScaleObservationsRemoved: tissueChangedDates,
    },
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
