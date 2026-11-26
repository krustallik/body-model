import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AUTH_MULTIUSER_CONTENT_BOUND_PATHS,
  AUTH_MULTIUSER_MIGRATION_CI_RUN_ID,
  AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
  AUTH_MULTIUSER_MIGRATION_WORKFLOW_RUN_ID,
  AUTH_MULTIUSER_MIGRATION_ACTOR_ID,
  SCHEMA_DEPLOY_HANDOFF_PROVENANCE, SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA,
  V4_REPUBLICATION_HANDOFF_PROVENANCE, V4_REPUBLICATION_MIGRATION_ORIGIN_SHA,
  applyAuthSchemaReattestation, applySchemaDeployHandoff, buildAuthSchemaReattestation,
  evaluateSchemaDeployHandoff, parseSchemaDeployMarker, validateHistoricalAuthMigrationRuns,
  readGitCompatibility, renderSchemaDeployTransition,
  validateAuthMarkerForTrainingMigrationHandoff,
  validateTrainingCaptureMarkerWitness,
  validateSchemaDeployHandoffMarker,
} from "../scripts/production-schema-deploy-handoff.mjs";
import {
  DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST,
  AUTH_MULTIUSER_MANIFEST,
  TRAINING_MUTATION_LEDGER_MANIFEST,
  TRAINING_SESSION_CONTEXT_MANIFEST,
} from "../scripts/production-migration-manifests.mjs";
import { ALL_REVIEWED_OBJECTS } from "../scripts/production-migration-preflight.mjs";

const DEPLOY_SHA = "71c091cd712cd3862d2cebe2714963917c9b5ca2";
const V4_MIGRATION_SHA = V4_REPUBLICATION_MIGRATION_ORIGIN_SHA;
const SCHEMA_COMPATIBLE_CHECKOUT_SHA = "9c7a6c9ac9270da52e6e2f5afe55094106f66e2d";
const V4_COMPATIBLE_TEST_CANDIDATE_SHA = "f910d2a45dfa676fada5fab42c9e8946c97872b1";
const DYNAMIC_WORKOUT_MIGRATION_ORIGIN_SHA = "263a4a9215db1963d07143f9c17b2f6936775a67";
const TRAINING_MIGRATION_SHA = "73f0e49aa2fbb4595f7acfc00d16f76bfa2e2da1";
const AUTH_MULTIUSER_MIGRATION_APP_SHA = "18e67d53856af1f4742bbe9626abbd005b70e8bf";
const AUTH_PREVIOUS_DEPLOY_SHA = "c616eba0f874c8c481cb889fade149b68f9ba590";
const REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA = "28479c9dc928d3efb3b7339cb0aa535330313e2d";
const provenance = SCHEMA_DEPLOY_HANDOFF_PROVENANCE;
const directories = [];

function allowedDeployBlobs(binding) {
  return Array.isArray(binding?.deployBlob) ? binding.deployBlob : [binding?.deployBlob];
}

function candidateDeployBlob(filePath, sourceSha = "HEAD") {
  return execFileSync("git", ["rev-parse", `${sourceSha}:${filePath}`], { encoding: "utf8" }).trim();
}

function ensureHandoffHistory() {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA, DEPLOY_SHA], { stdio: "ignore" });
  } catch {
    execFileSync("git", ["fetch", "--no-tags", "--depth=2", "origin", DEPLOY_SHA], { stdio: "ignore" });
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${DYNAMIC_WORKOUT_MIGRATION_ORIGIN_SHA}^{commit}`], { stdio: "ignore" });
  } catch {
    execFileSync("git", ["fetch", "--no-tags", "--depth=2", "origin", DYNAMIC_WORKOUT_MIGRATION_ORIGIN_SHA], { stdio: "ignore" });
  }
}

function v4TestCandidateSha() {
  // Keep positive V4 handoff cases pinned to a known compatible descendant.
  // origin/main may later include schema migrations that this V4 handoff must reject.
  return V4_COMPATIBLE_TEST_CANDIDATE_SHA;
}

function markerText(overrides = {}) {
  const marker = {
    releaseSha: SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA,
    state: "schema-applied",
    ...provenance,
    ...overrides,
  };
  return [
    "schemaVersion=2",
    `manifestId=${marker.manifestId}`,
    `releaseSha=${marker.releaseSha}`,
    `state=${marker.state}`,
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    `spawnState=${marker.spawnState}`,
    "",
  ].join("\n");
}

function v4MigrationMarkerText(overrides = {}) {
  const marker = {
    ...V4_REPUBLICATION_HANDOFF_PROVENANCE,
    releaseSha: V4_MIGRATION_SHA,
    state: "schema-applied",
    ...overrides,
  };
  return [
    "schemaVersion=2",
    `manifestId=${marker.manifestId}`,
    `releaseSha=${marker.releaseSha}`,
    `state=${marker.state}`,
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    `spawnState=${marker.spawnState}`,
    "",
  ].join("\n");
}

function v4AppReadyMarkerText(overrides = {}) {
  return markerText({
    ...V4_REPUBLICATION_HANDOFF_PROVENANCE,
    releaseSha: V4_REPUBLICATION_MIGRATION_ORIGIN_SHA,
    manifestId: "unified-v4-republication-v1",
    state: "app-ready",
    ...overrides,
  });
}

function authPostflightReport() {
  const migrationDirectories = [...AUTH_MULTIUSER_MANIFEST.requiredAppliedMigrations, ...AUTH_MULTIUSER_MANIFEST.migrations]
    .map(({ name }) => name).sort();
  const migrations = [...AUTH_MULTIUSER_MANIFEST.requiredAppliedMigrations, ...AUTH_MULTIUSER_MANIFEST.migrations]
    .map((migration) => ({ name: migration.name, checksum: migration.sha256, startedAt: "2026-11-01T00:00:00.000Z",
      finishedAt: "2026-11-01T00:00:01.000Z", rolledBackAt: null, hasLogs: false, logsFingerprint: "d41d8cd98f00b204e9800998ecf8427e" }));
  const absent = new Set(AUTH_MULTIUSER_MANIFEST.postflightAbsentObjects);
  const signature = (name) => AUTH_MULTIUSER_MANIFEST.postflightSignatureEquals[name]
    ?? AUTH_MULTIUSER_MANIFEST.postflightSignatureIncludes[name]
    ?? "reviewed-test-signature";
  const objects = ALL_REVIEWED_OBJECTS.map((name) => ({
    name,
    present: !absent.has(name),
    kind: absent.has(name) ? "missing" : "constraint",
    signature: absent.has(name) ? null : signature(name),
  }));
  return {
    identity: { database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7419276301947620311",
      role: "bodycast", serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432 },
    logicalDataFingerprint: "d".repeat(64), migrations, objects,
    migrationDirectories,
  };
}

function dynamicWorkoutMarkerText(releaseSha, overrides = {}) {
  const marker = {
    manifestId: DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id,
    releaseSha,
    state: "app-ready",
    workflowRunId: "40123456789",
    workflowRunAttempt: 2,
    authorizationId: "dynamic-release-authorization-01",
    lineageDigest: "a".repeat(64),
    spawnState: "started",
    ...overrides,
  };
  return [
    "schemaVersion=2",
    `manifestId=${marker.manifestId}`,
    `releaseSha=${marker.releaseSha}`,
    `state=${marker.state}`,
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    `spawnState=${marker.spawnState}`,
    "",
  ].join("\n");
}

function trainingMutationMarkerText(overrides = {}) {
  const marker = {
    manifestId: TRAINING_MUTATION_LEDGER_MANIFEST.id,
    releaseSha: TRAINING_MIGRATION_SHA,
    state: "schema-applied",
    workflowRunId: "40123456790",
    workflowRunAttempt: 1,
    authorizationId: "training-migration-authorization-01",
    lineageDigest: "b".repeat(64),
    spawnState: "started",
    ...overrides,
  };
  return [
    "schemaVersion=2",
    `manifestId=${marker.manifestId}`,
    `releaseSha=${marker.releaseSha}`,
    `state=${marker.state}`,
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    `spawnState=${marker.spawnState}`,
    "",
  ].join("\n");
}

function trainingSessionContextMarkerText(overrides = {}) {
  const marker = {
    manifestId: TRAINING_SESSION_CONTEXT_MANIFEST.id,
    releaseSha: TRAINING_MIGRATION_SHA,
    state: "schema-applied",
    workflowRunId: "40123456792",
    workflowRunAttempt: 1,
    authorizationId: "training-context-authorization",
    lineageDigest: "d".repeat(64),
    spawnState: "started",
    ...overrides,
  };
  return [
    "schemaVersion=2",
    `manifestId=${marker.manifestId}`,
    `releaseSha=${marker.releaseSha}`,
    `state=${marker.state}`,
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    `spawnState=${marker.spawnState}`,
    "",
  ].join("\n");
}

function authMultiuserMarkerText(overrides = {}) {
  const marker = {
    manifestId: AUTH_MULTIUSER_MANIFEST.id,
    releaseSha: AUTH_MULTIUSER_MIGRATION_APP_SHA,
    state: "app-ready",
    workflowRunId: "40123456791",
    workflowRunAttempt: 1,
    authorizationId: "auth-multiuser-migration-auth",
    lineageDigest: "c".repeat(64),
    spawnState: "started",
    ...overrides,
  };
  return [
    "schemaVersion=2",
    `manifestId=${marker.manifestId}`,
    `releaseSha=${marker.releaseSha}`,
    `state=${marker.state}`,
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    `spawnState=${marker.spawnState}`,
    "",
  ].join("\n");
}

async function createDynamicWorkoutHandoffRepository() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-dynamic-handoff-"));
  directories.push(directory);
  const repository = path.join(directory, "repo");
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--shared", process.cwd(), repository]);
  // Use the exact commit whose migration tree is admitted by this manifest.
  // The test runner's HEAD may include later, unrelated migration releases.
  execFileSync("git", ["-C", repository, "checkout", "--quiet", "--detach", DYNAMIC_WORKOUT_MIGRATION_ORIGIN_SHA]);
  const originSha = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await writeFile(path.join(repository, "tests", "dynamic-release-compatibility.txt"), "non-runtime test evidence\n");
  execFileSync("git", ["-C", repository, "add", "tests/dynamic-release-compatibility.txt"]);
  execFileSync("git", ["-C", repository, "-c", "user.name=BodyCast tests", "-c", "user.email=test@example.invalid",
    "commit", "--quiet", "-m", "compatible follow-up"]);
  const candidateSha = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { repository, originSha, candidateSha };
}

async function createTrainingMutationHandoffRepository({ file, contents }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-training-handoff-"));
  directories.push(directory);
  const repository = path.join(directory, "repo");
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--shared", process.cwd(), repository]);
  execFileSync("git", ["-C", repository, "checkout", "--quiet", "--detach", TRAINING_MIGRATION_SHA]);
  await writeFile(path.join(repository, file), contents);
  execFileSync("git", ["-C", repository, "add", file]);
  execFileSync("git", ["-C", repository, "-c", "user.name=BodyCast tests", "-c", "user.email=test@example.invalid",
    "commit", "--quiet", "-m", "training handoff compatibility fixture"]);
  const candidateSha = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { repository, candidateSha };
}

const compatible = {
  changedPaths: [".github/workflows/deploy-production.yml", "tests/deploy-script-ordering.test.ts"],
  isAncestor: true,
  criticalObjects: {
    prisma: "a".repeat(40),
    "docker-compose.prod.yml": "b".repeat(40),
    "package.json": "c".repeat(40),
    "package-lock.json": "d".repeat(40),
  },
};

beforeAll(() => {
  ensureHandoffHistory();
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("schema deploy compatibility handoff", () => {
  it("requires the exact historical owner migration and its successful exact-SHA CI", () => {
    const migrationRun = {
      id: Number(AUTH_MULTIUSER_MIGRATION_WORKFLOW_RUN_ID), path: ".github/workflows/production-migrate.yml",
      event: "workflow_dispatch", status: "completed", conclusion: "success", head_sha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
      head_branch: "main", run_attempt: 1, actor: { id: Number(AUTH_MULTIUSER_MIGRATION_ACTOR_ID) },
      repository: { full_name: "krustallik/body-model" },
    };
    const ciRun = {
      id: Number(AUTH_MULTIUSER_MIGRATION_CI_RUN_ID), path: ".github/workflows/ci.yml",
      event: "push", status: "completed", conclusion: "success", head_sha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
      head_branch: "main", run_attempt: 1, actor: { id: Number(AUTH_MULTIUSER_MIGRATION_ACTOR_ID) },
      repository: { full_name: "krustallik/body-model" },
    };
    expect(validateHistoricalAuthMigrationRuns(migrationRun, ciRun)).toBe(true);
    expect(() => validateHistoricalAuthMigrationRuns({ ...migrationRun, conclusion: "failure" }, ciRun)).toThrow(/historical owner-authorized Auth migration/);
    expect(() => validateHistoricalAuthMigrationRuns(migrationRun, { ...ciRun, head_sha: "f".repeat(40) })).toThrow(/historical owner-authorized Auth migration/);
  });

  it("creates an Auth marker only from the full read-only schema and migration evidence", () => {
    const report = authPostflightReport();
    const plan = buildAuthSchemaReattestation({
      report,
      deploySha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
      repo: process.cwd(),
      workflowRunId: "40123456789",
      workflowRunAttempt: 1,
      authorizationId: "a".repeat(64),
    });
    expect(plan.marker).toMatchObject({
      manifestId: AUTH_MULTIUSER_MANIFEST.id,
      migrationOriginSha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
      deploySha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
      state: "schema-applied",
      workflowRunId: "40123456789",
      workflowRunAttempt: 1,
      authorizationId: "a".repeat(64),
    });
    expect(plan.schemaInventoryDigest).toMatch(/^[a-f0-9]{64}$/);

    const incomplete = structuredClone(report);
    incomplete.objects.find(({ name }) => name === "User_email_key").present = false;
    incomplete.objects.find(({ name }) => name === "User_email_key").signature = null;
    expect(() => buildAuthSchemaReattestation({
      report: incomplete,
      deploySha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
      repo: process.cwd(),
      workflowRunId: "40123456789",
      workflowRunAttempt: 1,
      authorizationId: "a".repeat(64),
    })).toThrow(/schema report failed the Auth postflight contract/);
  }, 30_000);

  it.skipIf(process.platform === "win32")("atomically creates the absent Auth marker and refuses overwrite", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-auth-schema-reattest-"));
    directories.push(directory);
    const reportPath = path.join(directory, "report.json");
    const markerPath = path.join(directory, "marker-directory", "marker");
    const markerDirectory = path.dirname(markerPath);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(markerDirectory));
    await writeFile(reportPath, JSON.stringify(authPostflightReport()), { mode: 0o600 });
    await chmod(reportPath, 0o600);
    const options = {
      markerPath,
      legacyMarkerPath: path.join(directory, "legacy-marker"),
      reportPath,
      deploySha: AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA,
      repo: process.cwd(),
      workflowRunId: "40123456789",
      workflowRunAttempt: 1,
      authorizationId: "a".repeat(64),
    };
    const created = await applyAuthSchemaReattestation(options);
    expect(created.marker.state).toBe("schema-applied");
    expect(parseSchemaDeployMarker(await readFile(markerPath, "utf8")).marker.authorizationId).toBe("a".repeat(64));
    await expect(applyAuthSchemaReattestation(options)).rejects.toThrow(/existing release marker/);
  }, 30_000);

  it("pins the current migration-free fence script blobs on the effective Auth map entries", () => {
    for (const [filePath, migrationOriginBlob] of [
      ["scripts/production-traffic-cutover.sh", "3fd321d857e2aa024e4875a2689a588dc07078ee"],
      ["scripts/unified-v4-traffic-check.ts", "109395c697f53934123e73c75920be6cd58ea447"],
    ]) {
      const binding = AUTH_MULTIUSER_CONTENT_BOUND_PATHS[filePath];
      const workingBlob = execFileSync("git", ["hash-object", filePath], { encoding: "utf8" }).trim();
      expect(binding?.migrationOriginBlob).toBe(migrationOriginBlob);
      expect(allowedDeployBlobs(binding)).toContain(workingBlob);
    }
  });
  it("keeps the new Training analytics schema and runtime blobs outside migration-free Auth deployment", () => {
    const currentSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    for (const filePath of [
      "prisma/schema.prisma",
      "prisma/migrations/20261121130000_training_plan_intent/migration.sql",
      "src/app/api/v1/training/body-map/analytics/route.ts",
      "src/app/training/program-editor.tsx",
      "src/app/training/sessions/[id]/session-client.tsx",
      "src/app/training/training-client.tsx",
      "src/components/body-map/body-map-experience.tsx",
      "src/i18n/i18n-provider.tsx",
      "src/modules/training/body-map-training-analytics-v1.ts",
      "src/modules/training/training.repository.ts",
      "src/modules/training/training.schema.ts",
      "src/modules/training/training.service.ts",
    ]) {
      const blob = execFileSync("git", ["rev-parse", `${currentSha}:${filePath}`], { encoding: "utf8" }).trim();
      const binding = AUTH_MULTIUSER_CONTENT_BOUND_PATHS[filePath];
      if (binding) expect(allowedDeployBlobs(binding)).not.toContain(blob);
      else expect(Object.hasOwn(AUTH_MULTIUSER_CONTENT_BOUND_PATHS, filePath)).toBe(false);
    }
  });
  it("pins the candidate public-asset permission fix by exact deploy-script blob", () => {
    const binding = AUTH_MULTIUSER_CONTENT_BOUND_PATHS["scripts/deploy.sh"];
    const workingBlob = execFileSync("git", ["hash-object", "scripts/deploy.sh"], { encoding: "utf8" }).trim();
    expect(binding?.migrationOriginBlob).toBe("557dafb14f1b68e3cd0d904a8668a1f1073bd025");
    expect(allowedDeployBlobs(binding)).toContain(workingBlob);
  });
  it("keeps the existing Auth app-ready marker valid and blocks an unreviewed README change", () => {
    const previousDeploySha = AUTH_PREVIOUS_DEPLOY_SHA;
    const previousCompatibility = readGitCompatibility(process.cwd(), previousDeploySha,
      AUTH_MULTIUSER_MIGRATION_APP_SHA, AUTH_MULTIUSER_MANIFEST.id);
    const previousHandoff = evaluateSchemaDeployHandoff({
      markerText: authMultiuserMarkerText(),
      deploySha: previousDeploySha,
      ...previousCompatibility,
    });
    const previousAppReadyMarker = renderSchemaDeployTransition(previousHandoff.bytes, "app-ready");

    expect(validateSchemaDeployHandoffMarker(previousAppReadyMarker)).toMatchObject({
      manifestId: AUTH_MULTIUSER_MANIFEST.id,
      deploySha: previousDeploySha,
      state: "app-ready",
    });
    expect(validateAuthMarkerForTrainingMigrationHandoff(previousAppReadyMarker, {
      liveAppSha: previousDeploySha,
      repositoryPath: process.cwd(),
    })).toMatchObject({
      manifestId: AUTH_MULTIUSER_MANIFEST.id,
      deploySha: previousDeploySha,
      state: "app-ready",
    });
    const sourceMarkerWitness = {
      ...validateAuthMarkerForTrainingMigrationHandoff(previousAppReadyMarker, {
        liveAppSha: previousDeploySha,
        repositoryPath: process.cwd(),
      }),
      liveAppSha: previousDeploySha,
    };
    const migrationMarker = validateAuthMarkerForTrainingMigrationHandoff(previousAppReadyMarker, {
      liveAppSha: sourceMarkerWitness.liveAppSha,
      repositoryPath: process.cwd(),
    });
    expect(JSON.stringify(migrationMarker)).not.toBe(JSON.stringify(sourceMarkerWitness));
    expect({ ...migrationMarker, liveAppSha: sourceMarkerWitness.liveAppSha }).toEqual(sourceMarkerWitness);
    const capturePreflight = {
      manifestId: TRAINING_SESSION_CONTEXT_MANIFEST.id,
      preflightMode: "pre-maintenance",
      releaseSha: REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA,
      readyForOwnerAuthorization: false,
      readyForPreMaintenance: true,
      blockers: [],
      sourceReleaseMarker: sourceMarkerWitness,
    };
    expect(validateTrainingCaptureMarkerWitness({
      markerText: previousAppReadyMarker,
      preflightResult: capturePreflight,
      expectedReleaseSha: REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA,
      liveAppSha: previousDeploySha,
      repositoryPath: process.cwd(),
    })).toMatchObject({ digest: sourceMarkerWitness.digest, deploySha: previousDeploySha, state: "app-ready" });
    expect(() => validateTrainingCaptureMarkerWitness({
      markerText: previousAppReadyMarker.toString("utf8").replace(sourceMarkerWitness.compatibilityDigest,
        "f".repeat(64)),
      preflightResult: capturePreflight,
      expectedReleaseSha: REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA,
      liveAppSha: previousDeploySha,
      repositoryPath: process.cwd(),
    })).toThrow(/compatibility digest differs/);
    expect(() => validateTrainingCaptureMarkerWitness({
      markerText: previousAppReadyMarker,
      preflightResult: { ...capturePreflight, sourceReleaseMarker: { ...sourceMarkerWitness, digest: "0".repeat(64) } },
      expectedReleaseSha: REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA,
      liveAppSha: previousDeploySha,
      repositoryPath: process.cwd(),
    })).toThrow(/differs from successful Training/);
    expect(() => validateTrainingCaptureMarkerWitness({
      markerText: previousAppReadyMarker,
      preflightResult: { ...capturePreflight, readyForPreMaintenance: false },
      expectedReleaseSha: REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA,
      liveAppSha: previousDeploySha,
      repositoryPath: process.cwd(),
    })).toThrow(/successful exact-SHA Training pre-maintenance evidence/);
    for (const invalidPreflight of [
      { ...capturePreflight, manifestId: "unified-v4-republication-v1" },
      { ...capturePreflight, releaseSha: TRAINING_MIGRATION_SHA },
      { ...capturePreflight, preflightMode: "preflight" },
      { ...capturePreflight, readyForOwnerAuthorization: true },
    ]) {
      expect(() => validateTrainingCaptureMarkerWitness({
        markerText: previousAppReadyMarker,
        preflightResult: invalidPreflight,
        expectedReleaseSha: REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA,
        liveAppSha: previousDeploySha,
        repositoryPath: process.cwd(),
      })).toThrow(/successful exact-SHA Training pre-maintenance evidence/);
    }
    expect(() => validateTrainingCaptureMarkerWitness({
      markerText: previousAppReadyMarker,
      preflightResult: capturePreflight,
      expectedReleaseSha: TRAINING_MIGRATION_SHA,
      liveAppSha: previousDeploySha,
      repositoryPath: process.cwd(),
    })).toThrow(/successful exact-SHA Training pre-maintenance evidence/);
    expect(() => validateAuthMarkerForTrainingMigrationHandoff(previousAppReadyMarker, {
      liveAppSha: REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA,
      repositoryPath: process.cwd(),
    })).toThrow(/not the exact live Auth app-ready handoff/);
    expect(evaluateSchemaDeployHandoff({
      markerText: previousAppReadyMarker,
      deploySha: previousDeploySha,
      ...previousCompatibility,
    }).action).toBe("replay");

    const currentDeploySha = REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA;
    const currentCompatibility = readGitCompatibility(process.cwd(), currentDeploySha,
      AUTH_MULTIUSER_MIGRATION_APP_SHA, AUTH_MULTIUSER_MANIFEST.id);
    expect(currentCompatibility.changedPaths).toContain("README.md");
    for (const exerciseReleasePath of [
      "src/app/training/exercise-images.ts",
      "src/app/training/exercise-info.ts",
      "src/app/training/training-exercise-pane.tsx",
      "src/app/training/session-accounting-panel.tsx",
      "src/app/training/sessions/[id]/session-client.tsx",
      "src/app/training/sessions/[id]/edit/session-edit-client.tsx",
      "src/app/training/exercise-load-config-editor.tsx",
      "src/app/training/training-labels.ts",
      "src/modules/training/canonical-exercise-identity.ts",
      "src/modules/training/external-load-accounting.ts",
      "src/modules/training/load-accounting-v1.ts",
      "src/modules/training/training.constants.ts",
      "src/modules/training/training.repository.ts",
      "public/training/exercises/barbell-hip-thrust.png",
      "public/training/exercises/cable-glute-kickback.png",
      "public/training/exercises/cable-hip-abduction.png",
      "public/training/exercises/cable-hip-adduction.png",
      "public/training/exercises/cable-leg-curl.png",
      "public/training/exercises/front-foot-elevated-split-squat.png",
      "public/training/exercises/romanian-deadlift.png",
      "public/training/exercises/seated-calf-raise.png",
      "public/training/exercises/single-leg-standing-calf-raise.png",
      "public/training/categories/abs.webp",
      "public/training/categories/arms.webp",
      "public/training/categories/back.webp",
      "public/training/categories/chest.webp",
      "public/training/categories/glutes.webp",
      "public/training/categories/legs.webp",
      "public/training/categories/shoulders.webp",
      "public/training/exercises/barbell-upright-row.webp",
      "public/training/exercises/dumbbell-front-raise-alternating.webp",
      "public/training/exercises/dumbbell-front-raise-bilateral.webp",
      "public/training/exercises/dumbbell-hammer-curl-alternating.webp",
      "public/training/exercises/dumbbell-hammer-curl-bilateral.webp",
      "public/training/exercises/dumbbell-lateral-raise-bilateral.webp",
      "public/training/exercises/dumbbell-supinated-curl-alternating.webp",
      "public/training/exercises/dumbbell-supinated-curl-bilateral.webp",
      "public/training/exercises/flat-dumbbell-bench-press.webp",
      "public/training/exercises/incline-push-up-bench.webp",
      "public/training/exercises/knee-push-up-bench.webp",
      "public/training/exercises/knee-push-up-floor.webp",
      "public/training/exercises/lying-ez-bar-triceps-extension-flat.webp",
      "public/training/exercises/lying-ez-bar-triceps-extension-incline-30.webp",
      "public/training/exercises/lying-single-arm-dumbbell-triceps-extension-flat.webp",
      "public/training/exercises/lying-two-hand-dumbbell-triceps-extension-flat.webp",
      "public/training/exercises/one-arm-dumbbell-row-bench-supported.webp",
      "public/training/exercises/overhead-ez-bar-triceps-extension-seated-30.webp",
      "public/training/exercises/overhead-ez-bar-triceps-extension-seated-90.webp",
      "public/training/exercises/overhead-single-arm-dumbbell-triceps-extension-incline-30.webp",
      "public/training/exercises/overhead-single-arm-dumbbell-triceps-extension-seated-90.webp",
      "public/training/exercises/overhead-two-hand-dumbbell-triceps-extension-incline-30.webp",
      "public/training/exercises/overhead-two-hand-dumbbell-triceps-extension-seated-90.webp",
      "src/app/training/exercise-picker-catalog.ts",
      "src/app/training/exercise-picker.module.css",
      "src/app/training/exercise-picker.tsx",
      "src/app/training/program-editor.tsx",
      "src/app/training/training.module.css",
      "src/proxy.ts",
    ]) {
      const binding = AUTH_MULTIUSER_CONTENT_BOUND_PATHS[exerciseReleasePath];
      const actualDeployBlob = execFileSync("git", ["rev-parse", `${currentDeploySha}:${exerciseReleasePath}`], { encoding: "utf8" }).trim();
      expect(allowedDeployBlobs(binding)).toContain(actualDeployBlob);
      expect(allowedDeployBlobs(binding)).toContain(candidateDeployBlob(exerciseReleasePath, currentDeploySha));
    }
    for (const releasePath of [
      "src/app/api/registration/password-setup/route.ts",
      "src/app/api/registration/resend/route.ts",
      "src/app/api/registration/start/route.ts",
      "src/app/auth-flow.tsx",
      "src/app/register/page.tsx",
      "src/lib/auth.ts",
      "src/modules/auth/registration-users.ts",
      "src/i18n/i18n-provider.tsx",
      "scripts/production-db-target.sh",
    ]) {
      const binding = AUTH_MULTIUSER_CONTENT_BOUND_PATHS[releasePath];
      const actualDeployBlob = execFileSync("git", ["rev-parse", `${currentDeploySha}:${releasePath}`], { encoding: "utf8" }).trim();
      expect(allowedDeployBlobs(binding)).toContain(actualDeployBlob);
      expect(allowedDeployBlobs(binding)).toContain(candidateDeployBlob(releasePath, currentDeploySha));
      expect(currentCompatibility.changedPathObjects[releasePath]).toEqual({
        migrationOriginBlob: binding?.migrationOriginBlob,
        deployBlob: actualDeployBlob,
      });
    }
    for (const candidatePath of [
      ".github/workflows/deploy-production.yml",
      "src/app/auth.module.css",
      "src/app/login/page.tsx",
      "src/app/settings/profile/page.tsx",
      "src/app/settings/profile/profile-client.tsx",
      "src/app/settings/profile/profile.module.css",
    ]) {
      expect(allowedDeployBlobs(AUTH_MULTIUSER_CONTENT_BOUND_PATHS[candidatePath]))
        .toContain(candidateDeployBlob(candidatePath, currentDeploySha));
    }
    expect(currentCompatibility.changedPathObjects["src/model/weight-observation-filter.ts"]).toMatchObject({
      migrationOriginBlob: "bc0c0951cff1f52a073f01c9ec8ea0238772ee6b",
      deployBlob: "d9820a4387dacd1dd3d517b6a1365ac0a87a343f",
    });
    expect(currentCompatibility.changedPathObjects["README.md"]).toMatchObject({
      migrationOriginBlob: "aa8edb763d217c0f8791c6f630f700d04fb42295",
      deployBlob: "63c696a7d6699edec9c743c1c9fe8cb5cce99cbf",
    });
    const currentHandoff = evaluateSchemaDeployHandoff({
      markerText: previousAppReadyMarker,
      deploySha: currentDeploySha,
      ...currentCompatibility,
    });
    expect(currentHandoff).toMatchObject({ action: "write", marker: { deploySha: currentDeploySha, state: "schema-applied" } });
    expect(() => evaluateSchemaDeployHandoff({
      markerText: previousAppReadyMarker,
      deploySha: currentDeploySha,
      ...currentCompatibility,
      changedPathObjects: {
        ...currentCompatibility.changedPathObjects,
        "README.md": {
          ...currentCompatibility.changedPathObjects["README.md"],
          deployBlob: "e".repeat(40),
        },
      },
    })).toThrow(/exact reviewed content binding/);
  }, 30_000);

  it("hands off the Auth V2 app-ready marker only from the exact reviewed migration tree", async () => {
    const deploySha = AUTH_PREVIOUS_DEPLOY_SHA;
    const compatibility = readGitCompatibility(process.cwd(), deploySha,
      AUTH_MULTIUSER_MIGRATION_APP_SHA, AUTH_MULTIUSER_MANIFEST.id);
    expect(compatibility.isAncestor).toBe(true);
    expect(compatibility.criticalObjects).toHaveProperty("prisma");
    expect(compatibility.criticalObjects).not.toHaveProperty("src");
    expect(compatibility.criticalObjects).toHaveProperty("Dockerfile");
    expect(compatibility.changedPaths.every((changed) => changed.startsWith("tests/")
      || changed === ".github/workflows/production-full-history-recalculate.yml"
      || ["scripts/deploy.sh", "scripts/production-db-target.sh", "scripts/production-release-marker.sh",
        "scripts/production-schema-deploy-handoff.mjs", "scripts/production-traffic-cutover.sh",
        "scripts/production-route-primitives.sh"].includes(changed))).toBe(true);

    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-auth-schema-handoff-"));
    directories.push(directory);
    const markerPath = path.join(directory, "marker");
    await writeFile(markerPath, authMultiuserMarkerText(), { flag: "wx", mode: 0o600 });
    const handoff = evaluateSchemaDeployHandoff({
      markerText: await readFile(markerPath, "utf8"), deploySha, ...compatibility,
    });
    expect(handoff).toMatchObject({ action: "write", marker: {
      manifestId: AUTH_MULTIUSER_MANIFEST.id,
      migrationOriginSha: AUTH_MULTIUSER_MIGRATION_APP_SHA,
      deploySha,
      state: "schema-applied",
      workflowRunId: "40123456791",
    } });
    expect(evaluateSchemaDeployHandoff({ markerText: handoff.bytes, deploySha, ...compatibility }).action).toBe("replay");
    expect(() => evaluateSchemaDeployHandoff({
      markerText: authMultiuserMarkerText(), deploySha, ...compatibility,
      changedPathObjects: {
        ...compatibility.changedPathObjects,
        ".github/workflows/production-full-history-recalculate.yml": {
          ...compatibility.changedPathObjects[".github/workflows/production-full-history-recalculate.yml"],
          deployBlob: "e".repeat(40),
        },
      },
    })).toThrow(/exact reviewed content binding/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: authMultiuserMarkerText(), deploySha, ...compatibility,
      changedPaths: [...compatibility.changedPaths, "src/app/page.tsx"],
    })).toThrow(/not allowlisted for this schema handoff/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: authMultiuserMarkerText({ state: "schema-applied" }), deploySha, ...compatibility,
    })).toThrow(/Auth migration marker run, lineage, origin, or state is not admitted/);
  }, 30_000);

  it.skipIf(process.platform === "win32")("atomically publishes and replays the Auth V3 handoff through the normal marker path", async () => {
    const deploySha = AUTH_PREVIOUS_DEPLOY_SHA;
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-auth-schema-handoff-"));
    directories.push(directory);
    const markerPath = path.join(directory, "marker");
    await writeFile(markerPath, authMultiuserMarkerText(), { flag: "wx", mode: 0o600 });
    const handoff = await applySchemaDeployHandoff({ markerPath, deploySha, repo: process.cwd() });
    expect(handoff).toMatchObject({ action: "write", marker: {
      manifestId: AUTH_MULTIUSER_MANIFEST.id,
      migrationOriginSha: AUTH_MULTIUSER_MIGRATION_APP_SHA,
      deploySha,
      state: "schema-applied",
    } });
    expect((await applySchemaDeployHandoff({ markerPath, deploySha, repo: process.cwd() })).action).toBe("replay");
  }, 30_000);

  it("rejects an Auth source change without an exact content binding", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-auth-runtime-drift-"));
    directories.push(directory);
    const repository = path.join(directory, "repo");
    execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--shared", process.cwd(), repository]);
    execFileSync("git", ["-C", repository, "checkout", "--quiet", "--detach", REVIEWED_AUTH_COMPATIBLE_CANDIDATE_SHA]);
    const runtimePath = path.join(repository, "src/modules/profile/profile.repository.ts");
    await writeFile(runtimePath, `${await readFile(runtimePath, "utf8")}\n// incompatible auth runtime fixture\n`);
    execFileSync("git", ["-C", repository, "add", "src/modules/profile/profile.repository.ts"]);
    execFileSync("git", ["-C", repository, "-c", "user.name=BodyCast tests", "-c", "user.email=test@example.invalid",
      "commit", "--quiet", "-m", "Auth runtime compatibility fixture"]);
    const candidateSha = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const compatibility = readGitCompatibility(repository, candidateSha,
      AUTH_MULTIUSER_MIGRATION_APP_SHA, AUTH_MULTIUSER_MANIFEST.id);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: authMultiuserMarkerText(), deploySha: candidateSha, ...compatibility,
    })).toThrow(/not allowlisted for this schema handoff/);
  }, 30_000);

  it("hands off the dynamic-workout marker only across an exact migration tree and unchanged nullable-session reader", async () => {
    const { repository, originSha, candidateSha } = await createDynamicWorkoutHandoffRepository();
    const compatibility = readGitCompatibility(repository, candidateSha, originSha, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id);
    expect(compatibility.isAncestor).toBe(true);
    expect(compatibility.changedPaths).toEqual(["tests/dynamic-release-compatibility.txt"]);
    expect(Object.keys(compatibility.criticalObjects)).toContain("src/modules/training");
    expect(Object.keys(compatibility.criticalObjects)).toContain(".github/workflows");
    expect(Object.keys(compatibility.criticalObjects)).toContain("scripts/production-app-capabilities.json");

    const sourceMarker = dynamicWorkoutMarkerText(originSha);
    const handoff = evaluateSchemaDeployHandoff({ markerText: sourceMarker, deploySha: candidateSha, ...compatibility });
    expect(handoff).toMatchObject({ action: "write", marker: {
      manifestId: DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id,
      migrationOriginSha: originSha,
      deploySha: candidateSha,
      state: "schema-applied",
    } });
    const replay = evaluateSchemaDeployHandoff({ markerText: handoff.bytes, deploySha: candidateSha, ...compatibility });
    expect(replay.action).toBe("replay");

    const trainingService = path.join(repository, "src/modules/training/training.service.ts");
    await writeFile(trainingService, `${await readFile(trainingService, "utf8")}\n// incompatible reader change\n`);
    execFileSync("git", ["-C", repository, "add", "src/modules/training/training.service.ts"]);
    execFileSync("git", ["-C", repository, "-c", "user.name=BodyCast tests", "-c", "user.email=test@example.invalid",
      "commit", "--quiet", "-m", "change nullable relation reader"]);
    const incompatibleSha = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(() => readGitCompatibility(repository, incompatibleSha, originSha, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id))
      .toThrow(/src\/modules\/training differs from the migration origin/);

    const workflowFixture = await createDynamicWorkoutHandoffRepository();
    const migrationWorkflow = path.join(workflowFixture.repository, ".github/workflows/production-migrate.yml");
    await writeFile(migrationWorkflow, `${await readFile(migrationWorkflow, "utf8")}\n# changed migration authorization workflow\n`);
    execFileSync("git", ["-C", workflowFixture.repository, "add", ".github/workflows/production-migrate.yml"]);
    execFileSync("git", ["-C", workflowFixture.repository, "-c", "user.name=BodyCast tests", "-c", "user.email=test@example.invalid",
      "commit", "--quiet", "-m", "change migration authorization workflow"]);
    const workflowChangedSha = execFileSync("git", ["-C", workflowFixture.repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(() => readGitCompatibility(workflowFixture.repository, workflowChangedSha, workflowFixture.originSha, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id))
      .toThrow(/\.github\/workflows differs from the migration origin/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: dynamicWorkoutMarkerText(originSha, { workflowRunId: "0" }),
      deploySha: candidateSha,
      ...compatibility,
    })).toThrow(/marker run, lineage, origin, or state is not admitted/);
  }, 30_000);

  it("admits only the exact SHA of the new manifest's successful schema-applied marker", () => {
    const marker = v4MigrationMarkerText();
    expect(evaluateSchemaDeployHandoff({ markerText: marker, deploySha: V4_MIGRATION_SHA })).toMatchObject({
      action: "not-needed",
      marker: { manifestId: "unified-v4-republication-v1", releaseSha: V4_MIGRATION_SHA, state: "schema-applied", spawnState: "started" },
    });
    expect(() => evaluateSchemaDeployHandoff({ markerText: marker, deploySha: "a".repeat(40) }))
      .toThrow(/V4 migration marker/);
    expect(() => evaluateSchemaDeployHandoff({ markerText: v4MigrationMarkerText({ spawnState: "not-started" }), deploySha: V4_MIGRATION_SHA }))
      .toThrow(/V4 migration marker/);
    expect(() => evaluateSchemaDeployHandoff({ markerText: v4MigrationMarkerText({ workflowRunId: "0" }), deploySha: V4_MIGRATION_SHA }))
      .toThrow(/V4 migration marker/);
  });

  it("hands off the verified V4 app-ready migration marker to the exact compatible descendant", () => {
    const candidateSha = v4TestCandidateSha();
    const compatibility = readGitCompatibility(process.cwd(), candidateSha, V4_REPUBLICATION_MIGRATION_ORIGIN_SHA);
    expect(compatibility.isAncestor).toBe(true);
    expect(compatibility.changedPaths).toContain("scripts/unified-v4-activate-replay.ts");
    expect(compatibility.changedPaths).toContain("src/modules/model-episodes/unified-rollout-v4.service.ts");
    expect(compatibility.changedPaths).not.toContain(".github/workflows/activate-unified-v4-production.yml");
    const expectedV4Bindings = {
      "src/modules/activity/active-energy-materialization.ts": {
        migrationOriginBlob: "ec066afe744ec0de47f8c5503266764eff311608",
        deployBlob: "f163d3116638e44a6e42e10fac261f57acd11579",
      },
      "src/modules/activity/active-energy-publication.ts": {
        migrationOriginBlob: "3c1fcfec0ca73ac6b599ae6a7527c067b77adb2f",
        deployBlob: "b76617954f03b700d7a783aa2f30a11388b769c9",
      },
      "src/modules/health/health.repository.ts": {
        migrationOriginBlob: "a8040b6f8a0eede730c67ba1a4df90063570bc13",
        deployBlob: "e9e2b342d3c26cb64f28ff9f19b136bbe9b557af",
      },
      ".github/workflows/production-migration-preflight.yml": {
        migrationOriginBlob: "02a0a107c004dfd169363a1ac98abceb9e1674d0",
        deployBlob: "b66ed02fae2efb86dc540ff7a3809bc93ee85a6b",
      },
      ".github/workflows/production-migration-safety-ci.yml": {
        migrationOriginBlob: "38c58d25e8cb3a0aa389b4003c252a64481e584d",
        deployBlob: "c07c2785d8f60993f63d7b779135d9d628834077",
      },
      "src/app/api/forecast/action/route.ts": {
        migrationOriginBlob: "f50deac8061cff227dba477182472e44ddff4090",
        deployBlob: "73c6c1f6d0edd4b6ae3b7c82fdef73419b36c219",
      },
      "src/modules/model-forecast/forecast-ui.ts": {
        migrationOriginBlob: "5d4faf2fd247f2abcc0d5889ba03917d4e2ace70",
        deployBlob: "cfc853f1aeb319e0acc9910025573336478d7496",
      },
      "src/app/api/forecast/route.ts": {
        migrationOriginBlob: "266d7f80a79f298e413d1153685083d2b3dfe84a",
        deployBlob: "a629fb980be4dbc00209536b54882432759f916e",
      },
      "src/app/api/v1/model/recalculate/route.ts": {
        migrationOriginBlob: "132d6eb4822d40d8698a17b1586a06cb77573e7d",
        deployBlob: "dd6e997d42043d8acf93c59f485b4224cea359ea",
      },
      "src/lib/logger.ts": {
        migrationOriginBlob: "0b4e09be4aa48424027e229e14bbb090624881bf",
        deployBlob: "fdaccd1cd0c526a4b1b1415002bd09ea27ec7f5a",
      },
      "docs/development/production-deploy.md": {
        migrationOriginBlob: "b1a26cce30fb69fddde0d9fe81dd3bc26e342678",
        deployBlob: "15ed255f4cf38799807a84cb5b4d231269552fdf",
      },
      ".github/workflows/deploy-production.yml": {
        migrationOriginBlob: "1be0ba2dc8fcfe2c34a97b39ae1d5d0fde32404f",
        deployBlob: "b4955059fc3cae0d94abbd2656c99b51800caad7",
      },
      "scripts/deploy.sh": {
        migrationOriginBlob: "4844bdc0b586f29dbc3b60952717e249a04bbbbc",
        deployBlob: "b3c119c2442d11361612228122718351d36beff4",
      },
      "src/modules/health/health.service.ts": {
        migrationOriginBlob: "17a2e1c47b2b7fe1d0d7b968b9e91fffc51a8431",
        deployBlob: "089e266f3664b4aabe268888e6ac3a233d2d0515",
      },
      "src/modules/model-episodes/experimental-glycogen-state-shadow.service.ts": {
        migrationOriginBlob: "0e61b01275a1905710adc1d7721db006596459b0",
        deployBlob: "8a2aa5e38d4ad224e862a271a3fa69d655ff0e9a",
      },
      "src/modules/model-episodes/model-episode.service.ts": {
        migrationOriginBlob: "0d32af00d8fa7bf4228cb87c434d85492b430d82",
        deployBlob: "0c26958724115a8af43081cb127350213ece1488",
      },
      "src/modules/model-episodes/physiology-v7-persistence.repository.ts": {
        migrationOriginBlob: "07e75f6a1393cdb8cae8f9c593575930a124d394",
        deployBlob: "931fafdc488b460a080588ec7b981f08befd537f",
      },
      "src/modules/profile/experimental-stepper-active-energy-shadow.service.ts": {
        migrationOriginBlob: "b4ec529a9755c9a3b15ea2b6c9ba19216bd6e888",
        deployBlob: "5244ce9f1d1092a881776232128464d8d6705127",
      },
      "src/modules/training/experimental-strength-energy-shadow.service.ts": {
        migrationOriginBlob: "2f556ff6817db3dff23a09d0ff15ba8254543551",
        deployBlob: "4e9f5da57b7b60c0c553c35f62c12d994c9f9126",
      },
      "src/modules/training/training.service.ts": {
        migrationOriginBlob: "d036d589304338b07d43c1b1eebb8314910b3acb",
        deployBlob: "408efc5996e9ad701057ab7f261d0cb045541ff4",
      },
      "scripts/ci/production-safety-postgres-smoke.mjs": {
        migrationOriginBlob: "1a0345e687fd3f604499502bdf98a07b606da07f",
        deployBlob: "7b973c5a5469393b5d23ba298041ef6d3933c036",
      },
      "scripts/production-db-data-fingerprint.sh": {
        migrationOriginBlob: "101ecf34dc5751fc431a5b88f787d7ebc3e98fde",
        deployBlob: "fff493643ecb171049893ecfc935773a4bcdaac5",
      },
      "scripts/production-v4-post-ddl-backup-host.sh": {
        migrationOriginBlob: null,
        deployBlob: "76782d626c633a37c3de2330a6ef1d58df67d0d0",
      },
      "scripts/github-no-app-preflight-evidence.mjs": {
        migrationOriginBlob: "b98263494d504228b1fdb207a249d5b9f3f77d5e",
        deployBlob: "954cc02644a9c46cb3b3e7c2d73f73385a9c0eae",
      },
      "scripts/production-v4-recovery.mjs": {
        migrationOriginBlob: null,
        deployBlob: "af8e2e03ddac71d710f191ec2f221b31c3785a76",
      },
      "scripts/production-writer-drain.mjs": {
        migrationOriginBlob: "f2e275e64e52089ac88351a695b2aad2d427e343",
        deployBlob: "19bce9311aa836b0347b832dc7d4042b1d26bd96",
      },
      "scripts/production-traffic-cutover.sh": {
        migrationOriginBlob: "baeb3ff34c52c606a653d9e0c027c79d7b7c72da",
        deployBlob: "7b1d61f367d1b2e909fe435d50a5cdcdc736247f",
      },
    };
    for (const [changedPath, expectedBinding] of Object.entries(expectedV4Bindings)) {
      expect(compatibility.changedPathObjects[changedPath]).toEqual(expectedBinding);
      const tampered = {
        ...compatibility.changedPathObjects,
        [changedPath]: { ...compatibility.changedPathObjects[changedPath], deployBlob: "f".repeat(40) },
      };
      expect(() => evaluateSchemaDeployHandoff({
        markerText: v4AppReadyMarkerText(), deploySha: candidateSha,
        ...compatibility, changedPathObjects: tampered,
      })).toThrow(/exact reviewed content binding/);
    }
    const plan = evaluateSchemaDeployHandoff({
      markerText: v4AppReadyMarkerText(), deploySha: candidateSha, ...compatibility,
    });
    expect(plan.action).toBe("write");
    expect(plan.marker).toMatchObject({
      manifestId: V4_REPUBLICATION_HANDOFF_PROVENANCE.manifestId,
      migrationOriginSha: V4_REPUBLICATION_MIGRATION_ORIGIN_SHA,
      deploySha: candidateSha,
      state: "schema-applied",
      workflowRunId: V4_REPUBLICATION_HANDOFF_PROVENANCE.workflowRunId,
      workflowRunAttempt: V4_REPUBLICATION_HANDOFF_PROVENANCE.workflowRunAttempt,
      authorizationId: V4_REPUBLICATION_HANDOFF_PROVENANCE.authorizationId,
      lineageDigest: V4_REPUBLICATION_HANDOFF_PROVENANCE.lineageDigest,
      spawnState: "started",
    });
    const replay = evaluateSchemaDeployHandoff({
      markerText: plan.bytes, deploySha: candidateSha, ...compatibility,
    });
    expect(replay.action).toBe("replay");
    expect(replay.marker.migrationOriginSha).toBe(V4_REPUBLICATION_MIGRATION_ORIGIN_SHA);
  }, 30_000);

  it("blocks wrong V4 run lineage, manifest, ancestry, schema, and changed runtime blobs", () => {
    const candidateSha = v4TestCandidateSha();
    const compatibility = readGitCompatibility(process.cwd(), candidateSha, V4_REPUBLICATION_MIGRATION_ORIGIN_SHA);
    for (const marker of [
      v4AppReadyMarkerText({ workflowRunId: "38447647404" }),
      v4AppReadyMarkerText({ lineageDigest: "d".repeat(64) }),
      v4AppReadyMarkerText({ manifestId: "active-energy-unified-v2" }),
      v4AppReadyMarkerText({ releaseSha: "a".repeat(40) }),
    ]) {
      expect(() => evaluateSchemaDeployHandoff({ markerText: marker, deploySha: candidateSha, ...compatibility })).toThrow();
    }
    expect(() => evaluateSchemaDeployHandoff({
      markerText: v4AppReadyMarkerText(), deploySha: candidateSha, ...compatibility, isAncestor: false,
    })).toThrow(/descendant/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: v4AppReadyMarkerText(), deploySha: candidateSha, ...compatibility,
      changedPaths: [...compatibility.changedPaths, "prisma/schema.prisma"],
    })).toThrow(/allowlist/);
    for (const changedPath of ["Dockerfile", "scripts/production-full-history-recalculate.ts"]) {
      expect(() => evaluateSchemaDeployHandoff({
        markerText: v4AppReadyMarkerText(), deploySha: candidateSha, ...compatibility,
        changedPaths: [...compatibility.changedPaths, changedPath],
      })).toThrow(/not allowlisted for this schema handoff/);
    }
    const alteredRuntime = {
      ...compatibility.changedPathObjects,
      "src/modules/model-episodes/unified-rollout-v4.service.ts": {
        ...compatibility.changedPathObjects["src/modules/model-episodes/unified-rollout-v4.service.ts"],
        deployBlob: "f".repeat(40),
      },
    };
    expect(() => evaluateSchemaDeployHandoff({
      markerText: v4AppReadyMarkerText(), deploySha: candidateSha, ...compatibility,
      changedPathObjects: alteredRuntime,
    })).toThrow(/exact reviewed content binding/);
  }, 30_000);

  it("accepts the real migration-origin descendant whose runtime trees match", () => {
    const compatibility = readGitCompatibility(process.cwd(), DEPLOY_SHA);
    const plan = evaluateSchemaDeployHandoff({
      markerText: markerText(), deploySha: DEPLOY_SHA, ...compatibility,
    });
    expect(plan.action).toBe("write");
    expect(plan.marker.migrationOriginSha).toBe(SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA);
    expect(plan.marker.deploySha).toBe(DEPLOY_SHA);
    expect(plan.marker.authorizationId).toBe(provenance.authorizationId);
    expect(plan.marker.lineageDigest).toBe(provenance.lineageDigest);
    expect(plan.marker.sourceMarkerDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts the pinned schema-compatible checkout only when its exact runtime paths remain compatible", () => {
    const candidateSha = SCHEMA_COMPATIBLE_CHECKOUT_SHA;
    const compatibility = readGitCompatibility(process.cwd(), candidateSha);
    expect(compatibility.isAncestor).toBe(true);
    expect(compatibility.changedPaths).toContain("src/modules/model-episodes/transient-exercise-water-episode-time-v2.ts");
    expect(compatibility.changedPaths).toContain("src/modules/training/experimental-transient-exercise-water-shadow.service.ts");
    expect(compatibility.changedPathObjects).toEqual({
      "docs/development/production-deploy.md": {
        migrationOriginBlob: "6096de9b780800654046c63c369643a310d5bb56",
        deployBlob: "b1a26cce30fb69fddde0d9fe81dd3bc26e342678",
      },
      "scripts/github-forward-resume-evidence.mjs": {
        migrationOriginBlob: "b62a7e09fd871e68829e9fad3902510a9e3bd6ca",
        deployBlob: "9d76e1612f86f700c5e3950fc67c77f0fa6c7912",
      },
      "scripts/production-app-container-health-wait.sh": {
        migrationOriginBlob: null,
        deployBlob: "b99a87d861d5471336bd0d75f4df49436237df7c",
      },
      "scripts/production-checkout-diagnostic.sh": {
        migrationOriginBlob: "f19687c65d7e9d3b744890f377ebf6f0c80eebf9",
        deployBlob: "7256cf45844deade0685f82eb470bf79a396c497",
      },
      "scripts/production-forward-resume.mjs": {
        migrationOriginBlob: "2c07e0636146caaa5bfef69522f351c4e37aa13d",
        deployBlob: "43373e740cdad93d6f88c37c565288b2db1ad70d",
      },
      "scripts/ci/production-deploy-gate.ts": {
        migrationOriginBlob: "8d0d5e1d0a7c291daae0ff9cd6a970cfb3085083",
        deployBlob: "451319d5792e92fac02757ad8396c531ad5f19bb",
      },
      "scripts/production-route-primitives.sh": {
        migrationOriginBlob: "65a51f97bf404d9353b45b1fc33725cb7a582daa",
        deployBlob: "001b5a5de48a17db06ab7e61731b184a3c82dc83",
      },
      "scripts/deploy.sh": {
        migrationOriginBlob: "14e4caa5645ce8b95c16ecc03b3937bd0e60a1e3",
        deployBlob: "4844bdc0b586f29dbc3b60952717e249a04bbbbc",
      },
    });
    expect(compatibility.changedPathObjects["scripts/github-forward-resume-evidence.mjs"].migrationOriginBlob)
      .not.toBe(compatibility.changedPathObjects["scripts/github-forward-resume-evidence.mjs"].deployBlob);
    expect(compatibility.changedPathObjects["scripts/production-forward-resume.mjs"].migrationOriginBlob)
      .not.toBe(compatibility.changedPathObjects["scripts/production-forward-resume.mjs"].deployBlob);
    const plan = evaluateSchemaDeployHandoff({
      markerText: markerText(), deploySha: candidateSha, ...compatibility,
    });
    expect(plan.action).toBe("write");
    expect(plan.marker.deploySha).toBe(candidateSha);
    expect(plan.compatibilityDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks this release candidate from the old schema handoff while its new migrations are pending", () => {
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(), encoding: "utf8",
    }).trim();
    expect(() => readGitCompatibility(process.cwd(), candidateSha))
      .toThrow("Schema deploy handoff blocked: prisma differs from the migration origin");
  });

  it("admits only exact reviewed content-bound blob pairs", () => {
    const candidateSha = SCHEMA_COMPATIBLE_CHECKOUT_SHA;
    const compatibility = readGitCompatibility(process.cwd(), candidateSha);

    for (const [changedPath, proof] of Object.entries(compatibility.changedPathObjects)) {
      const changedPathObjects = {
        ...compatibility.changedPathObjects,
        [changedPath]: { ...proof, deployBlob: "e".repeat(40) },
      };
      expect(() => evaluateSchemaDeployHandoff({
        markerText: markerText(), deploySha: candidateSha,
        ...compatibility, changedPathObjects,
      })).toThrow(/exact reviewed content binding/);
    }

    expect(() => evaluateSchemaDeployHandoff({
      markerText: markerText(), deploySha: candidateSha,
      ...compatibility, changedPathObjects: {},
    })).toThrow(/content-bound path evidence is incomplete/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: markerText(), deploySha: candidateSha,
      ...compatibility,
      changedPathObjects: {
        ...compatibility.changedPathObjects,
        "scripts/unreviewed-release-helper.mjs": { migrationOriginBlob: null, deployBlob: "f".repeat(40) },
      },
    })).toThrow(/content-bound path evidence is incomplete or unexpected/);
  });

  it("allows the reviewed transient-water paths but keeps adjacent raw and persistence paths blocked", () => {
    const reviewedDerivedPaths = [
      "src/modules/model-episodes/transient-exercise-water-episode-time-v2.ts",
      "src/modules/training/experimental-transient-exercise-water-shadow.service.ts",
    ];
    expect(evaluateSchemaDeployHandoff({
      markerText: markerText(), deploySha: DEPLOY_SHA,
      ...compatible, changedPaths: reviewedDerivedPaths,
    }).action).toBe("write");

    for (const changedPath of [
      "src/modules/training/training-session.service.ts",
      "src/modules/model-episodes/model-episode.service.ts",
      "prisma/schema.prisma",
    ]) {
      expect(() => evaluateSchemaDeployHandoff({
        markerText: markerText(), deploySha: DEPLOY_SHA,
        ...compatible, changedPaths: [changedPath],
      })).toThrow(/allowlist/);
    }
  });

  it("rejects runtime drift, a foreign SHA, tampered provenance, and a non-descendant", () => {
    expect(() => evaluateSchemaDeployHandoff({
      markerText: markerText(), deploySha: DEPLOY_SHA,
      ...compatible, changedPaths: ["prisma/schema.prisma"],
    })).toThrow(/allowlist/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: markerText(), deploySha: DEPLOY_SHA,
      ...compatible, changedPaths: ["scripts/unified-v4-activate-replay.ts"],
    })).toThrow(/allowlist/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: markerText(), deploySha: DEPLOY_SHA,
      ...compatible, changedPaths: ["src/modules/model-episodes/model-episode.service.ts"],
    })).toThrow(/allowlist/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: markerText({ releaseSha: "a".repeat(40) }), deploySha: DEPLOY_SHA, ...compatible,
    })).toThrow(/migration origin/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: markerText({ lineageDigest: "b".repeat(64) }), deploySha: DEPLOY_SHA, ...compatible,
    })).toThrow(/provenance/);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: markerText(), deploySha: "c".repeat(40), ...compatible, isAncestor: false,
    })).toThrow(/descendant/);
  });

  it("replays one identical handoff, advances an app-ready marker, and rejects tampered proof", () => {
    const first = evaluateSchemaDeployHandoff({ markerText: markerText(), deploySha: DEPLOY_SHA, ...compatible });
    const replay = evaluateSchemaDeployHandoff({ markerText: first.bytes, deploySha: DEPLOY_SHA, ...compatible });
    expect(replay.action).toBe("replay");
    const appReady = renderSchemaDeployTransition(first.bytes, "app-ready").toString("utf8");
    expect(appReady).toContain("state=app-ready");
    expect(appReady).toContain(`migrationOriginSha=${SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA}`);
    const advancedSha = "f".repeat(40);
    const advanced = evaluateSchemaDeployHandoff({
      markerText: appReady,
      deploySha: advancedSha,
      ...compatible,
      changedPaths: [
        ...compatible.changedPaths,
        "Dockerfile",
        "scripts/production-full-history-recalculate.ts",
        "src/modules/model-episodes/full-history-recalculation.service.ts",
      ],
    });
    expect(advanced.action).toBe("write");
    expect(advanced.marker.deploySha).toBe(advancedSha);
    expect(advanced.marker.state).toBe("schema-applied");
    expect(advanced.marker.migrationOriginSha).toBe(SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: appReady,
      deploySha: advancedSha,
      ...compatible,
      changedPaths: ["src/modules/model-episodes/model-episode.service.ts"],
    })).toThrow(/allowlist/);
    const parsed = parseSchemaDeployMarker(first.bytes);
    const tampered = first.bytes.toString("utf8").replace(parsed.marker.compatibilityDigest, "e".repeat(64));
    expect(() => evaluateSchemaDeployHandoff({
      markerText: tampered, deploySha: DEPLOY_SHA, ...compatible,
    })).toThrow(/does not match this deploy candidate/);
  });

  it("leaves the migration marker unchanged when publication is interrupted", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-schema-handoff-"));
    directories.push(directory);
    const markerPath = path.join(directory, "marker");
    const original = markerText();
    await writeFile(markerPath, original, { flag: "wx" });
    await expect(applySchemaDeployHandoff({
      markerPath, deploySha: DEPLOY_SHA, repo: process.cwd(),
      beforeRename: () => { throw new Error("interrupted before publish"); },
    })).rejects.toThrow(/interrupted before publish/);
    expect(await readFile(markerPath, "utf8")).toBe(original);
  });

  it.skipIf(process.platform === "win32")("atomically hands off the V4 app-ready marker, preserves its lineage, and safely replays the exact SHA", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v4-schema-handoff-"));
    directories.push(directory);
    const markerPath = path.join(directory, "marker");
    const original = v4AppReadyMarkerText();
    const candidateSha = v4TestCandidateSha();
    await writeFile(markerPath, original, { flag: "wx", mode: 0o600 });
    await expect(applySchemaDeployHandoff({
      markerPath, deploySha: candidateSha, repo: process.cwd(),
      beforeRename: () => { throw new Error("interrupted before publish"); },
    })).rejects.toThrow(/interrupted before publish/);
    expect(await readFile(markerPath, "utf8")).toBe(original);
    expect((await readdir(directory)).sort()).toEqual(["marker"]);
    const published = await applySchemaDeployHandoff({ markerPath, deploySha: candidateSha, repo: process.cwd() });
    expect(published.action).toBe("write");
    expect(published.marker).toMatchObject({
      manifestId: "unified-v4-republication-v1",
      migrationOriginSha: V4_REPUBLICATION_MIGRATION_ORIGIN_SHA,
      deploySha: candidateSha,
      state: "schema-applied",
      workflowRunId: V4_REPUBLICATION_HANDOFF_PROVENANCE.workflowRunId,
      authorizationId: V4_REPUBLICATION_HANDOFF_PROVENANCE.authorizationId,
      lineageDigest: V4_REPUBLICATION_HANDOFF_PROVENANCE.lineageDigest,
    });
    const replay = await applySchemaDeployHandoff({ markerPath, deploySha: candidateSha, repo: process.cwd() });
    expect(replay.action).toBe("replay");
    expect((await readFile(markerPath, "utf8")).split("\n")).toContain(`migrationOriginSha=${V4_REPUBLICATION_MIGRATION_ORIGIN_SHA}`);
  }, 30_000);

  it("does not overwrite a V4 marker changed during the handoff write", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v4-schema-handoff-race-"));
    directories.push(directory);
    const markerPath = path.join(directory, "marker");
    const candidateSha = v4TestCandidateSha();
    const original = v4AppReadyMarkerText();
    const concurrentMarker = v4AppReadyMarkerText({ lineageDigest: "d".repeat(64) });
    await writeFile(markerPath, original, { flag: "wx", mode: 0o600 });
    await expect(applySchemaDeployHandoff({
      markerPath, deploySha: candidateSha, repo: process.cwd(),
      beforeRename: () => writeFile(markerPath, concurrentMarker),
    })).rejects.toThrow(/marker changed during compatibility handoff/);
    expect(await readFile(markerPath, "utf8")).toBe(concurrentMarker);
    expect((await readdir(directory)).sort()).toEqual(["marker"]);
  }, 30_000);

  it("converts an exact Training schema-applied marker to V3 and replays idempotently", () => {
    const compatibility = readGitCompatibility(process.cwd(), TRAINING_MIGRATION_SHA,
      TRAINING_MIGRATION_SHA, TRAINING_MUTATION_LEDGER_MANIFEST.id);
    expect(compatibility.changedPaths).toEqual([]);
    expect(compatibility.criticalObjects).toHaveProperty("src");
    expect(compatibility.criticalObjects).toHaveProperty(".github/workflows");

    const plan = evaluateSchemaDeployHandoff({
      markerText: trainingMutationMarkerText(),
      deploySha: TRAINING_MIGRATION_SHA,
      ...compatibility,
    });
    expect(plan.action).toBe("write");
    expect(plan.marker).toMatchObject({
      manifestId: TRAINING_MUTATION_LEDGER_MANIFEST.id,
      migrationOriginSha: TRAINING_MIGRATION_SHA,
      deploySha: TRAINING_MIGRATION_SHA,
      state: "schema-applied",
      workflowRunId: "40123456790",
      workflowRunAttempt: 1,
      authorizationId: "training-migration-authorization-01",
      lineageDigest: "b".repeat(64),
      spawnState: "started",
    });
    const replay = evaluateSchemaDeployHandoff({
      markerText: plan.bytes,
      deploySha: TRAINING_MIGRATION_SHA,
      ...compatibility,
    });
    expect(replay.action).toBe("replay");
    expect(parseSchemaDeployMarker(renderSchemaDeployTransition(plan.bytes, "app-ready")).marker)
      .toMatchObject({ manifestId: TRAINING_MUTATION_LEDGER_MANIFEST.id, state: "app-ready" });
  });

  it("validates and checks a Training V3 app-ready marker through the deployed CLI", async () => {
    const compatibility = readGitCompatibility(process.cwd(), TRAINING_MIGRATION_SHA,
      TRAINING_MIGRATION_SHA, TRAINING_MUTATION_LEDGER_MANIFEST.id);
    const schemaApplied = evaluateSchemaDeployHandoff({
      markerText: trainingMutationMarkerText(),
      deploySha: TRAINING_MIGRATION_SHA,
      ...compatibility,
    });
    const appReady = renderSchemaDeployTransition(schemaApplied.bytes, "app-ready");
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-training-v3-cli-"));
    directories.push(directory);
    const markerPath = path.join(directory, "marker");
    await writeFile(markerPath, appReady);
    const script = path.resolve("scripts/production-schema-deploy-handoff.mjs");

    execFileSync(process.execPath, [script, "--validate-marker", markerPath], { cwd: process.cwd() });
    execFileSync(process.execPath, [script, "--check", markerPath, TRAINING_MIGRATION_SHA, process.cwd()], { cwd: process.cwd() });
  // This validates the migration path once in-process and twice through the
  // deployed CLI, so allow headroom for the Windows Git subprocess cost.
  }, 30_000);

  it.each([
    ["wrong manifest", { manifestId: "unified-v4-republication-v1" }],
    ["wrong release SHA", { releaseSha: "f".repeat(40) }],
    ["wrong marker state", { state: "app-ready" }],
    ["missing run ID", { workflowRunId: "0" }],
    ["invalid attempt", { workflowRunAttempt: 0 }],
    ["malformed authorization", { authorizationId: "bad" }],
    ["malformed lineage", { lineageDigest: "not-a-digest" }],
    ["unacknowledged DDL spawn", { spawnState: "not-started" }],
  ])("fails closed for Training marker with %s", (_label, overrides) => {
    const compatibility = readGitCompatibility(process.cwd(), TRAINING_MIGRATION_SHA,
      TRAINING_MIGRATION_SHA, TRAINING_MUTATION_LEDGER_MANIFEST.id);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: trainingMutationMarkerText(overrides),
      deploySha: TRAINING_MIGRATION_SHA,
      ...compatibility,
    })).toThrow();
  });

  it("rejects a Training app SHA that differs from the migration SHA", () => {
    const compatibility = readGitCompatibility(process.cwd(), TRAINING_MIGRATION_SHA,
      TRAINING_MIGRATION_SHA, TRAINING_MUTATION_LEDGER_MANIFEST.id);
    expect(() => evaluateSchemaDeployHandoff({
      markerText: trainingMutationMarkerText(),
      deploySha: "e".repeat(40),
      ...compatibility,
    })).toThrow(/deploy SHA to equal the exact migration release SHA/);
  });

  it("accepts only the exact acknowledged training session-context schema marker", () => {
    const plan = evaluateSchemaDeployHandoff({
      markerText: trainingSessionContextMarkerText(),
      deploySha: TRAINING_MIGRATION_SHA,
    });
    expect(plan.action).toBe("not-needed");
    expect(plan.marker).toMatchObject({
      manifestId: TRAINING_SESSION_CONTEXT_MANIFEST.id,
      releaseSha: TRAINING_MIGRATION_SHA,
      state: "schema-applied",
      spawnState: "started",
    });
    for (const overrides of [
      { releaseSha: "e".repeat(40) },
      { state: "app-ready" },
      { workflowRunId: "0" },
      { workflowRunAttempt: 0 },
      { authorizationId: "bad" },
      { lineageDigest: "not-a-digest" },
      { spawnState: "not-started" },
    ]) {
      expect(() => evaluateSchemaDeployHandoff({
        markerText: trainingSessionContextMarkerText(overrides),
        deploySha: TRAINING_MIGRATION_SHA,
      })).toThrow();
    }
  });

  it("rejects an altered Training migration checksum at the declared origin", async () => {
    const migration = TRAINING_MUTATION_LEDGER_MANIFEST.migrations[0];
    const migrationPath = `prisma/migrations/${migration.name}/migration.sql`;
    const original = await readFile(path.join(process.cwd(), migrationPath), "utf8");
    const altered = await createTrainingMutationHandoffRepository({
      file: migrationPath,
      contents: `${original}\n-- altered release fixture\n`,
    });
    expect(() => readGitCompatibility(altered.repository, altered.candidateSha,
      altered.candidateSha, TRAINING_MUTATION_LEDGER_MANIFEST.id)).toThrow(/differs from its reviewed checksum/);
  });

  it("rejects a Training runtime change between migration and app SHA", async () => {
    const runtimePath = "src/modules/training/training.service.ts";
    const original = await readFile(path.join(process.cwd(), runtimePath), "utf8");
    const altered = await createTrainingMutationHandoffRepository({
      file: runtimePath,
      contents: `${original}\n// compatibility fixture\n`,
    });
    expect(() => readGitCompatibility(altered.repository, altered.candidateSha,
      TRAINING_MIGRATION_SHA, TRAINING_MUTATION_LEDGER_MANIFEST.id)).toThrow(/src differs from the migration origin/);
  }, 30_000);

  it("rejects a V3 Training marker whose deploy SHA was changed", () => {
    const compatibility = readGitCompatibility(process.cwd(), TRAINING_MIGRATION_SHA,
      TRAINING_MIGRATION_SHA, TRAINING_MUTATION_LEDGER_MANIFEST.id);
    const plan = evaluateSchemaDeployHandoff({
      markerText: trainingMutationMarkerText(),
      deploySha: TRAINING_MIGRATION_SHA,
      ...compatibility,
    });
    const tampered = plan.bytes.toString("utf8").replace(
      `deploySha=${TRAINING_MIGRATION_SHA}`,
      `deploySha=${"e".repeat(40)}`,
    );
    expect(() => renderSchemaDeployTransition(tampered, "app-ready")).toThrow(/provenance is not admitted/);
  });

  it("rejects V3 Training provenance fields changed without changing the source marker digest", () => {
    const compatibility = readGitCompatibility(process.cwd(), TRAINING_MIGRATION_SHA,
      TRAINING_MIGRATION_SHA, TRAINING_MUTATION_LEDGER_MANIFEST.id);
    const plan = evaluateSchemaDeployHandoff({
      markerText: trainingMutationMarkerText(),
      deploySha: TRAINING_MIGRATION_SHA,
      ...compatibility,
    });
    const tamperedFields = [
      ["workflowRunId", "40123456791"],
      ["workflowRunAttempt", "2"],
      ["authorizationId", "training-migration-authorization-02"],
      ["lineageDigest", "c".repeat(64)],
    ];
    for (const [field, replacement] of tamperedFields) {
      const original = plan.bytes.toString("utf8");
      const prefix = `${field}=`;
      const tampered = original.replace(new RegExp(`^${field}=.*$`, "m"), `${prefix}${replacement}`);
      expect(tampered).not.toBe(original);
      expect(() => evaluateSchemaDeployHandoff({
        markerText: tampered,
        deploySha: TRAINING_MIGRATION_SHA,
        ...compatibility,
      })).toThrow(/provenance is malformed/);
    }
  });

  it.skipIf(process.platform === "win32")("writes once, replays the same candidate, and blocks a concurrent lock", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-schema-handoff-"));
    directories.push(directory);
    const markerPath = path.join(directory, "marker");
    const original = markerText();
    await writeFile(markerPath, original, { flag: "wx" });
    await expect(applySchemaDeployHandoff({
      markerPath, deploySha: DEPLOY_SHA, repo: process.cwd(),
      beforeRename: () => { throw new Error("interrupted before publish"); },
    })).rejects.toThrow(/interrupted before publish/);
    expect(await readFile(markerPath, "utf8")).toBe(original);
    const published = await applySchemaDeployHandoff({ markerPath, deploySha: DEPLOY_SHA, repo: process.cwd() });
    expect(published.action).toBe("write");
    expect(parseSchemaDeployMarker(await readFile(markerPath)).marker.deploySha).toBe(DEPLOY_SHA);
    const replay = await applySchemaDeployHandoff({ markerPath, deploySha: DEPLOY_SHA, repo: process.cwd() });
    expect(replay.action).toBe("replay");
    await writeFile(`${markerPath}.lock`, "", { flag: "wx" });
    await writeFile(markerPath, original);
    await expect(applySchemaDeployHandoff({ markerPath, deploySha: DEPLOY_SHA, repo: process.cwd() })).rejects.toThrow(/already active or interrupted/);
  });
});
