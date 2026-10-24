import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { prisma } from "@/lib/db/prisma";
import { addHealthSyncAuditRetentionRowV1, createHealthSyncAuditRetentionAccumulatorV1,
  createHealthSyncAuditRetentionBaselineV1, healthSyncAuditRetentionCurrentStateV1,
} from "@/modules/health/health-sync-audit-retention-integrity";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, isValidTimeZone, localDateTimeToInstant } from "@/model/time-zone";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import { buildTransientEpisodePartitionsV2, latestCompletedSessionModelDateV2, transientModelDayBoundariesV2 } from "@/modules/model-episodes/transient-exercise-water-episode-time-v2";
import { BODYWEIGHT_RESOLUTION_METHOD_V2 } from "@/modules/training/bodyweight-reference-v2";
import { LOAD_ACCOUNTING_METHOD_V1 } from "@/modules/training/load-accounting-v1";
import { buildMassResolutionIdentity, persistedPayloadFromUnknown } from "@/modules/training/persisted-load-accounting-v1";
import { canonicalizeWorkoutType } from "@/model/activity/workout-type";

const APPLE_HEALTH_SHORTCUT_SOURCE = "apple-health-shortcut";

// Keep only durable source rows in the strict projection. The accounting
// snapshots/operations are replay outputs and are validated by their own
// freshness/provenance contracts. HealthSyncAudit is fingerprinted separately
// for retention-aware preservation.
const RECOVERY_RAW_INPUT_TABLES = [
  "Profile",
  "ModelEpisode",
  "HealthSyncAudit",
  "StepperEquipmentAssignment",
  "DailyHealthData",
  "HealthMetricSample",
  "HeartRateSample",
  "RestingHeartRateSample",
  "SleepSegment",
  "HealthSyncSnapshot",
  "HealthActivityInterval",
  "Workout",
  "ExerciseCatalog",
  "ExerciseLoadConfiguration",
  "TrainingProgram",
  "TrainingProgramVersion",
  "ProgramExercise",
  "StrengthDiarySession",
  "StrengthDiaryProgramChange",
  "StrengthSessionExercise",
  "StrengthSet",
  "WorkInterval",
  "StepperReconciliationGroup",
  "StepperReconciliationCandidate",
] as const;
// Larger deterministic pages avoid hundreds of database round trips while the
// migration-free release holds its currentness fence. The per-row digest and
// ordered-ID checks still detect missing, reordered, or changing source rows.
const RECOVERY_RAW_FINGERPRINT_PAGE_SIZE = 512;
const RECOVERY_AUDIT_FINGERPRINT_PAGE_SIZE = 32;

async function readExpectedV4ModelDayBoundariesV1(client: typeof prisma, profileId: number) {
  const episodes = await client.modelEpisode.findMany({
    where: { profileId }, orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true, timezone: true, active: true, deactivatedAt: true },
  });
  const partitions = buildTransientEpisodePartitionsV2(episodes);
  const first = partitions[0];
  const last = partitions.at(-1);
  if (!first || !last) throw new Error("V4 recovery evidence has no persisted model episode boundary");
  const [latestDurable, completedSessions] = await Promise.all([
    client.dailyHealthData.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    client.strengthDiarySession.findMany({
      where: { profileId, status: "COMPLETED" },
      select: { effectiveAccountingAt: true, webStartedAt: true, createdAt: true,
        matchedWorkout: { select: { startAt: true } } },
    }),
  ]);
  const latestSessionDate = latestCompletedSessionModelDateV2(partitions, completedSessions);
  const requestedToDate = [latestDurable?.date, latestSessionDate]
    .filter((date): date is string => date !== null && date !== undefined)
    .sort()
    .at(-1) ?? first.episode.startDate;
  const effectiveToDate = [requestedToDate, first.episode.startDate, last.episode.startDate]
    .sort()
    .at(-1)!;
  const throughInstant = localDateTimeToInstant(addCalendarDays(effectiveToDate, 1), "00:00", last.episode.timezone);
  return transientModelDayBoundariesV2({
    partitions,
    fromInstant: first.startInstant,
    throughInstant,
  });
}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export async function inventoryV4RecoveryRawSourcesV1(client: typeof prisma, options: {
  healthSyncAuditBaselineCapturedAt?: Date;
  healthSyncAuditBaselineMaxId?: number;
} = {}): Promise<{
  sourceFingerprint: string;
  healthSyncAuditFingerprint: string;
  healthSyncAuditRetentionBaseline?: ReturnType<typeof createHealthSyncAuditRetentionBaselineV1>;
  healthSyncAuditRetentionCurrentState?: { existingRowCount: number; existingRowXor: string; newRowCount: number };
}> {
  if ((options.healthSyncAuditBaselineCapturedAt !== undefined && options.healthSyncAuditBaselineMaxId !== undefined)
    || (options.healthSyncAuditBaselineCapturedAt !== undefined
      && !Number.isFinite(options.healthSyncAuditBaselineCapturedAt.getTime()))
    || (options.healthSyncAuditBaselineMaxId !== undefined
      && (!Number.isSafeInteger(options.healthSyncAuditBaselineMaxId) || options.healthSyncAuditBaselineMaxId < 0))) {
    throw new Error("HealthSyncAudit retention inventory requires exactly one valid baseline mode.");
  }
  const auditRetentionBaseline = options.healthSyncAuditBaselineCapturedAt
    ? createHealthSyncAuditRetentionAccumulatorV1() : null;
  const auditRetentionExisting = options.healthSyncAuditBaselineMaxId !== undefined
    ? createHealthSyncAuditRetentionAccumulatorV1() : null;
  let auditRetentionNewRowCount = 0;
  const digest = createHash("sha256").update("bodycast-v4-recovery-raw-sources-v4\0");
  let healthSyncAuditFingerprint: string | null = null;
  for (const table of RECOVERY_RAW_INPUT_TABLES) {
    const rawRowExpression = table === "ModelEpisode"
      ? `to_jsonb(source_row) - ARRAY['personalOffsetKcalPerDay', 'activityCalibration', 'calibrationStatus', 'calibrationDiagnostics', 'latestModeledDate', 'updatedAt']::text[]`
      : table === "StrengthDiarySession"
        ? `(to_jsonb(source_row) - ARRAY['currentSnapshotRevision', 'updatedAt', 'effectiveAccountingAt', 'accountingTimeZone', 'accountingTimeZoneProvenance']::text[])
           || jsonb_build_object(
             'effectiveAccountingAt', COALESCE(source_row."effectiveAccountingAt", matched_workout."startAt", source_row."webStartedAt", source_row."createdAt"),
             'accountingTimeZone', COALESCE(source_row."accountingTimeZone", $3::text),
             'accountingTimeZoneProvenance', COALESCE(source_row."accountingTimeZoneProvenance", 'legacy-default')
           )`
        : "to_jsonb(source_row)";
    const sourceJoins = table === "StrengthDiarySession"
      ? `LEFT JOIN public."Workout" AS matched_workout ON matched_workout."id" = source_row."matchedWorkoutId"`
      : "";
    const [countRow] = await client.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM public."${table}"`,
    );
    const rowCount = countRow?.count;
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
      throw new Error(`V4 strict source fingerprint returned invalid ${table} row count`);
    }
    const tableDigest = createHash("sha256").update(`${table}\0${rowCount}\0`);
    let lastId = -2_147_483_649;
    let seen = 0;
    while (seen < rowCount) {
      const pageSize = table === "HealthSyncAudit"
        ? RECOVERY_AUDIT_FINGERPRINT_PAGE_SIZE : RECOVERY_RAW_FINGERPRINT_PAGE_SIZE;
      const rows = await client.$queryRawUnsafe<Array<{ id: number; raw_row: string }>>(
        `SELECT source_row.id, (${rawRowExpression})::text AS raw_row
         FROM public."${table}" AS source_row
         ${sourceJoins}
         WHERE source_row.id > $1::bigint
         ORDER BY source_row.id
         LIMIT $2`,
        lastId,
        pageSize,
        ...(table === "StrengthDiarySession" ? [DEFAULT_TIME_ZONE] : []),
      );
      if (rows.length === 0) {
        throw new Error(`V4 strict source fingerprint stopped before the end of ${table}`);
      }
      for (const row of rows) {
        if (!Number.isSafeInteger(row.id) || row.id <= lastId || typeof row.raw_row !== "string") {
          throw new Error(`V4 strict source fingerprint returned invalid ${table} row`);
        }
        tableDigest.update(`${row.id}:${Buffer.byteLength(row.raw_row, "utf8")}:${row.raw_row}\n`);
        if (table === "HealthSyncAudit" && (auditRetentionBaseline !== null || auditRetentionExisting !== null)) {
          const parsed = JSON.parse(row.raw_row) as { receivedAt?: unknown };
          const receivedAt = typeof parsed.receivedAt === "string" ? new Date(parsed.receivedAt) : null;
          if (!(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) {
            throw new Error("HealthSyncAudit retention inventory contains a malformed receivedAt timestamp.");
          }
          if (auditRetentionBaseline !== null) {
            addHealthSyncAuditRetentionRowV1(auditRetentionBaseline, {
              id: row.id, rawRow: row.raw_row, receivedAt,
            });
          } else if (row.id <= options.healthSyncAuditBaselineMaxId!) {
            addHealthSyncAuditRetentionRowV1(auditRetentionExisting!, {
              id: row.id, rawRow: row.raw_row, receivedAt,
            });
          } else {
            auditRetentionNewRowCount += 1;
          }
        }
        lastId = row.id;
        seen += 1;
      }
    }
    if (seen !== rowCount) {
      throw new Error(`V4 strict source fingerprint row count changed for ${table}`);
    }
    const tableFingerprint = tableDigest.digest("hex");
    if (table === "HealthSyncAudit") healthSyncAuditFingerprint = tableFingerprint;
    else digest.update(`${table}\0${tableFingerprint}\0`);
  }
  if (healthSyncAuditFingerprint === null) throw new Error("V4 recovery evidence omitted the audit preservation fingerprint");
  return {
    sourceFingerprint: digest.digest("hex"),
    healthSyncAuditFingerprint,
    ...(auditRetentionBaseline !== null ? {
      healthSyncAuditRetentionBaseline: createHealthSyncAuditRetentionBaselineV1(
        options.healthSyncAuditBaselineCapturedAt!, auditRetentionBaseline,
      ),
    } : {}),
    ...(auditRetentionExisting !== null ? {
      healthSyncAuditRetentionCurrentState: healthSyncAuditRetentionCurrentStateV1(
        auditRetentionExisting, auditRetentionNewRowCount,
      ),
    } : {}),
  };
}

function dateKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function parseTrainingFenceIdentityV1(sourceKey: string): {
  sessionId: number; identity: "session" | "deleted-session" | "deleted-set" | "deleted-exercise"; childId: number | null;
} | null {
  const numeric = /^([1-9]\d*)$/.exec(sourceKey);
  if (numeric) {
    const sessionId = Number(numeric[1]);
    return Number.isSafeInteger(sessionId) ? { sessionId, identity: "session", childId: null } : null;
  }
  const deletedSession = /^training-delete-session:([1-9]\d*)$/.exec(sourceKey);
  if (deletedSession) {
    const sessionId = Number(deletedSession[1]);
    return Number.isSafeInteger(sessionId) ? { sessionId, identity: "deleted-session", childId: null } : null;
  }
  const deletedChild = /^training-delete-(set|exercise):([1-9]\d*):([1-9]\d*)$/.exec(sourceKey);
  if (!deletedChild) return null;
  const sessionId = Number(deletedChild[2]);
  const childId = Number(deletedChild[3]);
  if (!Number.isSafeInteger(sessionId) || !Number.isSafeInteger(childId)) return null;
  return { sessionId, identity: deletedChild[1] === "set" ? "deleted-set" : "deleted-exercise", childId };
}

async function readPublicationSourceEvidenceV1(client: typeof prisma, blocks: Array<{
  source: string; sourceKey: string; fromDate: string; revision: number; createdAt: Date; updatedAt: Date;
}>) {
  const healthBlocks = blocks.filter((block) => block.source === "health");
  const health = await Promise.all(healthBlocks.map(async (block) => {
    const [dailyRows, snapshots, metrics] = await Promise.all([
      client.dailyHealthData.findMany({
        where: { date: block.fromDate },
        select: { id: true, date: true, updatedAt: true },
      }),
      client.healthSyncSnapshot.findMany({
        where: { date: block.fromDate },
        select: { date: true, dailyHealthDataId: true, receivedAt: true, syncedAt: true, timezone: true },
      }),
      client.healthMetricSample.findMany({
        where: { date: block.fromDate },
        select: { date: true, dailyHealthDataId: true, source: true },
      }),
    ]);
    const daily = dailyRows.length === 1 ? dailyRows[0] : null;
    const linkedSnapshotRows = snapshots.filter((snapshot) => daily !== null
      && snapshot.date === block.fromDate && snapshot.dailyHealthDataId === daily.id).length;
    const linkedMetricSampleRows = metrics.filter((sample) => daily !== null
      && sample.date === block.fromDate && sample.dailyHealthDataId === daily.id).length;
    const unsupportedMetricSourceRows = metrics.filter((sample) => sample.source !== APPLE_HEALTH_SHORTCUT_SOURCE).length;
    const blockCreatedAt = block.createdAt;
    const blockUpdatedAt = block.updatedAt;
    const snapshotTimesValid = snapshots.length > 0 && snapshots.every((snapshot) =>
      validDate(snapshot.receivedAt) && (snapshot.syncedAt === null || validDate(snapshot.syncedAt))
    );
    const snapshotTimeZonesValid = snapshots.length > 0 && snapshots.every((snapshot) => isValidTimeZone(snapshot.timezone));
    // A normal Health sync arms the fence before writing its day/snapshot, but
    // reconciliation may re-arm a missing fence after those rows already
    // exist. Keep both persisted orders valid; bind server receive time before
    // the fence, validate the day timestamp, and never order client syncedAt.
    const chronologyValid = validDate(blockCreatedAt) && validDate(blockUpdatedAt)
      && blockCreatedAt <= blockUpdatedAt && daily !== null && validDate(daily.updatedAt)
      && snapshotTimesValid && snapshotTimeZonesValid
      && snapshots.every((snapshot) => snapshot.receivedAt <= blockUpdatedAt);
    return {
      sourceKey: block.sourceKey,
      fromDate: block.fromDate,
      fenceRevision: block.revision,
      dailyDataRows: dailyRows.length,
      snapshotRows: snapshots.length,
      linkedSnapshotRows,
      invalidSnapshotRows: snapshots.length - linkedSnapshotRows,
      snapshotsWithReceivedAt: snapshots.filter((snapshot) => validDate(snapshot.receivedAt)).length,
      snapshotsWithSyncedAt: snapshots.filter((snapshot) => validDate(snapshot.syncedAt)).length,
      snapshotsWithNullSyncedAt: snapshots.filter((snapshot) => snapshot.syncedAt === null).length,
      snapshotsWithValidTimeZone: snapshots.filter((snapshot) => isValidTimeZone(snapshot.timezone)).length,
      invalidSnapshotTimes: snapshots.filter((snapshot) => !validDate(snapshot.receivedAt)
        || (snapshot.syncedAt !== null && !validDate(snapshot.syncedAt))).length,
      invalidSnapshotTimeZones: snapshots.filter((snapshot) => !isValidTimeZone(snapshot.timezone)).length,
      dailyUpdatedAt: daily?.updatedAt instanceof Date ? daily.updatedAt.toISOString() : null,
      metricSampleRows: metrics.length,
      linkedMetricSampleRows,
      invalidMetricSampleRows: metrics.length - linkedMetricSampleRows,
      unsupportedMetricSourceRows,
      chronologyValid,
    };
  }));

  const trainingBlocks = blocks.filter((block) => block.source === "training");
  const parsedTrainingBlocks = trainingBlocks.map((block) => ({ block, identity: parseTrainingFenceIdentityV1(block.sourceKey) }));
  if (parsedTrainingBlocks.some(({ identity }) => identity === null)) {
    throw new Error("Training publication evidence contains a non-canonical session or deletion identity");
  }
  parsedTrainingBlocks.sort((left, right) => left.identity!.sessionId - right.identity!.sessionId
    || left.block.sourceKey.localeCompare(right.block.sourceKey));
  const trainingIds = [...new Set(parsedTrainingBlocks.map(({ identity }) => identity!.sessionId))];
  const sessions = trainingIds.length > 0 ? await client.strengthDiarySession.findMany({
    where: { id: { in: trainingIds } },
    select: {
      id: true, profileId: true, status: true, entryMode: true, revision: true, accountingInputRevision: true,
      currentSnapshotRevision: true, matchedWorkoutId: true, matchStatus: true,
      effectiveAccountingAt: true, accountingTimeZone: true, accountingTimeZoneProvenance: true,
      webStartedAt: true, createdAt: true, updatedAt: true,
      matchedWorkout: { select: {
        id: true, type: true, startAt: true, sourceIdentity: true, dailyHealthDataId: true,
        dailyHealthData: { select: { date: true } },
      } },
    },
  }) : [];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const accountingSnapshots = trainingIds.length > 0 ? await client.strengthSessionAccountingSnapshot.findMany({
    where: { sessionId: { in: trainingIds } },
    select: {
      sessionId: true, snapshotRevision: true, accountingInputRevision: true, inputFingerprint: true,
      effectiveLocalDate: true, timeZone: true, timeZoneProvenance: true,
      accountingMethodVersion: true, massResolutionMethodVersion: true,
      massResolutionIdentity: true, payloadVersion: true, payload: true, createdAt: true,
    },
    orderBy: [{ sessionId: "asc" }, { snapshotRevision: "asc" }],
  }) : [];
  const snapshotsBySession = new Map<number, typeof accountingSnapshots>();
  for (const snapshot of accountingSnapshots) {
    const rows = snapshotsBySession.get(snapshot.sessionId) ?? [];
    rows.push(snapshot);
    snapshotsBySession.set(snapshot.sessionId, rows);
  }
  const pendingOperations = trainingIds.length > 0 ? await client.strengthSessionAccountingOperation.findMany({
    where: { sessionId: { in: trainingIds }, status: "PENDING" }, select: { sessionId: true, id: true },
  }) : [];
  const pendingOperationCountBySession = new Map<number, number>();
  for (const operation of pendingOperations) pendingOperationCountBySession.set(operation.sessionId,
    (pendingOperationCountBySession.get(operation.sessionId) ?? 0) + 1);
  const childSetIds = parsedTrainingBlocks.filter(({ identity }) => identity!.identity === "deleted-set")
    .map(({ identity }) => identity!.childId!);
  const childExerciseIds = parsedTrainingBlocks.filter(({ identity }) => identity!.identity === "deleted-exercise")
    .map(({ identity }) => identity!.childId!);
  const [childSets, childExercises] = await Promise.all([
    childSetIds.length > 0 ? client.strengthSet.findMany({
      where: { id: { in: childSetIds } }, select: { id: true, sessionExercise: { select: { sessionId: true } } },
    }) : [],
    childExerciseIds.length > 0 ? client.strengthSessionExercise.findMany({
      where: { id: { in: childExerciseIds } }, select: { id: true, sessionId: true },
    }) : [],
  ]);
  const childSetById = new Map(childSets.map((row) => [row.id, row]));
  const childExerciseById = new Map(childExercises.map((row) => [row.id, row]));
  const episodes = trainingIds.length > 0 ? await client.modelEpisode.findMany({
    where: { profileId: 1 }, orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true, timezone: true, active: true },
  }) : [];
  const training = parsedTrainingBlocks.map(({ block: trainingBlock, identity }) => {
    const sessionId = identity!.sessionId;
    const session = sessionById.get(sessionId) ?? null;
    const allSessionSnapshots = snapshotsBySession.get(sessionId) ?? [];
    const sessionSnapshots = session && session.currentSnapshotRevision !== null
      ? allSessionSnapshots.filter((snapshot) => snapshot.snapshotRevision === session.currentSnapshotRevision)
      : [];
    // The event clock follows the legacy writer; accounting uses its separate persisted fallback.
    const persistedEffectiveAccountingAt = session?.effectiveAccountingAt ?? null;
    const trainingEventAt = session?.matchedWorkout?.startAt ?? persistedEffectiveAccountingAt
      ?? session?.webStartedAt ?? session?.createdAt ?? null;
    const effectiveAccountingAt = persistedEffectiveAccountingAt ?? session?.matchedWorkout?.startAt
      ?? session?.webStartedAt ?? session?.createdAt ?? null;
    const accountingTimeZone = session?.accountingTimeZone ?? DEFAULT_TIME_ZONE;
    const accountingTimeZoneProvenance = session?.accountingTimeZoneProvenance ?? "legacy-default";
    const accountingEffectiveLocalDate = effectiveAccountingAt && isValidTimeZone(accountingTimeZone)
      ? instantToLocalDateTime(effectiveAccountingAt, accountingTimeZone).date : null;
    const modelDate = trainingEventAt
      ? episodeTimeContextForInstantV1(episodes, trainingEventAt).date : null;
    const snapshot = sessionSnapshots.length === 1 ? sessionSnapshots[0] : null;
    let snapshotTimeZoneValid = false;
    if (snapshot?.timeZone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: snapshot.timeZone }).format(new Date(0));
        snapshotTimeZoneValid = true;
      } catch { /* Invalid persisted timezone remains a failed evidence bit. */ }
    }
    const payload = snapshot ? persistedPayloadFromUnknown(snapshot.payload) : null;
    const expectedMassResolutionIdentity = payload && accountingEffectiveLocalDate && snapshotTimeZoneValid
      ? buildMassResolutionIdentity({
        localDate: accountingEffectiveLocalDate,
        timeZone: accountingTimeZone,
        methodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
        reference: payload.massReference,
      }) : null;
    const snapshotContractValid = Boolean(session && snapshot && payload && effectiveAccountingAt
      && accountingEffectiveLocalDate && snapshotTimeZoneValid
      && snapshot.snapshotRevision === session.currentSnapshotRevision
      && snapshot.accountingInputRevision === session.accountingInputRevision
      && snapshot.effectiveLocalDate === accountingEffectiveLocalDate
      && snapshot.timeZone === accountingTimeZone
      && snapshot.timeZoneProvenance === accountingTimeZoneProvenance
      && snapshot.accountingMethodVersion === LOAD_ACCOUNTING_METHOD_V1
      && snapshot.massResolutionMethodVersion === BODYWEIGHT_RESOLUTION_METHOD_V2
      && snapshot.massResolutionIdentity === expectedMassResolutionIdentity
      && /^[a-f0-9]{64}$/.test(snapshot.inputFingerprint)
      && snapshot.payloadVersion === payload.schemaVersion
      && payload.sessionId === session.id
      && payload.snapshotRevision === snapshot.snapshotRevision
      && payload.accountingInputRevision === session.accountingInputRevision
      && payload.effectiveAccountingAt === effectiveAccountingAt.toISOString()
      && payload.effectiveLocalDate === accountingEffectiveLocalDate
      && payload.timeZone === accountingTimeZone
      && payload.timeZoneProvenance === accountingTimeZoneProvenance
      && payload.inputFingerprint === snapshot.inputFingerprint
      && payload.accountingMethodVersion === LOAD_ACCOUNTING_METHOD_V1
      && payload.massResolutionMethodVersion === BODYWEIGHT_RESOLUTION_METHOD_V2
      && payload.massResolutionIdentity === expectedMassResolutionIdentity);
    const latestSnapshot = allSessionSnapshots.at(-1) ?? null;
    const latestPayload = latestSnapshot ? persistedPayloadFromUnknown(latestSnapshot.payload) : null;
    let latestSnapshotTimeZoneValid = false;
    if (latestSnapshot?.timeZone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: latestSnapshot.timeZone }).format(new Date(0));
        latestSnapshotTimeZoneValid = true;
      } catch { /* Invalid persisted timezone remains a failed evidence bit. */ }
    }
    const latestExpectedMassResolutionIdentity = latestSnapshot && latestPayload && latestSnapshotTimeZoneValid
      ? buildMassResolutionIdentity({
        localDate: latestSnapshot.effectiveLocalDate,
        timeZone: latestSnapshot.timeZone,
        methodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
        reference: latestPayload.massReference,
      }) : null;
    const snapshotPayloadMatchesRow = (candidate: (typeof allSessionSnapshots)[number]): boolean => {
      const candidatePayload = persistedPayloadFromUnknown(candidate.payload);
      if (!candidatePayload) return false;
      let timeZoneValid = false;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: candidate.timeZone }).format(new Date(0));
        timeZoneValid = true;
      } catch { /* Invalid persisted timezone remains a failed evidence bit. */ }
      if (!timeZoneValid) return false;
      const expectedIdentity = buildMassResolutionIdentity({
        localDate: candidate.effectiveLocalDate,
        timeZone: candidate.timeZone,
        methodVersion: candidate.massResolutionMethodVersion,
        reference: candidatePayload.massReference,
      });
      return candidatePayload.sessionId === sessionId
        && candidate.payloadVersion === candidatePayload.schemaVersion
        && candidatePayload.snapshotRevision === candidate.snapshotRevision
        && candidatePayload.accountingInputRevision === candidate.accountingInputRevision
        && candidatePayload.inputFingerprint === candidate.inputFingerprint
        && candidatePayload.effectiveLocalDate === candidate.effectiveLocalDate
        && candidatePayload.timeZone === candidate.timeZone
        && candidatePayload.timeZoneProvenance === candidate.timeZoneProvenance
        && candidatePayload.accountingMethodVersion === candidate.accountingMethodVersion
        && candidatePayload.massResolutionMethodVersion === candidate.massResolutionMethodVersion
        && candidatePayload.massResolutionIdentity === candidate.massResolutionIdentity
        && candidatePayload.massResolutionIdentity === expectedIdentity
        && instantToLocalDateTime(new Date(candidatePayload.effectiveAccountingAt), candidate.timeZone).date
          === candidate.effectiveLocalDate;
    };
    const historicalSnapshotChronologyValid = Boolean(session && allSessionSnapshots.length > 0
      && allSessionSnapshots.every((candidate, index) => validDate(candidate.createdAt)
        && candidate.createdAt <= session.updatedAt
        && Number.isSafeInteger(candidate.snapshotRevision) && candidate.snapshotRevision > 0
        && Number.isSafeInteger(candidate.accountingInputRevision) && candidate.accountingInputRevision > 0
        && candidate.accountingInputRevision <= session.accountingInputRevision
        && snapshotPayloadMatchesRow(candidate)
        && (index === 0 || (allSessionSnapshots[index - 1]!.snapshotRevision < candidate.snapshotRevision
          && allSessionSnapshots[index - 1]!.accountingInputRevision <= candidate.accountingInputRevision
          && allSessionSnapshots[index - 1]!.createdAt <= candidate.createdAt))));
    const latestSnapshotContractValid = Boolean(session && latestSnapshot && latestPayload
      && effectiveAccountingAt && accountingEffectiveLocalDate && latestSnapshotTimeZoneValid
      && latestSnapshot.effectiveLocalDate === accountingEffectiveLocalDate
      && latestSnapshot.timeZone === accountingTimeZone
      && latestSnapshot.timeZoneProvenance === accountingTimeZoneProvenance
      && latestSnapshot.accountingMethodVersion === LOAD_ACCOUNTING_METHOD_V1
      && latestSnapshot.massResolutionMethodVersion === BODYWEIGHT_RESOLUTION_METHOD_V2
      && latestSnapshot.massResolutionIdentity === latestExpectedMassResolutionIdentity
      && latestPayload.sessionId === session.id
      && latestSnapshot.payloadVersion === latestPayload.schemaVersion
      && latestPayload.snapshotRevision === latestSnapshot.snapshotRevision
      && latestPayload.accountingInputRevision === latestSnapshot.accountingInputRevision
      && latestPayload.inputFingerprint === latestSnapshot.inputFingerprint
      && latestPayload.effectiveAccountingAt === effectiveAccountingAt.toISOString()
      && latestPayload.effectiveLocalDate === accountingEffectiveLocalDate
      && latestPayload.timeZone === accountingTimeZone
      && latestPayload.timeZoneProvenance === accountingTimeZoneProvenance
      && latestPayload.accountingMethodVersion === LOAD_ACCOUNTING_METHOD_V1
      && latestPayload.massResolutionMethodVersion === BODYWEIGHT_RESOLUTION_METHOD_V2
      && latestPayload.massResolutionIdentity === latestExpectedMassResolutionIdentity
      && latestPayload.massResolutionIdentity === latestSnapshot.massResolutionIdentity);
    const latestSnapshotEvidenceSha256 = latestSnapshot ? sha256(canonicalJson({
      snapshotRevision: latestSnapshot.snapshotRevision,
      accountingInputRevision: latestSnapshot.accountingInputRevision,
      inputFingerprint: latestSnapshot.inputFingerprint,
      effectiveLocalDate: latestSnapshot.effectiveLocalDate,
      timeZone: latestSnapshot.timeZone,
      timeZoneProvenance: latestSnapshot.timeZoneProvenance,
      accountingMethodVersion: latestSnapshot.accountingMethodVersion,
      massResolutionMethodVersion: latestSnapshot.massResolutionMethodVersion,
      massResolutionIdentity: latestSnapshot.massResolutionIdentity,
      payloadVersion: latestSnapshot.payloadVersion,
      payload: latestSnapshot.payload,
      createdAt: latestSnapshot.createdAt,
    })) : null;
    const childRow = identity!.identity === "deleted-set"
      ? childSetById.get(identity!.childId!) ?? null
      : identity!.identity === "deleted-exercise" ? childExerciseById.get(identity!.childId!) ?? null : null;
    const childOwnerSessionId = childRow === null ? null
      : "sessionExercise" in childRow ? childRow.sessionExercise.sessionId : childRow.sessionId;
    const snapshotEvidenceSha256 = snapshot ? sha256(canonicalJson({
      snapshotRevision: snapshot.snapshotRevision,
      accountingInputRevision: snapshot.accountingInputRevision,
      inputFingerprint: snapshot.inputFingerprint,
      effectiveLocalDate: snapshot.effectiveLocalDate,
      timeZone: snapshot.timeZone,
      timeZoneProvenance: snapshot.timeZoneProvenance,
      accountingMethodVersion: snapshot.accountingMethodVersion,
      massResolutionMethodVersion: snapshot.massResolutionMethodVersion,
      massResolutionIdentity: snapshot.massResolutionIdentity,
      payloadVersion: snapshot.payloadVersion,
      payload: snapshot.payload,
      createdAt: snapshot.createdAt,
    })) : null;
    return {
      sourceKey: trainingBlock.sourceKey,
      fromDate: trainingBlock.fromDate,
      fenceRevision: trainingBlock.revision,
      identity: identity!.identity,
      childDeletionAccountingInputRevision: identity!.identity === "deleted-set"
        || identity!.identity === "deleted-exercise" ? trainingBlock.revision : null,
      sessionRows: session ? 1 : 0,
      sessionId,
      profileId: session?.profileId ?? null,
      status: session?.status ?? null,
      parentSessionRows: session ? 1 : 0,
      parentSessionId: session?.id ?? null,
      parentProfileId: session?.profileId ?? null,
      parentStatus: session?.status ?? null,
      childRows: identity!.childId === null ? null : childRow === null ? 0 : 1,
      childOwnerSessionId,
      entryMode: session?.entryMode ?? null,
      sourceRevision: session?.revision ?? null,
      accountingInputRevision: session?.accountingInputRevision ?? null,
      currentSnapshotRevision: session?.currentSnapshotRevision ?? null,
      createdAt: session?.createdAt?.toISOString() ?? null,
      persistedEffectiveAccountingAt: persistedEffectiveAccountingAt?.toISOString() ?? null,
      webStartedAt: session?.webStartedAt?.toISOString() ?? null,
      trainingEventAt: trainingEventAt?.toISOString() ?? null,
      matchedWorkoutStartAt: session?.matchedWorkout?.startAt?.toISOString() ?? null,
      effectiveAccountingAt: effectiveAccountingAt?.toISOString() ?? null,
      accountingTimeZone,
      accountingTimeZoneProvenance,
      matchedWorkoutId: session?.matchedWorkoutId ?? null,
      matchStatus: session?.matchStatus ?? null,
      matchedWorkoutPresent: session?.matchedWorkout !== null && session?.matchedWorkout !== undefined,
      matchedWorkoutIdentityMatches: session === null ? false : session.matchedWorkoutId === null
        ? session.matchedWorkout === null : session.matchedWorkoutId === session.matchedWorkout?.id,
      matchedWorkoutTypeSupported: session?.matchedWorkout
        ? canonicalizeWorkoutType(session.matchedWorkout.type).classification === "traditional-strength-training" : false,
      matchedWorkoutSourceIdentitySha256: session?.matchedWorkout?.sourceIdentity
        ? sha256(session.matchedWorkout.sourceIdentity) : null,
      matchedWorkoutSourceHealthDate: session?.matchedWorkout?.dailyHealthData?.date
        ? dateKey(session.matchedWorkout.dailyHealthData.date) : null,
      modelDate,
      accountingEffectiveLocalDate,
      accountingSnapshotRows: sessionSnapshots.length,
      snapshotRevision: snapshot?.snapshotRevision ?? null,
      snapshotAccountingInputRevision: snapshot?.accountingInputRevision ?? null,
      snapshotEffectiveLocalDate: snapshot?.effectiveLocalDate ?? null,
      snapshotTimeZone: snapshot?.timeZone ?? null,
      snapshotTimeZoneValid,
      snapshotTimeZoneProvenance: snapshot?.timeZoneProvenance ?? null,
      snapshotContractValid,
      snapshotEvidenceSha256,
      latestSnapshotRows: latestSnapshot === null ? 0
        : allSessionSnapshots.filter((candidate) => candidate.snapshotRevision === latestSnapshot.snapshotRevision).length,
      latestSnapshotRevision: latestSnapshot?.snapshotRevision ?? null,
      latestSnapshotAccountingInputRevision: latestSnapshot?.accountingInputRevision ?? null,
      latestSnapshotEffectiveLocalDate: latestSnapshot?.effectiveLocalDate ?? null,
      latestSnapshotTimeZone: latestSnapshot?.timeZone ?? null,
      latestSnapshotTimeZoneValid,
      latestSnapshotTimeZoneProvenance: latestSnapshot?.timeZoneProvenance ?? null,
      latestSnapshotContractValid,
      latestSnapshotEvidenceSha256,
      historicalSnapshotChronologyValid,
      pendingAccountingOperationRows: pendingOperationCountBySession.get(sessionId) ?? 0,
      accountingRevisionGap: session && latestSnapshot
        ? session.accountingInputRevision - latestSnapshot.accountingInputRevision : null,
      sourceFenceChronologyValid: validDate(trainingBlock.createdAt) && validDate(trainingBlock.updatedAt)
        && trainingBlock.createdAt <= trainingBlock.updatedAt,
      sessionUpdateFenceChronologyValid: session !== null && validDate(session.updatedAt)
        && validDate(trainingBlock.updatedAt) && session.updatedAt <= trainingBlock.updatedAt,
      chronologyValid: Boolean(session && snapshot && validDate(snapshot.createdAt) && validDate(session.updatedAt)
        && validDate(trainingBlock.createdAt) && validDate(trainingBlock.updatedAt)
        && snapshot.createdAt <= session.updatedAt && session.updatedAt <= trainingBlock.updatedAt
        && trainingBlock.createdAt <= trainingBlock.updatedAt),
    };
  });
  return { health, training };
}

async function migrationManifest() {
  const root = "/app/prisma/migrations";
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const rows = [];
  for (const name of names) {
    const sql = await readFile(join(root, name, "migration.sql"));
    rows.push({ name, checksum: sha256(sql) });
  }
  const treeDigest = sha256(rows.map((row) => `${row.name}\t${row.checksum}\n`).join(""));
  return { rows, treeDigest };
}

async function main() {
  const [manifest, result] = await Promise.all([
    migrationManifest(),
    prisma.$transaction(async (tx) => {
      const [identity] = await tx.$queryRawUnsafe<Array<{
        database: string; version: string; serverAddress: string; serverPort: number;
      }>>(`SELECT current_database() AS database, current_setting('server_version') AS version,
        host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort"`);
      const migrations = await tx.$queryRawUnsafe<Array<{
        name: string; checksum: string; finishedAt: Date | null; rolledBackAt: Date | null;
      }>>(`SELECT migration_name AS name, checksum, finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
        FROM public."_prisma_migrations" ORDER BY migration_name`);
      const lifecycle = await tx.physiologyV7Lifecycle.findUnique({
        where: { profileId: 1 },
        select: { profileId: true, invalidationGeneration: true, productionPublishedGeneration: true,
          productionStaleFromDate: true, unifiedTargetRevision: true, unifiedRolloutEpoch: true,
          unifiedPublishedGeneration: true, unifiedPublishedRolloutEpoch: true,
          unifiedPublicationBlockedFromDate: true, unifiedPublicationBlockedSource: true },
      });
      const blocks = await tx.unifiedPublicationBlock.findMany({
        where: { profileId: 1 }, orderBy: [{ source: "asc" }, { sourceKey: "asc" }],
        select: { source: true, sourceKey: true, fromDate: true, revision: true, createdAt: true, updatedAt: true },
      });
      // The audited inventory helper only needs $queryRawUnsafe; Prisma's
      // transaction client shares that API while intentionally omitting
      // $transaction itself from its static type.
      const rawFingerprints = await inventoryV4RecoveryRawSourcesV1(tx as unknown as typeof prisma);
      const sourceEvidence = await readPublicationSourceEvidenceV1(tx as unknown as typeof prisma,
        blocks.map((block) => ({ ...block, fromDate: dateKey(block.fromDate) })));
      const [sourceModelDayRows, coveredDayRows] = lifecycle ? await Promise.all([
        readExpectedV4ModelDayBoundariesV1(tx as unknown as typeof prisma, 1),
        tx.unifiedExperimentalPhysiologyStateV2.findMany({
          where: { profileId: 1, modelRevision: lifecycle.unifiedTargetRevision },
          select: { modelEpisodeId: true, date: true }, orderBy: [{ date: "asc" }, { modelEpisodeId: "asc" }],
        }),
      ]) : [[], []];
      return {
        database: identity,
        migrationRows: migrations,
        lifecycle,
        blocks: blocks.map((block) => ({ ...block, fromDate: dateKey(block.fromDate) })),
        sourceEvidence,
        sourceFingerprint: rawFingerprints.sourceFingerprint,
        healthSyncAuditFingerprint: rawFingerprints.healthSyncAuditFingerprint,
        sourceModelDayKeys: sourceModelDayRows.map((row) => `${row.episodeId}|${row.modelDate}`),
        sourceModelDayDates: sourceModelDayRows.map((row) => row.modelDate),
        coveredModelDayKeys: coveredDayRows.map((row) => `${row.modelEpisodeId}|${dateKey(row.date)}`),
        coveredDayDates: coveredDayRows.map((row) => dateKey(row.date)),
        sourceModelDayCount: sourceModelDayRows.length,
        coveredDayCount: coveredDayRows.length,
      };
    }, {
      isolationLevel: "RepeatableRead",
      maxWait: 10_000,
      // Production HealthSyncSnapshot has several thousand rows. Keep the
      // consistent read bounded, but allow enough time for all fingerprint
      // pages to complete; Prisma's interactive transaction default is 5s.
      timeout: 60_000,
    }),
  ]);
  const output = { ...result, expectedMigrationRows: manifest.rows, expectedLedgerDigest: manifest.treeDigest };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export function isProductionV4RecoveryEvidenceEntrypoint(executablePath: string | undefined): boolean {
  const entrypoint = executablePath ? basename(executablePath) : "";
  return entrypoint === "production-v4-recovery-evidence.ts"
    || entrypoint === "production-v4-recovery-evidence.mjs";
}

if (isProductionV4RecoveryEvidenceEntrypoint(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`V4 recovery read-only evidence failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }).finally(async () => prisma.$disconnect());
}
