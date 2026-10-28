import { createInterface } from "node:readline";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertHealthSyncAuditRetentionTransitionV1 } from "@/modules/health/health-sync-audit-retention-integrity";
import { verifyUnifiedV4ReadyForTraffic } from "@/modules/model-episodes/unified-rollout-v4.service";
import { isUnifiedGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { BODYWEIGHT_RESOLUTION_METHOD_V2 } from "@/modules/training/bodyweight-reference-v2";
import { resolveStrengthEnergyMassReferenceV1, STRENGTH_ENERGY_MASS_RESOLUTION_V1 } from "@/modules/training/session-mass-reference";
import {
  buildMassResolutionIdentity,
  isPersistedLoadAccountingPayloadVersion,
  persistedPayloadFromUnknown,
} from "@/modules/training/persisted-load-accounting-v1";

function profileIdArg(): number {
  const index = process.argv.indexOf("--profile-id");
  const value = index < 0 ? undefined : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value! <= 0) throw new Error("Usage: node unified-v4-traffic-check.mjs --profile-id <positive integer>");
  return value!;
}

const profileId = profileIdArg();
const holdCurrentnessFence = process.argv.includes("--hold-currentness-fence");
const preTrainingMigration = process.argv.includes("--pre-training-migration");
const assertPrismaDatabaseIdentity = process.argv.includes("--assert-prisma-database-identity");
const captureRawInputFingerprint = process.argv.includes("--capture-raw-input-fingerprint");
const waitTrainingRefreshCurrent = process.argv.includes("--wait-training-refresh-current");
const waitTrainingRefreshGenerations = process.argv.includes("--wait-training-refresh-generations");
const ownerAuthorizedActiveEnergyConvergence = process.argv.includes("--owner-authorized-active-energy-convergence");
const expectedRawInputFingerprintIndex = process.argv.indexOf("--expected-raw-input-fingerprint");
const expectedRawInputFingerprint = expectedRawInputFingerprintIndex < 0
  ? null : process.argv[expectedRawInputFingerprintIndex + 1] ?? null;
const expectedHealthSyncAuditRetentionBaselineText = process.env.BODYCAST_EXPECTED_HEALTH_SYNC_AUDIT_RETENTION_BASELINE ?? null;
const expectedHealthSyncAuditPruneEventsText = process.env.BODYCAST_EXPECTED_HEALTH_SYNC_AUDIT_PRUNE_EVENTS ?? null;
function parseJsonEvidence(name: string, value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}
const expectedHealthSyncAuditRetentionBaseline = parseJsonEvidence(
  "Expected HealthSyncAudit retention baseline", expectedHealthSyncAuditRetentionBaselineText,
);
const expectedHealthSyncAuditPruneEvents = parseJsonEvidence(
  "Expected HealthSyncAudit cleanup events", expectedHealthSyncAuditPruneEventsText,
);
const expectedPrismaDatabaseIdentity = process.env.BODYCAST_EXPECTED_PRISMA_DB_IDENTITY ?? null;
if (ownerAuthorizedActiveEnergyConvergence
  && (profileId !== 1 || holdCurrentnessFence || preTrainingMigration || assertPrismaDatabaseIdentity
    || captureRawInputFingerprint || waitTrainingRefreshCurrent || waitTrainingRefreshGenerations || expectedRawInputFingerprint !== null
    || expectedHealthSyncAuditRetentionBaselineText !== null || expectedHealthSyncAuditPruneEventsText !== null
    || !expectedPrismaDatabaseIdentity)) {
  throw new Error("Owner-authorized Active Energy convergence is restricted to a standalone migration-free profile 1 refresh with an exact Prisma database identity.");
}
if (waitTrainingRefreshCurrent && waitTrainingRefreshGenerations) {
  throw new Error("Choose either the strict currentness wait or the generation-only Training/Health wait.");
}
if (captureRawInputFingerprint && (holdCurrentnessFence || preTrainingMigration || profileId !== 1)) {
  throw new Error("Raw-input fingerprint capture is restricted to standalone production profile 1 evidence.");
}
if (assertPrismaDatabaseIdentity
  && (holdCurrentnessFence || captureRawInputFingerprint || waitTrainingRefreshCurrent
    || waitTrainingRefreshGenerations || preTrainingMigration || profileId !== 1)) {
  throw new Error("Prisma database identity assertion is restricted to standalone production profile 1 evidence.");
}
if ((waitTrainingRefreshCurrent || waitTrainingRefreshGenerations)
  && (holdCurrentnessFence || captureRawInputFingerprint || preTrainingMigration || profileId !== 1)) {
  throw new Error("Training refresh generation wait is restricted to standalone production profile 1 evidence.");
}
if (expectedRawInputFingerprintIndex >= 0
  && (!holdCurrentnessFence || !/^[a-f0-9]{64}$/.test(expectedRawInputFingerprint ?? ""))) {
  throw new Error("Expected raw-input fingerprint requires a held currentness fence and a full SHA-256 digest.");
}
if ((expectedHealthSyncAuditRetentionBaselineText !== null || expectedHealthSyncAuditPruneEventsText !== null)
  && (!holdCurrentnessFence || expectedHealthSyncAuditRetentionBaseline === null || expectedHealthSyncAuditPruneEvents === null)) {
  throw new Error("HealthSyncAudit retention evidence requires a held currentness fence and both baseline and cleanup events.");
}
if ((expectedRawInputFingerprintIndex >= 0) !== (expectedHealthSyncAuditRetentionBaselineText !== null)) {
  throw new Error("Migration-free raw integrity requires both the strict source fingerprint and HealthSyncAudit retention baseline.");
}
if ((assertPrismaDatabaseIdentity || captureRawInputFingerprint || waitTrainingRefreshCurrent
  || waitTrainingRefreshGenerations || expectedRawInputFingerprint !== null)
  && !expectedPrismaDatabaseIdentity) {
  throw new Error("Migration-free production checks require the exact Prisma database identity captured from bodycast-db-prod.");
}
if (holdCurrentnessFence && preTrainingMigration) {
  throw new Error("A held serve fence cannot skip the durable Training refresh queue.");
}

async function readPrismaDatabaseIdentity(client: typeof prisma): Promise<string> {
  const rows = await client.$queryRaw<Array<{
    database: string;
    databaseOid: string;
    clusterSystemIdentifier: string;
    role: string;
    serverVersion: string;
    serverAddress: string | null;
    serverPort: number | null;
  }>>`
    SELECT current_database() AS database,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
      (SELECT system_identifier::text FROM pg_control_system()) AS "clusterSystemIdentifier",
      current_user AS role,
      current_setting('server_version') AS "serverVersion",
      host(inet_server_addr()) AS "serverAddress",
      inet_server_port() AS "serverPort" WHERE pg_is_in_recovery() = false
  `;
  const row = rows[0];
  if (rows.length !== 1 || !row || row.database !== "bodycast"
    || !/^[1-9][0-9]*$/.test(row.databaseOid)
    || !/^[1-9][0-9]*$/.test(row.clusterSystemIdentifier)
    || row.role !== "bodycast" || !/^17\./.test(row.serverVersion)
    || !row.serverAddress || !Number.isInteger(row.serverPort)) {
    throw new Error("Migration-free serving is blocked: Prisma did not reach the expected canonical BodyCast PostgreSQL primary.");
  }
  return [row.database, row.databaseOid, row.clusterSystemIdentifier, row.role, row.serverVersion,
    row.serverAddress, row.serverPort].join("|");
}

async function assertPrismaDatabaseIdentityV1(client: typeof prisma) {
  if (!expectedPrismaDatabaseIdentity) throw new Error("The expected Prisma database identity is required.");
  const actual = await readPrismaDatabaseIdentity(client);
  if (actual !== expectedPrismaDatabaseIdentity) {
    throw new Error("Migration-free serving is blocked: the Prisma DATABASE_URL target differs from bodycast-db-prod.");
  }
  return actual;
}

async function assertMigrationFreeEnergyAcceptanceV1(client: typeof prisma) {
  const { evaluateMigrationFreeEnergyAcceptanceV1 } = await import("./production-migration-free-acceptance");
  const [workoutAliases, workouts] = await Promise.all([
    client.activeEnergyEventAlias.findMany({
      where: { profileId, sourceType: { in: ["workout", "strength-session"] } },
      select: {
        sourceType: true,
        sourceId: true,
        workoutId: true,
        workout: { select: { type: true, hiddenFromHistory: true } },
        event: { select: {
          id: true, logicalEventKey: true, eventKind: true, modelDate: true, modelTimeZone: true, supersededByEventId: true, isStale: true,
          currentResolutionFingerprint: true, currentSource: true, currentKcal: true, currentProvenance: true,
          resolutionRevision: true,
          resolutions: {
            orderBy: { revision: "desc" }, take: 1,
            select: { revision: true, resolutionFingerprint: true, source: true, valueKcal: true, provenance: true },
          },
          candidates: {
            where: { availability: "available", valueKcal: { not: null } },
            select: { source: true, sourceIdentity: true, sourceFingerprint: true, availability: true, valueKcal: true, provenance: true },
          },
        } },
      },
    }),
    client.workout.findMany({
      // Health source rows are global in the single-profile schema: Workout
      // and DailyHealthData do not carry profileId. Query all visible raw rows
      // so an unaliased Workout cannot be hidden from the acceptance gate.
      where: { hiddenFromHistory: false },
      select: {
        id: true, sourceIdentity: true, type: true, startAt: true, createdAt: true, hiddenFromHistory: true,
        activeEnergyKcal: true, manualActiveEnergyKcal: true, manualStepCount: true, updatedAt: true,
      },
    }),
  ]);
  const [stepperReconciliationGroups, targetSessions] = await Promise.all([
    client.stepperReconciliationGroup.findMany({
      where: { profileId, status: { in: ["confirmed", "pending"] } },
      select: {
        id: true, status: true,
        candidates: { select: { manualWorkoutId: true, garminWorkoutId: true, candidateStatus: true } },
      },
    }),
    client.strengthDiarySession.findMany({
      where: {
        profileId, status: "COMPLETED",
        OR: [
          { entryMode: "LIVE", webStartedAt: { gte: new Date("2026-10-21T00:00:00.000Z"), lt: new Date("2026-10-24T00:00:00.000Z") } },
          { matchedWorkoutId: { not: null } },
        ],
      },
      select: {
        id: true, status: true, entryMode: true, effectiveAccountingAt: true, webStartedAt: true, webEndedAt: true,
        matchStatus: true, matchedWorkoutId: true, accountingTimeZone: true, accountingInputRevision: true,
        currentSnapshotRevision: true,
        currentAccountingSnapshot: { select: {
          snapshotRevision: true, accountingInputRevision: true, inputFingerprint: true,
          effectiveLocalDate: true, timeZone: true, accountingMethodVersion: true,
          massResolutionMethodVersion: true, massResolutionIdentity: true, payloadVersion: true, payload: true,
        } },
        exercises: { select: { sets: { select: { completedAt: true } } } },
      },
    }),
  ]);
  const [stepperShadows, strengthShadows, weightSamples, dailyWeights, modelEpisodes, stepperLifecycle] = await Promise.all([
    client.experimentalStepperActiveEnergyShadow.findMany({
      where: { profileId, workoutId: { in: workouts.filter((row) =>
        canonicalizeWorkoutType(row.type).classification === "stair-climbing").map((row) => row.id) } },
      select: { workoutId: true, sourceFingerprint: true, modelRevision: true, result: true },
    }),
    client.experimentalStrengthEnergyShadow.findMany({
      where: { profileId, sessionId: { in: targetSessions.map((row) => row.id) } },
      select: { sessionId: true, sourceFingerprint: true, modelRevision: true, result: true },
    }),
    client.healthMetricSample.findMany({
      where: { metric: "weight-kg", source: "apple-health-shortcut" },
      select: { id: true, date: true, timestamp: true, value: true, source: true },
    }),
    client.dailyHealthData.findMany({
      where: { weightKg: { not: null } }, select: { date: true, weightKg: true },
    }),
    client.modelEpisode.findMany({
      where: { profileId },
      select: { id: true, timezone: true, modelVersion: true, startDate: true, latestModeledDate: true,
        initialFilteredWeightKg: true, updatedAt: true, createdAt: true, active: true },
      orderBy: { startDate: "asc" },
    }),
    client.physiologyV7Lifecycle.findUnique({
      where: { profileId },
      select: { invalidationGeneration: true, productionPublishedGeneration: true, productionStaleFromDate: true },
    }),
  ]);
  const stepperModelDates = [...new Set(workoutAliases
    .filter((row) => row.sourceType === "workout" && row.workout !== null
      && canonicalizeWorkoutType(row.workout.type).classification === "stair-climbing")
    .map((row) => row.event.modelDate))];
  const predecessorDates = [...new Set(stepperModelDates.flatMap((date) => {
    const previous = new Date(`${date}T00:00:00.000Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return [previous.toISOString().slice(0, 10)];
  }))];
  const modelStates = modelEpisodes.length === 0 || predecessorDates.length === 0 ? []
    : await client.dailyModelState.findMany({
      where: { episodeId: { in: modelEpisodes.map((episode) => episode.id) }, date: { in: predecessorDates } },
      select: { id: true, episodeId: true, date: true, status: true, endWeightKg: true,
        filteredWeightKg: true, modelVersion: true, createdAt: true },
    });
  const verifiedStrengthSessions = await Promise.all(targetSessions.map(async (session) => {
    const snapshot = session.currentAccountingSnapshot;
    const payload = snapshot && isPersistedLoadAccountingPayloadVersion(snapshot.payloadVersion)
      ? persistedPayloadFromUnknown(snapshot.payload) : null;
    if (!snapshot || !payload || snapshot.snapshotRevision !== session.currentSnapshotRevision
      || snapshot.accountingInputRevision !== session.accountingInputRevision
      || payload.sessionId !== session.id || payload.snapshotRevision !== snapshot.snapshotRevision
      || payload.accountingInputRevision !== session.accountingInputRevision
      || snapshot.inputFingerprint !== payload.inputFingerprint
      || snapshot.effectiveLocalDate !== payload.effectiveLocalDate || snapshot.timeZone !== payload.timeZone
      || payload.effectiveAccountingAt !== session.effectiveAccountingAt?.toISOString()
      || payload.timeZone !== session.accountingTimeZone
      || snapshot.accountingMethodVersion !== payload.accountingMethodVersion
      || snapshot.massResolutionMethodVersion !== payload.massResolutionMethodVersion
      || snapshot.massResolutionIdentity !== payload.massResolutionIdentity
      || payload.massResolutionMethodVersion !== BODYWEIGHT_RESOLUTION_METHOD_V2
      || buildMassResolutionIdentity({
        localDate: payload.effectiveLocalDate,
        timeZone: payload.timeZone,
        methodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
        reference: payload.massReference,
      }) !== payload.massResolutionIdentity) {
      return { ...session, verifiedEnergyMassReference: null };
    }
    const resolved = await resolveStrengthEnergyMassReferenceV1(client, { profileId: profileId,
      stage02Mass: {
        reference: payload.massReference,
        snapshotRevision: payload.snapshotRevision,
        inputFingerprint: payload.inputFingerprint,
        massResolutionIdentity: payload.massResolutionIdentity,
      },
      localDate: payload.effectiveLocalDate,
      timeZone: payload.timeZone,
    });
    return {
      ...session,
      verifiedEnergyMassReference: resolved === null ? null : {
        stage02MassReference: payload.massReference,
        stage02SnapshotRevision: payload.snapshotRevision,
        energyMassReference: resolved.reference,
        energyMassResolutionIdentity: resolved.massResolutionIdentity,
        energyMassResolutionMethodVersion: resolved.massResolutionIdentity !== payload.massResolutionIdentity
          ? STRENGTH_ENERGY_MASS_RESOLUTION_V1 : null,
      },
    };
  }));
  return evaluateMigrationFreeEnergyAcceptanceV1({
    workoutAliases, workouts, stepperReconciliationGroups, strengthSessions: verifiedStrengthSessions,
    stepperShadows, strengthShadows,
    massObservations: [
      ...weightSamples.map((row) => ({ sourceType: "health-metric-sample" as const, sourceId: String(row.id),
        valueKg: row.value.toNumber(), timestamp: row.timestamp, date: row.date })),
      ...dailyWeights.flatMap((row) => row.weightKg === null ? [] : [{ sourceType: "daily-health-data" as const,
        sourceId: row.date, valueKg: row.weightKg, timestamp: null, date: row.date }]),
    ],
    modelEpisodes,
    modelStates,
    stepperLifecycle,
  });
}

async function waitForRouteCommit(timeoutMs: number): Promise<string> {
  const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      new Promise<string>((resolve, reject) => {
        readline.once("line", resolve);
        readline.once("close", () => reject(new Error("SSH route did not acknowledge the fenced publication.")));
      }),
      new Promise<string>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("SSH route acknowledgment exceeded the bounded currentness fence.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    readline.close();
  }
}

const verify = async () => {
  if (ownerAuthorizedActiveEnergyConvergence) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await assertPrismaDatabaseIdentityV1(tx as unknown as typeof prisma);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 15_000 });
    const { recalculateModelEpisode } = await import("@/modules/model-episodes/model-episode.service");
    const recalculation = await recalculateModelEpisode({ profileId: profileId, requireDependentStages: true });
    const { rebuildUnifiedExperimentalPhysiologyStateV1 } = await import("@/modules/model-episodes/unified-experimental-physiology-state.service");
    await rebuildUnifiedExperimentalPhysiologyStateV1({
      profileId: 1,
      fromDate: recalculation.effectiveReplayFromDate,
      targetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
    });
    process.stdout.write("BODYCAST_ACTIVE_ENERGY_CONVERGENCE_COMPLETE\n");
    return;
  }
  if (assertPrismaDatabaseIdentity) {
    const identity = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return assertPrismaDatabaseIdentityV1(tx as unknown as typeof prisma);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 15_000 });
    process.stdout.write(`BODYCAST_PRISMA_DB_IDENTITY=${identity}\n`);
    return;
  }
  if (waitTrainingRefreshCurrent || waitTrainingRefreshGenerations) {
    await assertPrismaDatabaseIdentityV1(prisma);
    const startedAt = Date.now();
    const timeoutMs = 20 * 60_000;
    let lastObservedState = "";
    let lastOutputAt = startedAt;
    while (Date.now() - startedAt < timeoutMs) {
      const job = await prisma.trainingRefreshJob.findUnique({
        where: { profileId },
        select: {
          requestedGeneration: true,
          completedGeneration: true,
          attemptCount: true,
          lastErrorType: true,
          lastProgressStage: true,
        },
      });
      if (!job) throw new Error("Training refresh convergence is blocked because its durable queue row is missing.");
      const health = await prisma.healthSyncRefreshJob.findUnique({
        where: { profileId },
        select: { requestedGeneration: true, completedGeneration: true, attemptCount: true, lastErrorType: true },
      });
      const lifecycle = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } });
      const unifiedCurrent = isUnifiedGenerationCurrentV1(lifecycle)
        && lifecycle.unifiedPublishedRolloutEpoch === lifecycle.unifiedRolloutEpoch;
      const state = JSON.stringify({ ...job, health, unifiedCurrent });
      if (state !== lastObservedState) {
        process.stdout.write(`BODYCAST_TRAINING_REFRESH_PROGRESS ${state}\n`);
        lastObservedState = state;
        lastOutputAt = Date.now();
      }
      const generationsCurrent = job.requestedGeneration === job.completedGeneration
        && (health === null || health.requestedGeneration === health.completedGeneration);
      if (generationsCurrent && (!waitTrainingRefreshCurrent || unifiedCurrent)) {
        process.stdout.write(`${waitTrainingRefreshCurrent ? "BODYCAST_TRAINING_REFRESH_CURRENT" : "BODYCAST_TRAINING_REFRESH_GENERATIONS_CURRENT"} ${state}\n`);
        return;
      }
      if (Date.now() - lastOutputAt >= 30_000) {
        process.stdout.write(`BODYCAST_TRAINING_REFRESH_WAITING ${state}\n`);
        lastOutputAt = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw new Error(waitTrainingRefreshCurrent
      ? "Timed out waiting for standard Health/Training refresh and Unified currentness; no queue or source rows were changed."
      : "Timed out waiting for standard Health/Training refresh generations; no queue or source rows were changed.");
  }
  if (captureRawInputFingerprint) {
    const { inventoryV4RecoveryRawSourcesV1 } = await import("./production-v4-recovery-evidence");
    const evidence = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await assertPrismaDatabaseIdentityV1(tx as unknown as typeof prisma);
      const [captureTime] = await tx.$queryRaw<Array<{ capturedAt: Date }>>`
        SELECT transaction_timestamp() AS "capturedAt"
      `;
      if (!(captureTime?.capturedAt instanceof Date) || !Number.isFinite(captureTime.capturedAt.getTime())) {
        throw new Error("HealthSyncAudit retention baseline timestamp is unavailable.");
      }
      const client = tx as unknown as typeof prisma;
      return inventoryV4RecoveryRawSourcesV1(client, {
        healthSyncAuditBaselineCapturedAt: captureTime.capturedAt,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 240_000 });
    process.stdout.write(`BODYCAST_RAW_SOURCE_FINGERPRINT=${evidence.sourceFingerprint}\n`);
    process.stdout.write(`BODYCAST_HEALTH_SYNC_AUDIT_FINGERPRINT=${evidence.healthSyncAuditFingerprint}\n`);
    if (!evidence.healthSyncAuditRetentionBaseline) throw new Error("Read-only HealthSyncAudit retention baseline is unavailable.");
    process.stdout.write(`BODYCAST_HEALTH_SYNC_AUDIT_RETENTION_BASELINE=${JSON.stringify(evidence.healthSyncAuditRetentionBaseline)}\n`);
    return;
  }
  if (!holdCurrentnessFence) {
    if (preTrainingMigration && profileId !== 1) {
      throw new Error("Pre-Training-migration readiness is restricted to production profile 1.");
    }
    const result = await verifyUnifiedV4ReadyForTraffic({
      profileId,
      checkTrainingRefreshQueue: !preTrainingMigration,
    });
    process.stdout.write(JSON.stringify({ command: "unified-v4-traffic-check", ...result, ready: true }) + "\n");
    return;
  }
  if (profileId !== 1) throw new Error("The held production currentness fence is restricted to profile 1.");
  const fenceStartedAt = Date.now();
  const transactionTimeoutMs = 300_000;
  const routeSafetyMarginMs = 5_000;
  const minimumRouteBudgetMs = 120_000;
  // READ COMMITTED is deliberate: after profile-lock acquisition, readiness
  // checks must observe any publication that committed while the lock waited.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    if (expectedRawInputFingerprint !== null) await assertPrismaDatabaseIdentityV1(tx as unknown as typeof prisma);
    const readiness = await verifyUnifiedV4ReadyForTraffic({ profileId, client: tx });
    // The existing readiness helper treats an absent queue row as no pending
    // work. This release gate requires the durable row and exact generation equality.
    const trainingRefresh = await tx.trainingRefreshJob.findUnique({
      where: { profileId },
      select: { requestedGeneration: true, completedGeneration: true },
    });
    if (!trainingRefresh || trainingRefresh.requestedGeneration !== trainingRefresh.completedGeneration) {
      throw new Error("Training serving is blocked until requestedGeneration equals completedGeneration.");
    }
    const p1EnergyAcceptance = expectedRawInputFingerprint === null
      ? null : await assertMigrationFreeEnergyAcceptanceV1(tx as unknown as typeof prisma);
    if (p1EnergyAcceptance !== null) {
      process.stdout.write(`BODYCAST_STEPPER_DIAGNOSTIC_WORKOUT_ID ${p1EnergyAcceptance.diagnosticWorkoutId}\n`);
      process.stdout.write(`BODYCAST_TARGET_STRENGTH_SESSION_ID ${p1EnergyAcceptance.targetStrengthSessionId}\n`);
    }
    let rawSourceFingerprint: string | null = null;
    let healthSyncAuditFingerprint: string | null = null;
    if (expectedRawInputFingerprint !== null) {
      const { inventoryV4RecoveryRawSourcesV1 } = await import("./production-v4-recovery-evidence");
      const baseline = expectedHealthSyncAuditRetentionBaseline as { maxId?: number } | null;
      if (!Number.isSafeInteger(baseline?.maxId) || baseline!.maxId! < 0) {
        throw new Error("HealthSyncAudit retention baseline maximum id is malformed.");
      }
      const rawEvidence = await inventoryV4RecoveryRawSourcesV1(tx as unknown as typeof prisma, {
        healthSyncAuditBaselineMaxId: baseline!.maxId!,
      });
      rawSourceFingerprint = rawEvidence.sourceFingerprint;
      healthSyncAuditFingerprint = rawEvidence.healthSyncAuditFingerprint;
      if (rawSourceFingerprint !== expectedRawInputFingerprint) {
        throw new Error("Training serving is blocked because Health/Training raw-input integrity differs from the pre-deploy baseline.");
      }
      if (!rawEvidence.healthSyncAuditRetentionCurrentState) {
        throw new Error("HealthSyncAudit retention post-deploy state is unavailable.");
      }
      assertHealthSyncAuditRetentionTransitionV1({
        baseline: expectedHealthSyncAuditRetentionBaseline,
        current: rawEvidence.healthSyncAuditRetentionCurrentState,
        pruneEvents: expectedHealthSyncAuditPruneEvents,
      });
    }
    const routeBudgetMs = transactionTimeoutMs - (Date.now() - fenceStartedAt) - routeSafetyMarginMs;
    if (routeBudgetMs < minimumRouteBudgetMs) {
      throw new Error("Unified V4 verification left too little transaction time for a bounded SSH route commit.");
    }
    process.stdout.write(`BODYCAST_UNIFIED_V4_FENCE_READY ${routeBudgetMs}\n`);
    const decision = await waitForRouteCommit(routeBudgetMs);
    if (decision !== "route-committed") throw new Error("SSH route did not commit while Unified V4 currentness was fenced.");
    const loggedP1EnergyAcceptance = p1EnergyAcceptance === null ? null : {
      historicalWorkoutResolutions: p1EnergyAcceptance.historicalWorkoutResolutions,
      currentWorkoutResolutions: p1EnergyAcceptance.currentWorkoutResolutions,
      historicalStepperResolutions: p1EnergyAcceptance.historicalStepperResolutions,
      currentStepperResolutions: p1EnergyAcceptance.currentStepperResolutions,
      strengthSessionCurrent: p1EnergyAcceptance.strengthSessionCurrent,
    };
    return { ...readiness, trainingRefresh, rawSourceFingerprint, healthSyncAuditFingerprint,
      p1EnergyAcceptance: loggedP1EnergyAcceptance };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: transactionTimeoutMs });
  process.stdout.write("BODYCAST_UNIFIED_V4_FENCE_COMMITTED " + JSON.stringify(result) + "\n");
};

verify()
  .catch((error: unknown) => {
    process.stderr.write("Forecast V2 serving blocked: " + (error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
