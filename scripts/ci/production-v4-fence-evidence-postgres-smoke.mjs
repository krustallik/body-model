import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { publicationBlockDigest, validatePublicationSourceEvidence } from "../production-v4-derived-recovery.mjs";

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
const trainingEffectiveAt = "2025-01-09T12:00:00.000Z";
const trainingLocalDate = "2025-01-09";
const trainingTimeZone = "Europe/Bratislava";
const trainingTimeZoneProvenance = "legacy-default";
const trainingInputFingerprint = "a".repeat(64);

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

function trainingAccountingPayload() {
  const massReference = { status: "unavailable", valueKg: null, localDate: trainingLocalDate, source: null, sourceId: null };
  const accountingMethodVersion = "bodycast-load-accounting-v1";
  const massResolutionMethodVersion = "bodycast-bodyweight-resolution-v2";
  const massResolutionIdentity = createHash("sha256").update(canonicalJson({
    localDate: trainingLocalDate, timeZone: trainingTimeZone,
    methodVersion: massResolutionMethodVersion, reference: massReference,
  })).digest("hex");
  return {
    schemaVersion: "bodycast-persisted-load-accounting-v1",
    sessionId: 20,
    snapshotRevision: 79,
    accountingInputRevision: 22,
    effectiveAccountingAt: trainingEffectiveAt,
    effectiveLocalDate: trainingLocalDate,
    timeZone: trainingTimeZone,
    timeZoneProvenance: trainingTimeZoneProvenance,
    inputFingerprint: trainingInputFingerprint,
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

async function readEvidence() {
  let output;
  try {
    output = execFileSync("docker", ["run", "--rm", "--network", "host", "--env", `DATABASE_URL=${databaseUrl}`,
      image, "node", "/app/dist/production-v4-recovery-evidence.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("Exact legacy recovery image could not read the isolated 65-migration fixture database.");
  }
  return JSON.parse(output.trim());
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
  for (const date of healthDates) await insertHealthDay(date);

  const [trainingDay] = await prisma.$queryRawUnsafe(`SELECT id FROM public."DailyHealthData" WHERE date = $1`, "2025-01-09");
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."Workout" (id, "dailyHealthDataId", "sourceIdentity", type, "startAt", "endAt", "createdAt", "updatedAt")
     VALUES (79, $1, 'fixture:training-session-20', 'Traditional Strength Training',
       TIMESTAMP WITH TIME ZONE '2025-01-09 12:00:00+00', TIMESTAMP WITH TIME ZONE '2025-01-09 13:00:00+00', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    trainingDay.id,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."TrainingProgram" (id, "profileId", name, "createdAt", "updatedAt")
     VALUES (1, 1, 'Disposable recovery fixture', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."TrainingProgramVersion" (id, "programId", "versionNumber", "createdAt")
     VALUES (1, 1, 1, CURRENT_TIMESTAMP)`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."StrengthDiarySession" (id, "profileId", "programId", "programVersionId", status, revision, "accountingInputRevision",
       "effectiveAccountingAt", "currentSnapshotRevision", "matchedWorkoutId", "matchStatus", "createdAt", "updatedAt")
     VALUES (20, 1, 1, 1, 'COMPLETED', 24, 22, TIMESTAMP WITH TIME ZONE '2025-01-09 12:00:00+00', NULL, 79, 'MATCHED', CURRENT_TIMESTAMP - INTERVAL '2 seconds', CURRENT_TIMESTAMP - INTERVAL '1 second')`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."StrengthSessionAccountingSnapshot" ("sessionId", "snapshotRevision", "accountingInputRevision",
       "inputFingerprint", "effectiveLocalDate", "timeZone", "timeZoneProvenance", "accountingMethodVersion",
       "massResolutionMethodVersion", "massResolutionIdentity", "payloadVersion", payload, "createdAt")
     VALUES (20, 79, 22, $1, $2, $3, $4, 'bodycast-load-accounting-v1',
       'bodycast-bodyweight-resolution-v2', $5, 'bodycast-persisted-load-accounting-v1', $6::jsonb,
       CURRENT_TIMESTAMP - INTERVAL '2 seconds')`,
    trainingInputFingerprint,
    trainingLocalDate,
    trainingTimeZone,
    trainingTimeZoneProvenance,
    trainingAccountingPayload().massResolutionIdentity,
    JSON.stringify(trainingAccountingPayload()),
  );
  await prisma.$executeRawUnsafe(`UPDATE public."StrengthDiarySession" SET "currentSnapshotRevision" = 79 WHERE id = 20`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."UnifiedPublicationBlock" ("profileId", source, "sourceKey", "fromDate", revision, "createdAt", "updatedAt")
     VALUES (1, 'training', '20', '2025-01-09', 5, CURRENT_TIMESTAMP - INTERVAL '5 seconds', CURRENT_TIMESTAMP)`,
  );

  const nineDayEvidence = await validateCurrentEvidence(9);
  if (nineDayEvidence.sourceEvidence.training?.snapshotRevision !== 79) {
    throw new Error("Training source evidence did not bind session 20 to its current accounting snapshot.");
  }

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

  process.stdout.write("PASS: exact 65-migration legacy evidence accepted 8, 9 and an additional Health date with both source/fence write orders; accepted nullable legacy Training accounting fields; rejected missing Health sources and unsupported snapshot timezones.\n");
} finally {
  await prisma.$disconnect();
}
