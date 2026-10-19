import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, isValidTimeZone } from "@/model/time-zone";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import { BODYWEIGHT_RESOLUTION_METHOD_V2 } from "@/modules/training/bodyweight-reference-v2";
import { LOAD_ACCOUNTING_METHOD_V1 } from "@/modules/training/load-accounting-v1";
import { buildMassResolutionIdentity, persistedPayloadFromUnknown } from "@/modules/training/persisted-load-accounting-v1";

const APPLE_HEALTH_SHORTCUT_SOURCE = "apple-health-shortcut";

// Keep this exact allowlist aligned with the audited legacy recovery source.
// It is repeated here because this evidence wrapper must also typecheck on
// current main, which intentionally does not carry the legacy recovery service.
const RECOVERY_RAW_INPUT_TABLES = [
  "Profile",
  "ModelEpisode",
  "StepperEquipmentAssignment",
  "DailyHealthData",
  "HealthMetricSample",
  "HeartRateSample",
  "RestingHeartRateSample",
  "SleepSegment",
  "HealthSyncSnapshot",
  "HealthSyncAudit",
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
const RECOVERY_RAW_FINGERPRINT_PAGE_SIZE = 32;

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

async function inventoryV4RecoveryRawSourcesV1(client: typeof prisma): Promise<string> {
  const digest = createHash("sha256").update("bodycast-v4-recovery-raw-sources-v1\0");
  for (const table of RECOVERY_RAW_INPUT_TABLES) {
    const rawRowExpression = table === "ModelEpisode"
      ? `to_jsonb(source_row) - ARRAY['personalOffsetKcalPerDay', 'activityCalibration', 'calibrationStatus', 'calibrationDiagnostics', 'latestModeledDate', 'updatedAt']::text[]`
      : "to_jsonb(source_row)";
    const [countRow] = await client.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM public."${table}"`,
    );
    const rowCount = countRow?.count;
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
      throw new Error(`V4 strict source fingerprint returned invalid ${table} row count`);
    }
    const tableDigest = createHash("sha256").update(`${table}\0${rowCount}\0`);
    let lastId: number | null = null;
    let seen = 0;
    while (seen < rowCount) {
      let rows: Array<{ id: number; raw_row: string }>;
      if (lastId === null) {
        rows = await client.$queryRawUnsafe<Array<{ id: number; raw_row: string }>>(
          `SELECT source_row.id, (${rawRowExpression})::text AS raw_row
           FROM public."${table}" AS source_row
           ORDER BY source_row.id
           LIMIT $1`,
          RECOVERY_RAW_FINGERPRINT_PAGE_SIZE,
        );
      } else {
        rows = await client.$queryRawUnsafe<Array<{ id: number; raw_row: string }>>(
          `SELECT source_row.id, (${rawRowExpression})::text AS raw_row
           FROM public."${table}" AS source_row
           WHERE source_row.id > $1
           ORDER BY source_row.id
           LIMIT $2`,
          lastId,
          RECOVERY_RAW_FINGERPRINT_PAGE_SIZE,
        );
      }
      if (rows.length === 0) {
        throw new Error(`V4 strict source fingerprint stopped before the end of ${table}`);
      }
      for (const row of rows) {
        if (!Number.isSafeInteger(row.id) || (lastId !== null && row.id <= lastId) || typeof row.raw_row !== "string") {
          throw new Error(`V4 strict source fingerprint returned invalid ${table} row`);
        }
        tableDigest.update(`${row.id}:${Buffer.byteLength(row.raw_row, "utf8")}:${row.raw_row}\n`);
        lastId = row.id;
        seen += 1;
      }
    }
    if (seen !== rowCount) {
      throw new Error(`V4 strict source fingerprint row count changed for ${table}`);
    }
    digest.update(`${table}\0${tableDigest.digest("hex")}\0`);
  }
  return digest.digest("hex");
}

function dateKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
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
  const trainingBlock = trainingBlocks.length === 1 && trainingBlocks[0]?.sourceKey === "20"
    ? trainingBlocks[0] : null;
  const session = trainingBlock ? await client.strengthDiarySession.findUnique({
    where: { id: 20 },
    select: {
      id: true, profileId: true, status: true, revision: true, accountingInputRevision: true,
      currentSnapshotRevision: true, matchedWorkoutId: true, matchStatus: true,
      effectiveAccountingAt: true, accountingTimeZone: true, accountingTimeZoneProvenance: true,
      webStartedAt: true, createdAt: true, updatedAt: true,
      matchedWorkout: { select: { id: true, startAt: true } },
    },
  }) : null;
  const accountingSnapshot = session?.currentSnapshotRevision !== null && session?.currentSnapshotRevision !== undefined
    ? await client.strengthSessionAccountingSnapshot.findMany({
      where: { sessionId: 20, snapshotRevision: session.currentSnapshotRevision },
      select: {
        snapshotRevision: true, accountingInputRevision: true, inputFingerprint: true,
        effectiveLocalDate: true, timeZone: true, timeZoneProvenance: true,
        accountingMethodVersion: true, massResolutionMethodVersion: true,
        massResolutionIdentity: true, payloadVersion: true, payload: true, createdAt: true,
      },
    }) : [];
  const episodes = session ? await client.modelEpisode.findMany({
    where: { profileId: 1 }, orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true, timezone: true, active: true },
  }) : [];
  // Keep the publication fence event clock aligned with the legacy writer:
  // matched workout start first, then persisted accounting/event fallbacks.
  // Accounting snapshots intentionally retain their separate effective-time
  // contract below.
  const trainingEventAt = session?.matchedWorkout?.startAt ?? session?.effectiveAccountingAt
    ?? session?.webStartedAt ?? session?.createdAt ?? null;
  // Accounting snapshots retain the persisted accounting-time contract. Do
  // not change this fallback order to match the independent fence event clock.
  const effectiveAccountingAt = session?.effectiveAccountingAt ?? session?.matchedWorkout?.startAt
    ?? session?.webStartedAt ?? session?.createdAt ?? null;
  const accountingTimeZone = session?.accountingTimeZone ?? DEFAULT_TIME_ZONE;
  const accountingTimeZoneProvenance = session?.accountingTimeZoneProvenance ?? "legacy-default";
  const accountingEffectiveLocalDate = effectiveAccountingAt && isValidTimeZone(accountingTimeZone)
    ? instantToLocalDateTime(effectiveAccountingAt, accountingTimeZone).date : null;
  const modelDate = trainingEventAt
    ? episodeTimeContextForInstantV1(episodes, trainingEventAt).date : null;
  const snapshot = accountingSnapshot.length === 1 ? accountingSnapshot[0] : null;
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
  const training = trainingBlock ? {
    sourceKey: trainingBlock.sourceKey,
    fromDate: trainingBlock.fromDate,
    fenceRevision: trainingBlock.revision,
    sessionRows: session ? 1 : 0,
    sessionId: session?.id ?? null,
    profileId: session?.profileId ?? null,
    status: session?.status ?? null,
    sourceRevision: session?.revision ?? null,
    accountingInputRevision: session?.accountingInputRevision ?? null,
    currentSnapshotRevision: session?.currentSnapshotRevision ?? null,
    trainingEventAt: trainingEventAt?.toISOString() ?? null,
    matchedWorkoutStartAt: session?.matchedWorkout?.startAt?.toISOString() ?? null,
    effectiveAccountingAt: effectiveAccountingAt?.toISOString() ?? null,
    accountingTimeZone,
    accountingTimeZoneProvenance,
    matchedWorkoutId: session?.matchedWorkoutId ?? null,
    matchStatus: session?.matchStatus ?? null,
    matchedWorkoutPresent: session?.matchedWorkout !== null && session?.matchedWorkout !== undefined,
    matchedWorkoutIdentityMatches: session?.matchedWorkoutId === session?.matchedWorkout?.id,
    modelDate,
    accountingEffectiveLocalDate,
    accountingSnapshotRows: accountingSnapshot.length,
    snapshotRevision: snapshot?.snapshotRevision ?? null,
    snapshotAccountingInputRevision: snapshot?.accountingInputRevision ?? null,
    snapshotEffectiveLocalDate: snapshot?.effectiveLocalDate ?? null,
    snapshotTimeZone: snapshot?.timeZone ?? null,
    snapshotTimeZoneValid,
    snapshotTimeZoneProvenance: snapshot?.timeZoneProvenance ?? null,
    snapshotContractValid,
    snapshotEvidenceSha256,
    chronologyValid: Boolean(session && snapshot && validDate(snapshot.createdAt) && validDate(session.updatedAt)
      && validDate(trainingBlock.createdAt) && validDate(trainingBlock.updatedAt)
      && snapshot.createdAt <= session.updatedAt && session.updatedAt <= trainingBlock.updatedAt
      && trainingBlock.createdAt <= trainingBlock.updatedAt),
  } : null;
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
        inet_server_addr()::text AS "serverAddress", inet_server_port() AS "serverPort"`);
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
      const sourceFingerprint = await inventoryV4RecoveryRawSourcesV1(tx as unknown as typeof prisma);
      const sourceEvidence = await readPublicationSourceEvidenceV1(tx as unknown as typeof prisma,
        blocks.map((block) => ({ ...block, fromDate: dateKey(block.fromDate) })));
      const [persistedDayRows, coveredDayRows] = lifecycle ? await Promise.all([
        tx.dailyModelState.findMany({ where: { episode: { profileId: 1, active: true } },
          select: { date: true }, orderBy: { date: "asc" } }),
        tx.unifiedExperimentalPhysiologyStateV2.findMany({
          where: { profileId: 1, modelRevision: lifecycle.unifiedTargetRevision },
          select: { date: true }, orderBy: { date: "asc" },
        }),
      ]) : [[], []];
      return {
        database: identity,
        migrationRows: migrations,
        lifecycle,
        blocks: blocks.map((block) => ({ ...block, fromDate: dateKey(block.fromDate) })),
        sourceEvidence,
        sourceFingerprint,
        persistedDayDates: persistedDayRows.map((row) => dateKey(row.date)),
        coveredDayDates: coveredDayRows.map((row) => dateKey(row.date)),
        persistedDayCount: persistedDayRows.length,
        coveredDayCount: coveredDayRows.length,
      };
    }, { isolationLevel: "RepeatableRead" }),
  ]);
  const output = { ...result, expectedMigrationRows: manifest.rows, expectedLedgerDigest: manifest.treeDigest };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`V4 recovery read-only evidence failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
