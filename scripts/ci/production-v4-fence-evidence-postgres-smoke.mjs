import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { assertRecoveryPostflight, modelDayKeysDigest, publicationBlockDigest, recoveryEvidenceBinding,
  validatePublicationSourceEvidence } from "../production-v4-derived-recovery.mjs";

const databaseUrl = process.env.BODYCAST_V4_RECOVERY_TEST_DATABASE_URL;
const image = process.env.BODYCAST_V4_RECOVERY_TEST_IMAGE;
if (typeof databaseUrl !== "string" || typeof image !== "string" || image.length === 0) {
  throw new Error("An explicit disposable V4 recovery test database and exact legacy image are required.");
}
const parsedUrl = new URL(databaseUrl);
if (parsedUrl.protocol !== "postgresql:" || parsedUrl.hostname !== "127.0.0.1"
  || parsedUrl.pathname !== "/bodycast_v4_recovery_test" || parsedUrl.username !== "bodycast") {
  throw new Error("V4 fence evidence integration refuses a non-loopback or non-test database URL.");
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const healthDates = Array.from({ length: 9 }, (_, index) => `2025-01-${String(index + 1).padStart(2, "0")}`);
// The event clock crosses an episode/timezone boundary and lands on Jan 11;
// accounting remains bound to the distinct persisted Jan 10 local date.
const trainingEffectiveAt = "2025-01-09T23:30:00.000Z";
const trainingWorkoutStartAt = "2025-01-10T11:00:00.000Z";
const trainingLocalDate = "2025-01-10";
const trainingModelDate = "2025-01-11";
const trainingEarlierFenceDate = "2025-01-10";
const trainingTimeZone = "Europe/Bratislava";
const trainingTimeZoneProvenance = "legacy-default";
const trainingSessions = [
  { id: 20, status: "MATCHED", entryMode: "RETROSPECTIVE", matchedWorkoutId: 79,
    effectiveAt: trainingEffectiveAt, localDate: trainingLocalDate, webStartedAt: null,
    eventAt: trainingWorkoutStartAt, modelDate: trainingModelDate, fromDate: trainingEarlierFenceDate },
  { id: 24, status: "PENDING", entryMode: "LIVE", matchedWorkoutId: null,
    effectiveAt: "2025-01-10T23:30:00.000Z", localDate: "2025-01-11", webStartedAt: "2025-01-10T20:00:00.000Z",
    eventAt: "2025-01-10T23:30:00.000Z", modelDate: trainingModelDate, fromDate: "2025-01-10" },
  { id: 25, status: "UNMATCHED", entryMode: "RETROSPECTIVE", matchedWorkoutId: null,
    effectiveAt: "2025-01-11T02:30:00.000Z", localDate: "2025-01-11", webStartedAt: null,
    eventAt: "2025-01-11T02:30:00.000Z", modelDate: trainingModelDate, fromDate: trainingModelDate },
].map((session, index) => ({
  ...session,
  revision: 24 + index,
  accountingInputRevision: 22 + index,
  snapshotRevision: 79 + index,
  inputFingerprint: String.fromCharCode(97 + index).repeat(64),
}));
// HealthSyncAudit has independent 30-day retention. It is preserved during a
// recovery run but excluded from long-lived V4 model currentness.
const rawFingerprintTables = [
  "Profile", "ModelEpisode", "StepperEquipmentAssignment", "DailyHealthData",
  "HealthMetricSample", "HeartRateSample", "RestingHeartRateSample", "SleepSegment",
  "HealthSyncSnapshot", "HealthActivityInterval", "Workout",
  "ExerciseCatalog", "ExerciseLoadConfiguration", "TrainingProgram",
  "TrainingProgramVersion", "ProgramExercise", "StrengthDiarySession",
  "StrengthDiaryProgramChange", "StrengthSessionExercise", "StrengthSet",
  "WorkInterval", "StepperReconciliationGroup", "StepperReconciliationCandidate",
  "StrengthSessionAccountingSnapshot", "StrengthSessionAccountingOperation",
];

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function unavailableMetric(unit) {
  return { value: null, unit, availability: "unavailable",
    coverage: { eligibleRows: 0, accountedRows: 0, omittedRows: 0, omittedReasons: {} }, provenance: [] };
}

function trainingAccountingPayload(session) {
  const massReference = { status: "unavailable", valueKg: null, localDate: session.localDate, source: null, sourceId: null };
  const accountingMethodVersion = "bodycast-load-accounting-v1";
  const massResolutionMethodVersion = "bodycast-bodyweight-resolution-v2";
  const massResolutionIdentity = createHash("sha256").update(canonicalJson({
    localDate: session.localDate, timeZone: trainingTimeZone,
    methodVersion: massResolutionMethodVersion, reference: massReference,
  })).digest("hex");
  return {
    schemaVersion: "bodycast-persisted-load-accounting-v1",
    sessionId: session.id,
    snapshotRevision: session.snapshotRevision,
    accountingInputRevision: session.accountingInputRevision,
    effectiveAccountingAt: session.effectiveAt,
    effectiveLocalDate: session.localDate,
    timeZone: trainingTimeZone,
    timeZoneProvenance: trainingTimeZoneProvenance,
    inputFingerprint: session.inputFingerprint,
    accountingMethodVersion,
    massResolutionMethodVersion,
    massResolutionIdentity,
    massReference,
    result: {
      methodVersion: accountingMethodVersion,
      externalLoadVolume: unavailableMetric("kg-repetitions"),
      bandNominalIndex: {
        perLoggedSide: unavailableMetric("nominal-kg-repetitions-per-logged-side"),
        leftSide: unavailableMetric("nominal-kg-repetitions-per-side"),
        rightSide: unavailableMetric("nominal-kg-repetitions-per-side"),
      },
      bodyweight: {
        sets: unavailableMetric("sets"), repetitions: unavailableMetric("repetitions"),
        reference: massReference, referenceVolume: unavailableMetric("bodyweight-reference-kg-repetitions"),
      },
      additionalLoad: unavailableMetric("kg-repetitions"),
      assistanceLoad: unavailableMetric("kg-repetitions"),
      identityCoverage: { customExercises: 0, ambiguousExercises: 0, unverifiedExercises: 0 },
    },
  };
}

async function insertHealthDay(date, revision = 1, fenceAfterSource = false) {
  if (!fenceAfterSource) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO public."UnifiedPublicationBlock" ("profileId", source, "sourceKey", "fromDate", revision, "createdAt", "updatedAt")
       VALUES (1, 'health', $1, $1, $2, CURRENT_TIMESTAMP - INTERVAL '10 seconds', CURRENT_TIMESTAMP - INTERVAL '10 seconds')`,
      date, revision,
    );
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."DailyHealthData" (date, "rawPayload", "createdAt", "updatedAt")
     VALUES ($1, '{"fixture":true,"source":"apple-health-shortcut"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    date,
  );
  const [daily] = await prisma.$queryRawUnsafe(`SELECT id FROM public."DailyHealthData" WHERE date = $1`, date);
  if (!Number.isSafeInteger(daily?.id)) throw new Error("Isolated Health fixture row was not persisted.");
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."HealthSyncSnapshot" ("dailyHealthDataId", date, "receivedAt", "syncedAt", timezone, "rawPayload")
     VALUES ($1, $2, ($2::date + TIME '12:01'), CASE WHEN $2 = '2025-01-09' THEN NULL ELSE ($2::date + TIME '12:00') END,
       'UTC', '{"fixture":true}'::jsonb)`,
    daily.id, date,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."HealthMetricSample" ("dailyHealthDataId", date, metric, "timestamp", value, source)
     VALUES ($1, $2, 'steps', ($2::date + TIME '12:00'), 1, 'apple-health-shortcut')`,
    daily.id, date,
  );
  if (fenceAfterSource) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO public."UnifiedPublicationBlock" ("profileId", source, "sourceKey", "fromDate", revision, "createdAt", "updatedAt")
       VALUES (1, 'health', $1, $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      date, revision,
    );
  }
}

async function insertTrainingFence(block) {
  const createdAt = block.createdAt ?? new Date();
  const updatedAt = block.updatedAt ?? createdAt;
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."UnifiedPublicationBlock" ("profileId", source, "sourceKey", "fromDate", revision, "createdAt", "updatedAt")
     VALUES (1, 'training', $1, $2, $3, $4, $5)`,
    block.sourceKey, block.fromDate, block.revision, createdAt, updatedAt,
  );
}

async function insertEpisode(startDate, timezone, active, deactivatedAt) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."ModelEpisode" (
       "profileId", "startDate", timezone, "modelVersion", active, "deactivatedAt", "ecfPolicy",
       "baselineEnergyIntakeKcalPerDay", "baselineCarbIntakeG", "baselineWindowStartDate", "baselineWindowEndDate",
       "baselineNutritionDayCount", "baselineWeightObservationCount", "baselineWeightTrendKgPerWeek",
       "baselineWeightTrendPercentPerWeek", "baselineDerivationMethod", "initialFatMassKg", "initialLeanTissueKg",
       "initialGlycogenKg", "baselineExtracellularFluidLiters", "initialExtracellularFluidDeviationLiters",
       "initialAdaptiveThermogenesisKcalPerDay", "initialFilteredWeightKg", "initialWeightFilterVarianceKg2",
       "initialRmrKcalPerDay", "dynamicRmrFatCoefficient", "dynamicRmrLeanCoefficient",
       "dynamicRmrCalibrationOffsetKcalPerDay", "adaptiveThermogenesisBeta", "adaptiveThermogenesisTimeConstantDays",
       "weightProcessNoiseVarianceKg2PerDay", "weightMeasurementNoiseVarianceKg2", "calibrationDiagnostics",
       "createdAt", "updatedAt")
     VALUES (1, $1, $2, 'bodycast-physiology-v7', $3, $4, 'hold-ecf',
       2400, 220, $1, $1, 1, 1, 0, 0, 'v4-recovery-date-parity-fixture',
       16, 55, 0.5, 18, 0, 0, 80, 1, 1700, 3.2, 22, 0, 0.14, 14, 0.01, 0.25, '{}'::jsonb,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    startDate, timezone, active, deactivatedAt,
  );
}

async function readEvidence() {
  let output;
  try {
    output = execFileSync("docker", ["run", "--rm", "--network", "host", "--env", `DATABASE_URL=${databaseUrl}`,
      image, "node", "/app/dist/production-v4-recovery-evidence.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("Exact legacy recovery image could not read the isolated 65-migration fixture database.");
  }
  const report = JSON.parse(output.trim());
  const [endpoint] = await prisma.$queryRawUnsafe(`SELECT host(inet_server_addr()) AS "serverAddress",
    inet_server_port() AS "serverPort"`);
  const evidenceAddress = report.database?.serverAddress;
  if (typeof evidenceAddress !== "string" || evidenceAddress.includes("/")
    || evidenceAddress !== endpoint?.serverAddress || report.database?.serverPort !== endpoint?.serverPort) {
    throw new Error("Recovery evidence did not report the canonical PostgreSQL host address and port.");
  }
  return report;
}

function validateWithExactImage(report, expectedRejection) {
  const validator = `import { validatePublicationSourceEvidence } from '/app/dist/production-v4-derived-recovery.mjs';
let source = '';
for await (const chunk of process.stdin) source += chunk;
const input = JSON.parse(source);
let rejected = false;
try { validatePublicationSourceEvidence({ blocks: input.blocks, sourceEvidence: input.sourceEvidence }); }
catch { rejected = true; }
if (rejected !== input.expectedRejection) process.exitCode = 17;`;
  execFileSync("docker", ["run", "--rm", "--interactive", image, "node", "--input-type=module", "-e", validator], {
    input: JSON.stringify({ blocks: report.blocks, sourceEvidence: report.sourceEvidence,
      expectedRejection }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
}

async function legacyUnpagedRawFingerprint() {
  const digest = createHash("sha256").update("bodycast-v4-recovery-raw-sources-v3\0");
  for (const table of rawFingerprintTables) {
    const rawRowExpression = table === "ModelEpisode"
      ? `to_jsonb(source_row) - ARRAY['personalOffsetKcalPerDay', 'activityCalibration', 'calibrationStatus', 'calibrationDiagnostics', 'latestModeledDate', 'updatedAt']::text[]`
      : "to_jsonb(source_row)";
    const rows = await prisma.$queryRawUnsafe(
      `SELECT source_row.id, (${rawRowExpression})::text AS raw_row
       FROM public."${table}" AS source_row ORDER BY source_row.id`,
    );
    const tableDigest = createHash("sha256").update(`${table}\0${rows.length}\0`);
    for (const row of rows) {
      tableDigest.update(`${row.id}:${Buffer.byteLength(row.raw_row, "utf8")}:${row.raw_row}\n`);
    }
    digest.update(`${table}\0${tableDigest.digest("hex")}\0`);
  }
  return digest.digest("hex");
}

async function legacyHealthSyncAuditFingerprint() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT source_row.id, to_jsonb(source_row)::text AS raw_row
     FROM public."HealthSyncAudit" AS source_row ORDER BY source_row.id`,
  );
  const digest = createHash("sha256").update(`HealthSyncAudit\0${rows.length}\0`);
  for (const row of rows) digest.update(`${row.id}:${Buffer.byteLength(row.raw_row, "utf8")}:${row.raw_row}\n`);
  return digest.digest("hex");
}

async function assertHealthSyncAuditRetentionExcludedFromV4Fingerprint() {
  const before = await legacyUnpagedRawFingerprint();
  const auditBefore = await legacyHealthSyncAuditFingerprint();
  const audit = await prisma.healthSyncAudit.create({
    data: { receivedAt: new Date("2025-01-01T00:00:00.000Z"), outcome: "success", httpStatus: 200,
      rawBody: "{\"fixture\":\"expired-audit\"}", contentType: "application/json" },
  });
  try {
    const retained = await readEvidence();
    if (retained.sourceFingerprint !== before
        || retained.healthSyncAuditFingerprint === auditBefore) {
      throw new Error("A retention-managed HealthSyncAudit row changed the V4 model-input fingerprint.");
    }
  } finally {
    await prisma.healthSyncAudit.delete({ where: { id: audit.id } });
  }
  const pruned = await readEvidence();
  if (pruned.sourceFingerprint !== before || await legacyUnpagedRawFingerprint() !== before
      || pruned.healthSyncAuditFingerprint !== auditBefore
      || await legacyHealthSyncAuditFingerprint() !== auditBefore) {
    throw new Error("Pruning an operational HealthSyncAudit row changed the V4 model-input fingerprint.");
  }
}

async function insertFingerprintPageBoundarySnapshots(date, count) {
  const [daily] = await prisma.$queryRawUnsafe(
    `SELECT id FROM public."DailyHealthData" WHERE date = $1`, date,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."HealthSyncSnapshot" (
       "dailyHealthDataId", date, "receivedAt", "syncedAt", timezone, "rawPayload")
     SELECT $1, $2, ($2::date + TIME '12:02' + series * INTERVAL '1 second') AT TIME ZONE 'UTC',
       NULL, 'UTC', '{"fixture":"fingerprint-page-boundary"}'::jsonb
     FROM generate_series(1, $3::int) AS series`,
    daily.id, date, count,
  );
}

async function validateCurrentEvidence(expectedHealthCount) {
  const report = await readEvidence();
  if (report.database?.database !== "bodycast_v4_recovery_test" || report.migrationRows?.length !== 65
    || report.expectedMigrationRows?.length !== 65 || report.blocks.filter((block) => block.source === "health").length !== expectedHealthCount) {
    throw new Error("Exact legacy image did not return the expected isolated schema and dynamic fence count.");
  }
  validatePublicationSourceEvidence({ blocks: report.blocks, sourceEvidence: report.sourceEvidence });
  if (!/^[a-f0-9]{64}$/.test(publicationBlockDigest(report.blocks))) {
    throw new Error("Exact legacy evidence returned an invalid complete fence-set digest.");
  }
  return report;
}

async function validateTrainingDeletionEvidenceOnExactImage() {
  const baselineFingerprint = await legacyUnpagedRawFingerprint();
  const sessionId = 27;
  const deletedSessionId = 28;
  const childKeys = [];
  try {
    const session = {
      id: sessionId,
      snapshotRevision: 90,
      accountingInputRevision: 41,
      localDate: "2025-01-11",
      effectiveAt: "2025-01-11T12:00:00.000Z",
      inputFingerprint: "d".repeat(64),
    };
    const payload = trainingAccountingPayload(session);
    await prisma.strengthDiarySession.create({
      data: {
        id: sessionId, profileId: 1, programId: 1, programVersionId: 1,
        status: "COMPLETED", entryMode: "LIVE", revision: 2, accountingInputRevision: 42,
        effectiveAccountingAt: new Date(session.effectiveAt), currentSnapshotRevision: null,
        matchedWorkoutId: null, matchStatus: "PENDING", webStartedAt: new Date(session.effectiveAt),
        accountingTimeZone: trainingTimeZone, accountingTimeZoneProvenance: trainingTimeZoneProvenance,
        createdAt: new Date("2025-01-11T12:00:00.000Z"), updatedAt: new Date("2025-01-11T14:30:00.000Z"),
      },
    });
    await prisma.strengthSessionAccountingSnapshot.create({
      data: {
        sessionId, snapshotRevision: session.snapshotRevision,
        accountingInputRevision: session.accountingInputRevision,
        inputFingerprint: session.inputFingerprint, effectiveLocalDate: session.localDate,
        timeZone: trainingTimeZone, timeZoneProvenance: trainingTimeZoneProvenance,
        accountingMethodVersion: "bodycast-load-accounting-v1",
        massResolutionMethodVersion: "bodycast-bodyweight-resolution-v2",
        massResolutionIdentity: payload.massResolutionIdentity,
        payloadVersion: payload.schemaVersion, payload,
        createdAt: new Date("2025-01-11T13:00:00.000Z"),
      },
    });
    const exercise = await prisma.strengthSessionExercise.create({
      data: { sessionId, snapshotExerciseName: "isolated deleted-set evidence", sortOrder: 0,
        plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT" },
    });
    const set = await prisma.strengthSet.create({
      data: { sessionExerciseId: exercise.id, setNumber: 1, reps: 5, weightKg: 30 },
    });
    await prisma.strengthSet.delete({ where: { id: set.id } });

    const group = [
      { sourceKey: String(sessionId), fromDate: "2025-01-11", revision: 2,
        createdAt: new Date("2025-01-11T14:30:00.000Z"), updatedAt: new Date("2025-01-11T15:00:00.000Z") },
      { sourceKey: `training-delete-set:${sessionId}:${set.id}`, fromDate: "2025-01-10", revision: 42,
        createdAt: new Date("2025-01-11T14:00:00.000Z"), updatedAt: new Date("2025-01-11T14:00:00.000Z") },
      { sourceKey: String(deletedSessionId), fromDate: "2025-01-11", revision: 1 },
      { sourceKey: `training-delete-session:${deletedSessionId}`, fromDate: "2025-01-11", revision: 1 },
      { sourceKey: `training-delete-set:${deletedSessionId}:999999`, fromDate: "2025-01-10", revision: 1 },
    ];
    childKeys.push(group[1].sourceKey, group[4].sourceKey);
    for (const block of group) {
      await insertTrainingFence(block);
    }

    const evidence = await readEvidence();
    validatePublicationSourceEvidence({ blocks: evidence.blocks, sourceEvidence: evidence.sourceEvidence });
    validateWithExactImage(evidence, false);
    const deletedSetEvidence = evidence.sourceEvidence.training.find((row) => row.sourceKey === childKeys[0]);
    const deletedSessionRows = evidence.sourceEvidence.training.filter((row) => row.sessionId === deletedSessionId);
    if (deletedSetEvidence?.childRows !== 0 || deletedSetEvidence.accountingRevisionGap !== 1
        || deletedSetEvidence.childDeletionAccountingInputRevision !== 42
        || deletedSetEvidence.fromDate !== "2025-01-10"
        || deletedSetEvidence.sessionUpdateFenceChronologyValid !== false
        || deletedSetEvidence.sourceFenceChronologyValid !== true
        || evidence.sourceEvidence.training.find((row) => row.sourceKey === String(sessionId))
          ?.sessionUpdateFenceChronologyValid !== true
        || deletedSessionRows.length !== 3
        || !deletedSessionRows.some((row) => row.identity === "deleted-session" && row.parentSessionRows === 0)) {
      throw new Error("Exact-image evidence omitted the persisted child-delete or hard-delete Training identity.");
    }

    const malformedGapEvidence = {
      ...evidence.sourceEvidence,
      training: evidence.sourceEvidence.training.map((row) => row.sessionId === sessionId
        ? { ...row, accountingRevisionGap: row.accountingRevisionGap + 1 } : row),
    };
    let rejectedMalformedGap = false;
    try {
      validatePublicationSourceEvidence({ blocks: evidence.blocks, sourceEvidence: malformedGapEvidence });
    } catch { rejectedMalformedGap = true; }
    if (!rejectedMalformedGap) throw new Error("Exact-image validator accepted a forged Training accounting revision gap.");
    validateWithExactImage({ ...evidence, sourceEvidence: malformedGapEvidence }, true);

    await prisma.strengthSessionAccountingSnapshot.update({
      where: { sessionId_snapshotRevision: { sessionId, snapshotRevision: session.snapshotRevision } },
      data: { payloadVersion: "bodycast-persisted-load-accounting-v0" },
    });
    const tamperedPayloadVersionEvidence = await readEvidence();
    let rejectedPayloadVersionMismatch = false;
    try {
      validatePublicationSourceEvidence({ blocks: tamperedPayloadVersionEvidence.blocks,
        sourceEvidence: tamperedPayloadVersionEvidence.sourceEvidence });
    } catch { rejectedPayloadVersionMismatch = true; }
    if (!rejectedPayloadVersionMismatch) {
      throw new Error("Exact-image evidence accepted a historical snapshot whose persisted payloadVersion mismatched its payload.");
    }
    await prisma.strengthSessionAccountingSnapshot.update({
      where: { sessionId_snapshotRevision: { sessionId, snapshotRevision: session.snapshotRevision } },
      data: { payloadVersion: payload.schemaVersion },
    });

    const orphanBlocks = evidence.blocks.filter((block) => block.sourceKey !== `training-delete-session:${deletedSessionId}`);
    const orphanEvidence = { ...evidence.sourceEvidence,
      training: evidence.sourceEvidence.training.filter((row) => row.sourceKey !== `training-delete-session:${deletedSessionId}`) };
    let rejectedOrphan = false;
    try { validatePublicationSourceEvidence({ blocks: orphanBlocks, sourceEvidence: orphanEvidence }); }
    catch { rejectedOrphan = true; }
    if (!rejectedOrphan) throw new Error("Exact-image validator accepted a hard-deleted Training parent without its tombstone.");

    // The first child fence survives a later valid snapshot. A second deletion
    // plus an unrelated accounting revision must not be explained by the total
    // number of child fences; only fence revisions newer than snapshot 91 count.
    const refreshedSnapshot = { ...session, snapshotRevision: 91, accountingInputRevision: 42,
      inputFingerprint: "e".repeat(64) };
    const refreshedPayload = trainingAccountingPayload(refreshedSnapshot);
    await prisma.strengthSessionAccountingSnapshot.create({ data: {
      sessionId, snapshotRevision: 91, accountingInputRevision: 42,
      inputFingerprint: refreshedSnapshot.inputFingerprint, effectiveLocalDate: session.localDate,
      timeZone: trainingTimeZone, timeZoneProvenance: trainingTimeZoneProvenance,
      accountingMethodVersion: "bodycast-load-accounting-v1",
      massResolutionMethodVersion: "bodycast-bodyweight-resolution-v2",
      massResolutionIdentity: refreshedPayload.massResolutionIdentity,
      payloadVersion: refreshedPayload.schemaVersion, payload: refreshedPayload,
      createdAt: new Date("2025-01-11T15:00:00.000Z"),
    } });
    await prisma.strengthDiarySession.update({ where: { id: sessionId }, data: {
      accountingInputRevision: 42, currentSnapshotRevision: 91,
      updatedAt: new Date("2025-01-11T15:00:00.000Z"),
    } });
    const secondSet = await prisma.strengthSet.create({ data: {
      sessionExerciseId: exercise.id, setNumber: 2, reps: 4, weightKg: 20,
    } });
    await prisma.strengthSet.delete({ where: { id: secondSet.id } });
    const secondChildKey = `training-delete-set:${sessionId}:${secondSet.id}`;
    childKeys.push(secondChildKey);
    await prisma.strengthDiarySession.update({ where: { id: sessionId }, data: {
      accountingInputRevision: 43, currentSnapshotRevision: null,
      updatedAt: new Date("2025-01-11T16:00:00.000Z"),
    } });
    await insertTrainingFence({ sourceKey: secondChildKey, fromDate: "2025-01-11", revision: 43,
      createdAt: new Date("2025-01-11T16:00:00.000Z"), updatedAt: new Date("2025-01-11T16:00:00.000Z") });
    await prisma.strengthDiarySession.update({ where: { id: sessionId }, data: {
      accountingInputRevision: 44, updatedAt: new Date("2025-01-11T16:15:00.000Z"),
    } });
    await prisma.$executeRawUnsafe(
      `UPDATE public."UnifiedPublicationBlock" SET revision = revision + 1, "updatedAt" = $1
       WHERE "profileId" = 1 AND source = 'training' AND "sourceKey" = $2`,
      new Date("2025-01-11T16:30:00.000Z"), String(sessionId),
    );
    const compensatedEvidence = await readEvidence();
    let rejectedCompensatedGap = false;
    try {
      validatePublicationSourceEvidence({ blocks: compensatedEvidence.blocks,
        sourceEvidence: compensatedEvidence.sourceEvidence });
    } catch { rejectedCompensatedGap = true; }
    if (!rejectedCompensatedGap) {
      throw new Error("Exact-image validator accepted an old child fence compensating for a post-snapshot accounting mutation.");
    }
    validateWithExactImage(compensatedEvidence, true);
  } finally {
    const fenceKeys = [String(sessionId), String(deletedSessionId), `training-delete-session:${deletedSessionId}`, ...childKeys];
    const fenceKeyParameters = fenceKeys.map((_, index) => `$${index + 1}`).join(", ");
    await prisma.$executeRawUnsafe(
      `DELETE FROM public."UnifiedPublicationBlock" WHERE "profileId" = 1 AND source = 'training'
       AND "sourceKey" IN (${fenceKeyParameters})`,
      ...fenceKeys,
    );
    await prisma.strengthDiarySession.deleteMany({ where: { id: sessionId } });
  }
  if (await legacyUnpagedRawFingerprint() !== baselineFingerprint) {
    throw new Error("Training deletion evidence smoke did not restore its isolated raw-source fixture state.");
  }
}

try {
  const [profiles, priorLedger] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public."Profile"`),
    prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`),
  ]);
  if (profiles[0]?.count !== 0 || priorLedger[0]?.count !== 65) {
    throw new Error("The dedicated disposable database is not an empty-fixture exact 65-migration schema.");
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."Profile" (id, sex, "dateOfBirth", "heightCm", "createdAt", "updatedAt")
     VALUES (1, 'female', DATE '1990-01-01', 170.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."PhysiologyV7Lifecycle" ("profileId", "staleFromDate", "invalidationGeneration",
       "productionStaleFromDate", "productionPublishedGeneration", "unifiedPublishedGeneration",
       "unifiedTargetRevision", "unifiedRolloutEpoch", "unifiedPublishedRolloutEpoch",
       "unifiedPublicationBlockedFromDate", "unifiedPublicationBlockedSource", "stateVersion",
       "sourceNormalizationVersion", "dailyRuntimeVersion", "rangeRebuildVersion", "rebuildServiceVersion",
       "createdAt", "updatedAt")
     VALUES (1, '2025-01-01', 10, '2025-01-10', 9, NULL,
       'unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once', 1, NULL,
       '2025-01-01', 'health', 'fixture', 'fixture', 'fixture', 'fixture', 'fixture', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await insertEpisode("2025-01-01", "UTC", false, new Date("2025-01-10T00:00:00.000Z"));
  await insertEpisode("2025-01-10", "Pacific/Kiritimati", true, null);
  const fixtureEpisodes = await prisma.modelEpisode.findMany({
    where: { profileId: 1, startDate: { in: ["2025-01-01", "2025-01-10"] } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true },
  });
  if (fixtureEpisodes.length !== 2 || fixtureEpisodes[0]?.startDate !== "2025-01-01"
      || fixtureEpisodes[1]?.startDate !== "2025-01-10") {
    throw new Error("The isolated V4 rehearsal did not persist its two expected model episode identities.");
  }
  const firstEpisodeId = fixtureEpisodes[0].id;
  const secondEpisodeId = fixtureEpisodes[1].id;
  for (const date of healthDates) await insertHealthDay(date);
  await insertFingerprintPageBoundarySnapshots("2025-01-01", 70);
  const [pageBoundaryCount] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS count FROM public."HealthSyncSnapshot" WHERE date = $1`, "2025-01-01",
  );
  if (pageBoundaryCount.count <= 32) throw new Error("Fingerprint fixture did not cross a raw-row page boundary.");

  const [trainingDay] = await prisma.$queryRawUnsafe(`SELECT id FROM public."DailyHealthData" WHERE date = $1`, "2025-01-09");
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."Workout" (id, "dailyHealthDataId", "sourceIdentity", type, "startAt", "endAt", "createdAt", "updatedAt")
     VALUES (79, $1, 'fixture:training-session-20', 'Traditional Strength Training',
       $2::timestamptz, $2::timestamptz + INTERVAL '1 hour', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    trainingDay.id, trainingWorkoutStartAt,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."TrainingProgram" (id, "profileId", name, "createdAt", "updatedAt")
     VALUES (1, 1, 'Disposable recovery fixture', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."TrainingProgramVersion" (id, "programId", "versionNumber", "createdAt")
     VALUES (1, 1, 1, CURRENT_TIMESTAMP)`,
  );
  for (const session of trainingSessions) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO public."StrengthDiarySession" (id, "profileId", "programId", "programVersionId", status, "entryMode",
         revision, "accountingInputRevision", "effectiveAccountingAt", "currentSnapshotRevision", "matchedWorkoutId",
         "matchStatus", "webStartedAt", "createdAt", "updatedAt")
       VALUES ($1, 1, 1, 1, 'COMPLETED', $2, $3, $4, $5::timestamptz, NULL, $6, $7, $8::timestamptz,
         CURRENT_TIMESTAMP - INTERVAL '4 seconds', CURRENT_TIMESTAMP - INTERVAL '3 seconds')`,
      session.id, session.entryMode, session.revision, session.accountingInputRevision,
      session.effectiveAt, session.matchedWorkoutId, session.status, session.webStartedAt,
    );
    const payload = trainingAccountingPayload(session);
    await prisma.$executeRawUnsafe(
      `INSERT INTO public."StrengthSessionAccountingSnapshot" ("sessionId", "snapshotRevision", "accountingInputRevision",
         "inputFingerprint", "effectiveLocalDate", "timeZone", "timeZoneProvenance", "accountingMethodVersion",
         "massResolutionMethodVersion", "massResolutionIdentity", "payloadVersion", payload, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'bodycast-load-accounting-v1',
         'bodycast-bodyweight-resolution-v2', $8, 'bodycast-persisted-load-accounting-v1', $9::jsonb,
         CURRENT_TIMESTAMP - INTERVAL '2 seconds')`,
      session.id, session.snapshotRevision, session.accountingInputRevision, session.inputFingerprint,
      session.localDate, trainingTimeZone, trainingTimeZoneProvenance,
      payload.massResolutionIdentity, JSON.stringify(payload),
    );
    await prisma.$executeRawUnsafe(
      `UPDATE public."StrengthDiarySession" SET "currentSnapshotRevision" = $1, "updatedAt" = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $2`,
      session.snapshotRevision, session.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO public."UnifiedPublicationBlock" ("profileId", source, "sourceKey", "fromDate", revision, "createdAt", "updatedAt")
       VALUES (1, 'training', $1, $2, $3, CURRENT_TIMESTAMP - INTERVAL '500 milliseconds', CURRENT_TIMESTAMP)`,
      String(session.id), session.fromDate, session.id === 20 ? 5 : session.revision,
    );
  }

  // A cancelled diary session can leave an old derived transient-water row.
  // V4 replay consumes that former model day to clear derived history, even
  // when it is later than today's persisted Health/Completed-session range.
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."StrengthDiarySession" (id, "profileId", "programId", "programVersionId", status,
       "entryMode", revision, "accountingInputRevision", "createdAt", "updatedAt")
     VALUES (26, 1, 1, 1, 'CANCELLED', 'LIVE', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."ExperimentalTransientExerciseWaterShadow" ("sessionId", "profileId", "sourceFingerprint",
       "modelRevision", features, result, "createdAt", "updatedAt")
     VALUES (26, 1, $1, 'experimental-transient-exercise-water-v2-impulse-ledger', '{}'::jsonb,
       '{"impulse":{"modelDate":"2025-01-15"}}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    "f".repeat(64),
  );
  const [staleTransientBefore] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS count FROM public."ExperimentalTransientExerciseWaterShadow"
     WHERE "sessionId" = 26 AND result #>> '{impulse,modelDate}' = '2025-01-15'`,
  );
  if (staleTransientBefore.count !== 1) throw new Error("The exact-image rehearsal did not seed its intended stale derived transient row.");

  const nineDayEvidence = await validateCurrentEvidence(9);
  const expectedModelDayKeys = [
    ...Array.from({ length: 9 }, (_, index) => `${firstEpisodeId}|2025-01-${String(index + 1).padStart(2, "0")}`),
    `${secondEpisodeId}|2025-01-10`, `${secondEpisodeId}|2025-01-11`,
  ];
  if (nineDayEvidence.sourceModelDayCount !== expectedModelDayKeys.length
    || JSON.stringify(nineDayEvidence.sourceModelDayKeys) !== JSON.stringify(expectedModelDayKeys)) {
    throw new Error("Read-only evidence did not derive the exact V4 model-day boundaries from persisted sources across both episodes.");
  }
  const unpagedFingerprint = await legacyUnpagedRawFingerprint();
  if (nineDayEvidence.sourceFingerprint !== unpagedFingerprint) {
    throw new Error("Paged strict source fingerprint differs from the legacy unpaged byte-for-byte digest.");
  }
  const trainingEvidence = nineDayEvidence.sourceEvidence.training;
  if (!Array.isArray(trainingEvidence) || trainingEvidence.map((row) => row.sessionId).join(",") !== "20,24,25") {
    throw new Error("Exact legacy evidence did not return every Training session in stable numeric order.");
  }
  const matchedEvidence = trainingEvidence.find((row) => row.sessionId === 20);
  if (matchedEvidence?.snapshotRevision !== 79 || matchedEvidence.modelDate !== trainingModelDate
    || matchedEvidence.fromDate !== trainingEarlierFenceDate || matchedEvidence.trainingEventAt !== trainingWorkoutStartAt
    || matchedEvidence.effectiveAccountingAt !== trainingEffectiveAt
    || matchedEvidence.accountingEffectiveLocalDate !== trainingLocalDate
    || matchedEvidence.snapshotEffectiveLocalDate !== trainingLocalDate
    || matchedEvidence.matchedWorkoutTypeSupported !== true
    || !/^[a-f0-9]{64}$/.test(matchedEvidence.matchedWorkoutSourceIdentitySha256)) {
    throw new Error("Matched Training event, Workout provenance and independent accounting snapshot dates were not bound separately.");
  }
  const pendingEvidence = trainingEvidence.find((row) => row.sessionId === 24);
  if (pendingEvidence?.matchStatus !== "PENDING" || pendingEvidence.entryMode !== "LIVE"
    || pendingEvidence.matchedWorkoutId !== null || pendingEvidence.matchedWorkoutPresent !== false
    || pendingEvidence.matchedWorkoutTypeSupported !== false || pendingEvidence.modelDate !== trainingModelDate
    || pendingEvidence.snapshotRevision !== 80) {
    throw new Error("Persisted LIVE/PENDING Training session without a Workout was not accepted as its own source.");
  }
  const retrospectiveUnmatchedEvidence = trainingEvidence.find((row) => row.sessionId === 25);
  if (retrospectiveUnmatchedEvidence?.matchStatus !== "UNMATCHED"
    || retrospectiveUnmatchedEvidence.entryMode !== "RETROSPECTIVE"
    || retrospectiveUnmatchedEvidence.matchedWorkoutId !== null
    || retrospectiveUnmatchedEvidence.matchedWorkoutPresent !== false
    || retrospectiveUnmatchedEvidence.snapshotRevision !== 81) {
    throw new Error("Persisted retrospective-unmatched Training session without a Workout was not accepted.");
  }

  // Repeated blockUnifiedPublication invalidation retains min(existing, new).
  await prisma.$executeRawUnsafe(
    `UPDATE public."UnifiedPublicationBlock" SET "fromDate" = $1 WHERE source = 'training' AND "sourceKey" = '20'`,
    trainingEarlierFenceDate,
  );
  await validateCurrentEvidence(9);
  await prisma.$executeRawUnsafe(
    `UPDATE public."UnifiedPublicationBlock" SET "fromDate" = '2025-01-12' WHERE source = 'training' AND "sourceKey" = '20'`,
  );
  let rejectedFutureTrainingFence = false;
  try {
    await validateCurrentEvidence(9);
  } catch {
    rejectedFutureTrainingFence = true;
  }
  if (!rejectedFutureTrainingFence) throw new Error("A Training fence after the legacy writer event model date was accepted.");
  await prisma.$executeRawUnsafe(
    `UPDATE public."UnifiedPublicationBlock" SET "fromDate" = $1 WHERE source = 'training' AND "sourceKey" = '20'`,
    trainingModelDate,
  );

  // The accounting snapshot date must still be checked against effective time.
  await prisma.$executeRawUnsafe(
    `UPDATE public."StrengthSessionAccountingSnapshot" SET "effectiveLocalDate" = $1 WHERE "sessionId" = 20 AND "snapshotRevision" = 79`,
    trainingModelDate,
  );
  let rejectedSnapshotOnEventDate = false;
  try {
    await validateCurrentEvidence(9);
  } catch {
    rejectedSnapshotOnEventDate = true;
  }
  if (!rejectedSnapshotOnEventDate) throw new Error("Training accounting snapshot validation followed the event date instead of accounting time.");
  await prisma.$executeRawUnsafe(
    `UPDATE public."StrengthSessionAccountingSnapshot" SET "effectiveLocalDate" = $1 WHERE "sessionId" = 20 AND "snapshotRevision" = 79`,
    trainingLocalDate,
  );

  await prisma.$executeRawUnsafe(
    `DELETE FROM public."UnifiedPublicationBlock" WHERE "profileId"=1 AND source='health' AND "sourceKey"='2025-01-09'`,
  );
  await validateCurrentEvidence(8);

  await insertHealthDay("2025-01-10", 2, true);
  await validateCurrentEvidence(9);

  await prisma.$executeRawUnsafe(`UPDATE public."HealthSyncSnapshot" SET timezone='Not/A_Real_Zone' WHERE date='2025-01-10'`);
  let rejectedInvalidTimeZone = false;
  try {
    await validateCurrentEvidence(9);
  } catch {
    rejectedInvalidTimeZone = true;
  }
  if (!rejectedInvalidTimeZone) throw new Error("A Health fence with unsupported snapshot timezone provenance was accepted.");

  await prisma.$executeRawUnsafe(`UPDATE public."HealthSyncSnapshot" SET timezone='UTC' WHERE date='2025-01-10'`);
  await prisma.$executeRawUnsafe(`DELETE FROM public."DailyHealthData" WHERE date='2025-01-10'`);
  let rejectedMissingSource = false;
  try {
    await validateCurrentEvidence(9);
  } catch {
    rejectedMissingSource = true;
  }
  if (!rejectedMissingSource) throw new Error("A Health fence without its persisted source row was accepted.");

  // Rebuild a valid source set, then exercise the exact image's real derived-only
  // entrypoint against the same isolated 65-migration database.
  await prisma.$executeRawUnsafe(
    `DELETE FROM public."UnifiedPublicationBlock" WHERE "profileId" = 1 AND source = 'health' AND "sourceKey" = '2025-01-10'`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM public."HealthMetricSample" WHERE date = '2025-01-10'`);
  await prisma.$executeRawUnsafe(`DELETE FROM public."HealthSyncSnapshot" WHERE date = '2025-01-10'`);
  await insertHealthDay("2025-01-10", 2, true);
  await assertHealthSyncAuditRetentionExcludedFromV4Fingerprint();
  const recoveryPreflight = await validateCurrentEvidence(9);
  const expectedEntryBinding = recoveryEvidenceBinding({ sourceFingerprint: recoveryPreflight.sourceFingerprint,
    healthSyncAuditFingerprint: recoveryPreflight.healthSyncAuditFingerprint,
    blocks: recoveryPreflight.blocks, lifecycle: recoveryPreflight.lifecycle });
  const recoveryRawBefore = await legacyUnpagedRawFingerprint();
  const recoveryAuditBefore = await legacyHealthSyncAuditFingerprint();
  if (recoveryPreflight.sourceFingerprint !== recoveryRawBefore) {
    throw new Error("Exact-image recovery fixture source fingerprint is not bound before execution.");
  }
  const [sourceWorkoutCount, sourceSessionCount, sourceSetCount, ledgerBefore] = await Promise.all([
    prisma.workout.count(), prisma.strengthDiarySession.count(), prisma.strengthSet.count(),
    prisma.$queryRawUnsafe(`SELECT to_jsonb(migration_row)::text AS row FROM public."_prisma_migrations" AS migration_row ORDER BY migration_name`),
  ]);
  const evidenceBefore = await readEvidence();
  const assertExactLedger = (report, rawRows) => {
    const expectedRows = report.expectedMigrationRows;
    const appliedRows = rawRows.map(({ row }) => JSON.parse(row));
    const manifestDigest = createHash("sha256").update(expectedRows.map(({ name, checksum }) => `${name}\t${checksum}\n`).join("")).digest("hex");
    if (report.database?.database !== "bodycast_v4_recovery_test" || !report.database.version.startsWith("17.")
      || !Array.isArray(expectedRows) || expectedRows.length !== 65 || report.expectedLedgerDigest !== manifestDigest
      || appliedRows.length !== 65 || appliedRows.some((row, index) => row.migration_name !== expectedRows[index]?.name
        || row.checksum !== expectedRows[index]?.checksum || row.finished_at === null || row.rolled_back_at !== null)) {
      throw new Error("Exact legacy image evidence does not match the complete applied 65-migration manifest.");
    }
  };
  assertExactLedger(evidenceBefore, ledgerBefore);
  const expectedTrainingIds = recoveryPreflight.blocks.filter((block) => block.source === "training")
    .map((block) => Number(block.sourceKey)).sort((a, b) => a - b);
  if (evidenceBefore.sourceFingerprint !== recoveryRawBefore
    || evidenceBefore.healthSyncAuditFingerprint !== recoveryAuditBefore
    || evidenceBefore.lifecycle?.unifiedRolloutEpoch !== 1
    || JSON.stringify(expectedTrainingIds) !== JSON.stringify([20, 24, 25])
    || evidenceBefore.blocks.length !== recoveryPreflight.blocks.length) {
    throw new Error("Exact legacy image pre-recovery evidence differs from the validated isolated source set.");
  }
  let recoveryOutput;
  try {
    recoveryOutput = execFileSync("docker", ["run", "--rm", "--network", "host", "--env", `DATABASE_URL=${databaseUrl}`,
      "--env", `BODYCAST_V4_EXPECTED_EVIDENCE_BINDING=${JSON.stringify(expectedEntryBinding)}`,
      image, "node", "/app/dist/production-full-history-recalculate.mjs", "--derived-v4-recovery",
      "--owner-authorized", "--profile-id", "1"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("Exact legacy recovery image failed its derived-only execution rehearsal on the isolated fixture.");
  }
  const recoveryResult = JSON.parse(recoveryOutput.trim());
  if (recoveryResult.command !== "unified-v4-derived-recovery" || recoveryResult.current !== true
    || recoveryResult.rolloutEpoch !== 1 || recoveryResult.rawInputFingerprint !== recoveryRawBefore
    || recoveryResult.healthSyncAuditFingerprint !== recoveryAuditBefore
    || recoveryResult.healthDatesRefreshed.join(",") !== recoveryPreflight.blocks.filter((block) => block.source === "health")
      .map((block) => block.sourceKey).sort().join(",")
    || recoveryResult.trainingSessionIdsRefreshed.join(",") !== expectedTrainingIds.join(",")
    || !Number.isSafeInteger(recoveryResult.dayCount) || recoveryResult.dayCount < 1) {
    throw new Error("Exact legacy recovery image returned an incomplete or mismatched derived-only result.");
  }
  const [remainingFences, lifecycleRows, unifiedRows, ledgerAfter, sessionStates, finalWorkoutCount, finalSessionCount, finalSetCount]
    = await Promise.all([
      prisma.unifiedPublicationBlock.count({ where: { profileId: 1 } }),
      prisma.$queryRawUnsafe(`SELECT "unifiedRolloutEpoch", "unifiedPublishedRolloutEpoch", "invalidationGeneration", "productionPublishedGeneration", "unifiedPublishedGeneration" FROM public."PhysiologyV7Lifecycle" WHERE "profileId" = 1`),
      prisma.unifiedExperimentalPhysiologyStateV2.count({ where: { profileId: 1 } }),
      prisma.$queryRawUnsafe(`SELECT to_jsonb(migration_row)::text AS row FROM public."_prisma_migrations" AS migration_row ORDER BY migration_name`),
      prisma.strengthDiarySession.findMany({ where: { profileId: 1 }, orderBy: { id: "asc" },
        select: { id: true, status: true, entryMode: true, matchStatus: true, matchedWorkoutId: true, currentSnapshotRevision: true } }),
      prisma.workout.count(), prisma.strengthDiarySession.count(), prisma.strengthSet.count(),
    ]);
  const lifecycle = lifecycleRows[0];
  const evidenceAfter = await readEvidence();
  const [staleTransientRows] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS count FROM public."ExperimentalTransientExerciseWaterShadow" WHERE "sessionId" = 26`,
  );
  const expectedReplayCoverageKeys = [
    ...Array.from({ length: 9 }, (_, index) => `${firstEpisodeId}|2025-01-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 6 }, (_, index) => `${secondEpisodeId}|2025-01-${String(index + 10).padStart(2, "0")}`),
  ];
  assertExactLedger(evidenceAfter, ledgerAfter);
  if (JSON.stringify(ledgerBefore) !== JSON.stringify(ledgerAfter)) {
    throw new Error("Exact-image recovery changed one or more persisted Prisma migration ledger rows.");
  }
  try {
    assertRecoveryPostflight({
      beforeFingerprint: recoveryRawBefore,
      afterFingerprint: evidenceAfter.sourceFingerprint,
      beforeHealthSyncAuditFingerprint: recoveryAuditBefore,
      afterHealthSyncAuditFingerprint: evidenceAfter.healthSyncAuditFingerprint,
      lifecycle: evidenceAfter.lifecycle,
      blocks: evidenceAfter.blocks.length,
      coveredModelDayCount: evidenceAfter.coveredDayCount,
      expectedModelDayCount: evidenceAfter.sourceModelDayCount,
      coveredModelDayKeys: evidenceAfter.coveredModelDayKeys,
      expectedModelDayKeys: evidenceAfter.sourceModelDayKeys,
      rehearsalCoveredModelDayKeys: expectedReplayCoverageKeys,
      rehearsalCoverageSha256: modelDayKeysDigest(expectedReplayCoverageKeys),
      existingEpoch: evidenceBefore.lifecycle.unifiedRolloutEpoch,
    });
  } catch (error) {
    throw new Error(`Exact-image V4 postflight failed: ${JSON.stringify({
      beforeFingerprint: recoveryRawBefore,
      afterFingerprint: evidenceAfter.sourceFingerprint,
      beforeHealthSyncAuditFingerprint: recoveryAuditBefore,
      afterHealthSyncAuditFingerprint: evidenceAfter.healthSyncAuditFingerprint,
      lifecycle: evidenceAfter.lifecycle,
      blocks: evidenceAfter.blocks.length,
      coveredDayCount: evidenceAfter.coveredDayCount,
      sourceModelDayCount: evidenceAfter.sourceModelDayCount,
      sourceModelDayKeys: evidenceAfter.sourceModelDayKeys,
      coveredModelDayKeys: evidenceAfter.coveredModelDayKeys,
      coveredDayDates: evidenceAfter.coveredDayDates,
      existingEpoch: evidenceBefore.lifecycle.unifiedRolloutEpoch,
    })}`, { cause: error });
  }
  if (remainingFences !== 0 || lifecycleRows.length !== 1 || lifecycle?.unifiedRolloutEpoch !== 1
    || lifecycle.unifiedPublishedRolloutEpoch !== 1 || lifecycle.invalidationGeneration !== lifecycle.productionPublishedGeneration
    || lifecycle.invalidationGeneration !== lifecycle.unifiedPublishedGeneration
    || recoveryResult.dayCount !== evidenceAfter.sourceModelDayCount
    || evidenceAfter.sourceModelDayCount !== 11 || evidenceAfter.coveredDayCount !== expectedReplayCoverageKeys.length
    || JSON.stringify(evidenceAfter.coveredModelDayKeys) !== JSON.stringify(expectedReplayCoverageKeys)
    || evidenceAfter.coveredDayCount !== unifiedRows || staleTransientRows.count !== 0
    || finalWorkoutCount !== sourceWorkoutCount || finalSessionCount !== sourceSessionCount || finalSetCount !== sourceSetCount
    || JSON.stringify(sessionStates.map(({ id, status, entryMode, matchStatus, matchedWorkoutId, currentSnapshotRevision }) =>
      [id, status, entryMode, matchStatus, matchedWorkoutId, currentSnapshotRevision]))
      !== JSON.stringify([[20, "COMPLETED", "RETROSPECTIVE", "MATCHED", 79, 79],
        [24, "COMPLETED", "LIVE", "PENDING", null, 80], [25, "COMPLETED", "RETROSPECTIVE", "UNMATCHED", null, 81],
        [26, "CANCELLED", "LIVE", "PENDING", null, null]])) {
    throw new Error("Exact-image rehearsal did not publish V4 epoch 1 from the unchanged persisted source set.");
  }
  if (await legacyUnpagedRawFingerprint() !== recoveryRawBefore) {
    throw new Error("Exact legacy recovery image changed persisted raw Health, Training, provenance, timestamp, Workout or set data.");
  }

  await validateTrainingDeletionEvidenceOnExactImage();

  process.stdout.write("PASS: exact 65-migration legacy evidence accepted dynamic Health fences and nullable legacy Training accounting fields; validated the Training event date across a timezone/episode boundary independently from its accounting snapshot; retained an earlier repeated-invalidation fence date; rejected future fence dates, accounting-date mismatch, missing Health sources and unsupported snapshot timezones.\n");
  process.stdout.write("PASS: exact legacy image refreshed all 9 persisted Health fences and 3 Training fences (MATCHED, LIVE/PENDING without Workout, RETROSPECTIVE/UNMATCHED), removed the stale session-26 transient shadow, replayed its episode-2 model-day tail through Jan 15, preserved raw fingerprint/workouts/sessions/sets and ledger 65, cleared fences only after success, and published V4 epoch 1/current generations.\n");
  process.stdout.write("PASS: exact-image PostgreSQL evidence producer and validator accepted child-set deletion plus hard-deleted-session numeric/tombstone evidence, rejected forged accounting gaps, payloadVersion mismatches and missing tombstones, and restored the isolated raw-source fingerprint.\n");
} finally {
  await prisma.$disconnect();
}
