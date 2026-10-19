import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST, TRAINING_MUTATION_LEDGER_MANIFEST } from "./production-migration-manifests.mjs";
import { PROGRAMLESS_STRENGTH_SESSIONS_CAPABILITY, readProductionAppCapabilitiesAtSha } from "./production-app-capabilities.mjs";

export const SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA = "62b6961dde7036100c8af7281e7bfab75bb662db";
export const V4_REPUBLICATION_MIGRATION_ORIGIN_SHA = "8b4a195e8afb67c0a913d0175a030e01cc665732";
export const SCHEMA_DEPLOY_HANDOFF_PROVENANCE = Object.freeze({
  manifestId: "active-energy-unified-v2",
  workflowRunId: "38069108209",
  workflowRunAttempt: 1,
  authorizationId: "123dcfca-64a4-4708-8c3a-3a9f59ed5412",
  lineageDigest: "877d195c9600f760d821eeb8f6f770e307292671a94e549e46dca8c344ee3e2e",
  spawnState: "started",
});
export const V4_REPUBLICATION_HANDOFF_PROVENANCE = Object.freeze({
  manifestId: "unified-v4-republication-v1",
  workflowRunId: "38447647403",
  workflowRunAttempt: 1,
  authorizationId: "4c990873-d8d1-492b-a73d-ca36823e6b79",
  lineageDigest: "ccf2a37b8f255337760cb2156385bac434650fba70af32fe9fc73c0b8e414768",
  spawnState: "started",
});

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const V4_REPUBLICATION_MANIFEST_ID = "unified-v4-republication-v1";
const DYNAMIC_WORKOUT_MANIFEST_ID = DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id;
const TRAINING_MUTATION_LEDGER_MANIFEST_ID = TRAINING_MUTATION_LEDGER_MANIFEST.id;
const DYNAMIC_WORKOUT_NON_RUNTIME_PATH = /^(?:tests\/|docs\/development\/)/;
const V3_STATES = new Set(["schema-applied", "app-ready", "v4-ready", "database-restored", "rollback-app-ready"]);
const DENIED_PATH = /^(?:prisma\/|public\/|scripts\/unified-v[34]|scripts\/physiology|docker-compose(?:\.prod)?\.yml$|package(?:-lock)?\.json$|next\.config\.[^/]+$|tsconfig(?:\.[^/]+)?\.json$)/;
const ALLOWED_PATH = /^(?:\.github\/workflows\/|tests\/|scripts\/production-release-marker\.(?:sh|mjs)$|scripts\/production-schema-deploy-handoff\.mjs$|scripts\/production-traffic-cutover\.sh$|scripts\/production-full-history-recalculate\.ts$|src\/app\/api\/forecast\/(?:action\/)?route\.ts$|src\/app\/api\/v1\/model\/recalculate\/route\.ts$|src\/lib\/logger\.ts$|src\/modules\/model-episodes\/(?:full-history-recalculation\.service|transient-exercise-water-episode-time-v2)\.ts$|src\/modules\/training\/experimental-transient-exercise-water-shadow\.service\.ts$|Dockerfile$)/;
const V4_UNBOUND_NON_RUNTIME_PATH = /^(?:tests\/|scripts\/production-schema-deploy-handoff\.mjs$|scripts\/production-v4-fingerprint-forensics\.(?:mjs|d\.mts)$)/;
const V4_RETIRED_WORKFLOW_PATH = ".github/workflows/activate-unified-v4-production.yml";
/** Exact audited Git blobs admitted for this deploy-only compatibility handoff. */
const CONTENT_BOUND_PATHS = Object.freeze({
  "docs/development/production-deploy.md": Object.freeze({
    migrationOriginBlob: "6096de9b780800654046c63c369643a310d5bb56",
    deployBlob: "b1a26cce30fb69fddde0d9fe81dd3bc26e342678",
  }),
  "scripts/ci/production-deploy-gate.ts": Object.freeze({
    migrationOriginBlob: "8d0d5e1d0a7c291daae0ff9cd6a970cfb3085083",
    deployBlob: "451319d5792e92fac02757ad8396c531ad5f19bb",
  }),
  "scripts/production-route-primitives.sh": Object.freeze({
    migrationOriginBlob: "65a51f97bf404d9353b45b1fc33725cb7a582daa",
    deployBlob: "001b5a5de48a17db06ab7e61731b184a3c82dc83",
  }),
  "scripts/deploy.sh": Object.freeze({
    migrationOriginBlob: "14e4caa5645ce8b95c16ecc03b3937bd0e60a1e3",
    deployBlob: "4844bdc0b586f29dbc3b60952717e249a04bbbbc",
  }),
  "scripts/production-forward-resume.mjs": Object.freeze({
    migrationOriginBlob: "2c07e0636146caaa5bfef69522f351c4e37aa13d",
    deployBlob: "43373e740cdad93d6f88c37c565288b2db1ad70d",
  }),
  "scripts/github-forward-resume-evidence.mjs": Object.freeze({
    migrationOriginBlob: "b62a7e09fd871e68829e9fad3902510a9e3bd6ca",
    deployBlob: "9d76e1612f86f700c5e3950fc67c77f0fa6c7912",
  }),
  "scripts/production-app-container-health-wait.sh": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "b99a87d861d5471336bd0d75f4df49436237df7c",
  }),
  "scripts/production-checkout-diagnostic.sh": Object.freeze({
    migrationOriginBlob: "f19687c65d7e9d3b744890f377ebf6f0c80eebf9",
    deployBlob: "7256cf45844deade0685f82eb470bf79a396c497",
  }),
});
/** Exact executable blobs reviewed for the V4 app-ready migration-origin handoff. */
const V4_CONTENT_BOUND_PATHS = Object.freeze({
  "src/modules/activity/active-energy-materialization.ts": Object.freeze({
    migrationOriginBlob: "ec066afe744ec0de47f8c5503266764eff311608",
    deployBlob: "f163d3116638e44a6e42e10fac261f57acd11579",
  }),
  "src/modules/activity/active-energy-publication.ts": Object.freeze({
    migrationOriginBlob: "3c1fcfec0ca73ac6b599ae6a7527c067b77adb2f",
    deployBlob: "b76617954f03b700d7a783aa2f30a11388b769c9",
  }),
  "src/modules/health/health.repository.ts": Object.freeze({
    migrationOriginBlob: "a8040b6f8a0eede730c67ba1a4df90063570bc13",
    deployBlob: "e9e2b342d3c26cb64f28ff9f19b136bbe9b557af",
  }),
  ".github/workflows/production-migration-preflight.yml": Object.freeze({
    migrationOriginBlob: "02a0a107c004dfd169363a1ac98abceb9e1674d0",
    deployBlob: "b66ed02fae2efb86dc540ff7a3809bc93ee85a6b",
  }),
  ".github/workflows/production-migration-safety-ci.yml": Object.freeze({
    migrationOriginBlob: "38c58d25e8cb3a0aa389b4003c252a64481e584d",
    deployBlob: "c07c2785d8f60993f63d7b779135d9d628834077",
  }),
  "src/app/api/forecast/action/route.ts": Object.freeze({
    migrationOriginBlob: "f50deac8061cff227dba477182472e44ddff4090",
    deployBlob: "73c6c1f6d0edd4b6ae3b7c82fdef73419b36c219",
  }),
  "src/modules/model-forecast/forecast-ui.ts": Object.freeze({
    migrationOriginBlob: "5d4faf2fd247f2abcc0d5889ba03917d4e2ace70",
    deployBlob: "cfc853f1aeb319e0acc9910025573336478d7496",
  }),
  "src/app/api/forecast/route.ts": Object.freeze({
    migrationOriginBlob: "266d7f80a79f298e413d1153685083d2b3dfe84a",
    deployBlob: "a629fb980be4dbc00209536b54882432759f916e",
  }),
  "src/app/api/v1/model/recalculate/route.ts": Object.freeze({
    migrationOriginBlob: "132d6eb4822d40d8698a17b1586a06cb77573e7d",
    deployBlob: "dd6e997d42043d8acf93c59f485b4224cea359ea",
  }),
  "src/lib/logger.ts": Object.freeze({
    migrationOriginBlob: "0b4e09be4aa48424027e229e14bbb090624881bf",
    deployBlob: "fdaccd1cd0c526a4b1b1415002bd09ea27ec7f5a",
  }),
  "docs/development/production-deploy.md": Object.freeze({
    migrationOriginBlob: "b1a26cce30fb69fddde0d9fe81dd3bc26e342678",
    deployBlob: "15ed255f4cf38799807a84cb5b4d231269552fdf",
  }),
  ".github/workflows/deploy-production.yml": Object.freeze({
    migrationOriginBlob: "1be0ba2dc8fcfe2c34a97b39ae1d5d0fde32404f",
    deployBlob: "b4955059fc3cae0d94abbd2656c99b51800caad7",
  }),
  "scripts/ci/production-safety-postgres-smoke.mjs": Object.freeze({
    migrationOriginBlob: "1a0345e687fd3f604499502bdf98a07b606da07f",
    deployBlob: "7b973c5a5469393b5d23ba298041ef6d3933c036",
  }),
  "scripts/deploy.sh": Object.freeze({
    migrationOriginBlob: "4844bdc0b586f29dbc3b60952717e249a04bbbbc",
    deployBlob: "b3c119c2442d11361612228122718351d36beff4",
  }),
  "src/modules/health/health.service.ts": Object.freeze({
    migrationOriginBlob: "17a2e1c47b2b7fe1d0d7b968b9e91fffc51a8431",
    deployBlob: "089e266f3664b4aabe268888e6ac3a233d2d0515",
  }),
  "src/modules/model-episodes/experimental-glycogen-state-shadow.service.ts": Object.freeze({
    migrationOriginBlob: "0e61b01275a1905710adc1d7721db006596459b0",
    deployBlob: "8a2aa5e38d4ad224e862a271a3fa69d655ff0e9a",
  }),
  "src/modules/model-episodes/model-episode.service.ts": Object.freeze({
    migrationOriginBlob: "0d32af00d8fa7bf4228cb87c434d85492b430d82",
    deployBlob: "0c26958724115a8af43081cb127350213ece1488",
  }),
  "src/modules/model-episodes/physiology-v7-persistence.repository.ts": Object.freeze({
    migrationOriginBlob: "07e75f6a1393cdb8cae8f9c593575930a124d394",
    deployBlob: "931fafdc488b460a080588ec7b981f08befd537f",
  }),
  "src/modules/profile/experimental-stepper-active-energy-shadow.service.ts": Object.freeze({
    migrationOriginBlob: "b4ec529a9755c9a3b15ea2b6c9ba19216bd6e888",
    deployBlob: "5244ce9f1d1092a881776232128464d8d6705127",
  }),
  "src/modules/training/experimental-strength-energy-shadow.service.ts": Object.freeze({
    migrationOriginBlob: "2f556ff6817db3dff23a09d0ff15ba8254543551",
    deployBlob: "4e9f5da57b7b60c0c553c35f62c12d994c9f9126",
  }),
  "src/modules/training/training.service.ts": Object.freeze({
    migrationOriginBlob: "d036d589304338b07d43c1b1eebb8314910b3acb",
    deployBlob: "408efc5996e9ad701057ab7f261d0cb045541ff4",
  }),
  "scripts/production-db-data-fingerprint.sh": Object.freeze({
    migrationOriginBlob: "101ecf34dc5751fc431a5b88f787d7ebc3e98fde",
    deployBlob: "fff493643ecb171049893ecfc935773a4bcdaac5",
  }),
  "scripts/production-release-marker.sh": Object.freeze({
    migrationOriginBlob: "40bdb77377cfe02ce8bedd9760d82f21befc128e",
    deployBlob: "4a625b3599946405dac0fe0276d375e12283c22c",
  }),
  "scripts/production-v4-post-ddl-backup-host.sh": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "76782d626c633a37c3de2330a6ef1d58df67d0d0",
  }),
  "scripts/github-no-app-preflight-evidence.mjs": Object.freeze({
    migrationOriginBlob: "b98263494d504228b1fdb207a249d5b9f3f77d5e",
    deployBlob: "954cc02644a9c46cb3b3e7c2d73f73385a9c0eae",
  }),
  "scripts/production-migration-preflight.mjs": Object.freeze({
    migrationOriginBlob: "1f83a82cff68b3b9bbf3669156ae15be2f0e4a9b",
    deployBlob: "dfb007dfde094aa359dc0c5f0260b820e1a908de",
  }),
  "scripts/production-v4-recovery.mjs": Object.freeze({
    migrationOriginBlob: null,
    deployBlob: "af8e2e03ddac71d710f191ec2f221b31c3785a76",
  }),
  "scripts/production-writer-drain.mjs": Object.freeze({
    migrationOriginBlob: "f2e275e64e52089ac88351a695b2aad2d427e343",
    deployBlob: "19bce9311aa836b0347b832dc7d4042b1d26bd96",
  }),
  "scripts/production-traffic-cutover.sh": Object.freeze({
    migrationOriginBlob: "baeb3ff34c52c606a653d9e0c027c79d7b7c72da",
    deployBlob: "7b1d61f367d1b2e909fe435d50a5cdcdc736247f",
  }),
  "scripts/unified-v4-activate-replay.ts": Object.freeze({
    migrationOriginBlob: "2bb3f1130241dcc0e354e70a60f5284452849a12",
    deployBlob: "c61af4cc64a6a4e7ed2b74315310d79d8b40f050",
  }),
  "src/modules/model-episodes/unified-rollout-v4.service.ts": Object.freeze({
    migrationOriginBlob: "2532cef483cb8bdec332cc22782a30d2a0ba178b",
    deployBlob: "d5b445b418a1c24637c6439d14938c661f48a619",
  }),
  "src/modules/model-episodes/unified-experimental-physiology-state.service.ts": Object.freeze({
    migrationOriginBlob: "0c7850cbb866f62d20a4a35ab384f18906a67ef8",
    deployBlob: "d0f9f7ef0be1f0b0f4ad3efb1abbcac538f8b191",
  }),
  "src/modules/training/experimental-transient-exercise-water-shadow.service.ts": Object.freeze({
    migrationOriginBlob: "4291768358207464a59476a75e3897e5a85f9332",
    deployBlob: "8547fdaa05b721c4dcd578c2b1c096a53e52c729",
  }),
});
/** Schema/runtime identity that must remain identical to the migration origin. */
const CRITICAL_TREES = ["prisma"];
const CRITICAL_FILES = ["docker-compose.prod.yml", "package.json", "package-lock.json"];
const ADVANCEABLE_V3_STATES = new Set(["schema-applied", "app-ready"]);
const DYNAMIC_WORKOUT_CRITICAL_TREES = Object.freeze([...CRITICAL_TREES, "src/modules/training", ".github/workflows"]);
const DYNAMIC_WORKOUT_CRITICAL_FILES = Object.freeze([
  ...CRITICAL_FILES,
  "scripts/deploy.sh",
  "scripts/production-release-marker.sh",
  "scripts/production-release-marker.mjs",
  "scripts/production-migration-manifests.mjs",
  "scripts/production-app-capabilities.mjs",
  "scripts/production-app-capabilities.json",
]);
const TRAINING_MUTATION_LEDGER_CRITICAL_TREES = Object.freeze(["prisma", "src", ".github/workflows"]);
const TRAINING_MUTATION_LEDGER_CRITICAL_FILES = Object.freeze([
  "docker-compose.prod.yml",
  "package.json",
  "package-lock.json",
  "scripts/deploy.sh",
  "scripts/production-release-marker.mjs",
  "scripts/production-release-marker.sh",
  "scripts/production-migration-manifests.mjs",
  "scripts/production-schema-deploy-handoff.mjs",
]);

function reject(message) {
  throw new Error(`Schema deploy handoff blocked: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function field(line, key) {
  const prefix = `${key}=`;
  if (!line.startsWith(prefix)) reject(`marker field ${key} is not canonical`);
  return line.slice(prefix.length);
}

export function parseSchemaDeployMarker(text) {
  const bytes = Buffer.from(String(text ?? ""), "utf8");
  if (bytes.length === 0 || bytes.length > 4096) reject("marker is missing or oversized");
  const lines = bytes.toString("utf8").replace(/\n$/, "").split("\n");
  if (lines.length === 9 && lines[0] === "schemaVersion=2") {
    const marker = {
      schemaVersion: 2,
      manifestId: field(lines[1], "manifestId"),
      releaseSha: field(lines[2], "releaseSha"),
      state: field(lines[3], "state"),
      workflowRunId: field(lines[4], "workflowRunId"),
      workflowRunAttempt: Number(field(lines[5], "workflowRunAttempt")),
      authorizationId: field(lines[6], "authorizationId"),
      lineageDigest: field(lines[7], "lineageDigest"),
      spawnState: field(lines[8], "spawnState"),
    };
    return { marker, digest: sha256(bytes), bytes };
  }
  if (lines.length === 12 && lines[0] === "schemaVersion=3") {
    const marker = {
      schemaVersion: 3,
      manifestId: field(lines[1], "manifestId"),
      migrationOriginSha: field(lines[2], "migrationOriginSha"),
      deploySha: field(lines[3], "deploySha"),
      state: field(lines[4], "state"),
      workflowRunId: field(lines[5], "workflowRunId"),
      workflowRunAttempt: Number(field(lines[6], "workflowRunAttempt")),
      authorizationId: field(lines[7], "authorizationId"),
      lineageDigest: field(lines[8], "lineageDigest"),
      spawnState: field(lines[9], "spawnState"),
      sourceMarkerDigest: field(lines[10], "sourceMarkerDigest"),
      compatibilityDigest: field(lines[11], "compatibilityDigest"),
    };
    return { marker, digest: sha256(bytes), bytes };
  }
  reject("marker schema is not an admitted migration or deploy handoff");
}

function provenanceMatches(marker, pinned) {
  return marker.manifestId === pinned.manifestId
    && marker.workflowRunId === pinned.workflowRunId
    && marker.workflowRunAttempt === pinned.workflowRunAttempt
    && marker.authorizationId === pinned.authorizationId
    && marker.lineageDigest === pinned.lineageDigest
    && marker.spawnState === pinned.spawnState;
}

function v4SourceMarkerMatches(marker) {
  return marker.schemaVersion === 2
    && marker.releaseSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && marker.state === "app-ready"
    && provenanceMatches(marker, V4_REPUBLICATION_HANDOFF_PROVENANCE);
}

function dynamicWorkoutSourceMarkerMatches(marker) {
  return marker.schemaVersion === 2
    && marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID
    && SHA.test(String(marker.releaseSha ?? ""))
    && marker.state === "app-ready"
    && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
    && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
    && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
    && DIGEST.test(String(marker.lineageDigest ?? ""))
    && marker.spawnState === "started";
}

function trainingMutationSourceMarkerMatches(marker) {
  return marker.schemaVersion === 2
    && marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID
    && SHA.test(String(marker.releaseSha ?? ""))
    && marker.state === "schema-applied"
    && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
    && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
    && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
    && DIGEST.test(String(marker.lineageDigest ?? ""))
    && marker.spawnState === "started";
}

function trainingMutationSourceDigest(marker) {
  const sourceText = [
    "schemaVersion=2",
    `manifestId=${TRAINING_MUTATION_LEDGER_MANIFEST_ID}`,
    `releaseSha=${marker.migrationOriginSha}`,
    "state=schema-applied",
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    "spawnState=started",
    "",
  ].join("\n");
  return sha256(Buffer.from(sourceText, "utf8"));
}

function admittedV3Marker(marker) {
  if (marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID) {
    return SHA.test(String(marker.migrationOriginSha ?? ""))
      && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
      && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
      && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
      && DIGEST.test(String(marker.lineageDigest ?? ""));
  }
  if (marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID) {
    return SHA.test(String(marker.migrationOriginSha ?? ""))
      && marker.deploySha === marker.migrationOriginSha
      && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
      && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
      && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
      && DIGEST.test(String(marker.lineageDigest ?? ""))
      && DIGEST.test(String(marker.sourceMarkerDigest ?? ""))
      && trainingMutationSourceDigest(marker) === marker.sourceMarkerDigest;
  }
  if (marker.migrationOriginSha === SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA) {
    return marker.manifestId === SCHEMA_DEPLOY_HANDOFF_PROVENANCE.manifestId
      && provenanceMatches(marker, SCHEMA_DEPLOY_HANDOFF_PROVENANCE);
  }
  return marker.migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && provenanceMatches(marker, V4_REPUBLICATION_HANDOFF_PROVENANCE);
}

export function compatibilityDigest(input) {
  const evidence = {
    migrationOriginSha: input.migrationOriginSha,
    deploySha: input.deploySha,
    changedPaths: [...input.changedPaths].sort(),
    criticalObjects: input.criticalObjects,
  };
  const contentBoundPaths = input.changedPathObjects ?? {};
  if (Object.keys(contentBoundPaths).length > 0) {
    evidence.changedPathObjects = Object.fromEntries(Object.keys(contentBoundPaths).sort().map((objectPath) => [
      objectPath,
      {
        migrationOriginBlob: contentBoundPaths[objectPath].migrationOriginBlob,
        deployBlob: contentBoundPaths[objectPath].deployBlob,
      },
    ]));
  }
  return sha256(Buffer.from(JSON.stringify(evidence), "utf8"));
}

export function serializeSchemaDeployHandoff(marker) {
  const text = [
    "schemaVersion=3",
    `manifestId=${marker.manifestId}`,
    `migrationOriginSha=${marker.migrationOriginSha}`,
    `deploySha=${marker.deploySha}`,
    `state=${marker.state}`,
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    `spawnState=${marker.spawnState}`,
    `sourceMarkerDigest=${marker.sourceMarkerDigest}`,
    `compatibilityDigest=${marker.compatibilityDigest}`,
  ].join("\n") + "\n";
  const parsed = parseSchemaDeployMarker(text);
  if (parsed.marker.schemaVersion !== 3 || parsed.marker.migrationOriginSha !== marker.migrationOriginSha
    || parsed.marker.deploySha !== marker.deploySha || parsed.marker.state !== marker.state) {
    reject("serialized handoff did not round-trip");
  }
  return Buffer.from(text, "utf8");
}

function assertCompatibleChangedPaths(changedPaths, changedPathObjects, contentBoundPaths = CONTENT_BOUND_PATHS, unboundNonRuntimePath) {
  if (!Array.isArray(changedPaths) || !changedPaths.every((changed) => typeof changed === "string")) {
    reject("compatibility evidence is incomplete");
  }
  if (changedPathObjects !== undefined
    && (!changedPathObjects || typeof changedPathObjects !== "object" || Array.isArray(changedPathObjects))) {
    reject("content-bound path evidence is malformed");
  }
  if (new Set(changedPaths).size !== changedPaths.length) reject("compatibility path evidence is duplicated");
  const contentBoundChangedPaths = changedPaths.filter((changed) => Object.hasOwn(contentBoundPaths, changed)).sort();
  const suppliedContentBoundPaths = changedPathObjects && typeof changedPathObjects === "object" && !Array.isArray(changedPathObjects)
    ? Object.keys(changedPathObjects).sort()
    : [];
  if (contentBoundChangedPaths.length !== suppliedContentBoundPaths.length
    || contentBoundChangedPaths.some((objectPath, index) => objectPath !== suppliedContentBoundPaths[index])) {
    reject("content-bound path evidence is incomplete or unexpected");
  }
  for (const changed of changedPaths) {
    const reviewedBlobs = contentBoundPaths[changed];
    if (changed.length === 0 || (!reviewedBlobs && DENIED_PATH.test(changed))) {
      reject(`path ${changed} is outside the reviewed deploy compatibility allowlist`);
    }
    const proof = changedPathObjects?.[changed];
    if (reviewedBlobs) {
      if (!proof || typeof proof !== "object" || Array.isArray(proof)
        || Object.keys(proof).sort().join(",") !== "deployBlob,migrationOriginBlob"
        || (reviewedBlobs.migrationOriginBlob === null
          ? proof.migrationOriginBlob !== null
          : typeof proof.migrationOriginBlob !== "string" || !/^[a-f0-9]{40}$/.test(proof.migrationOriginBlob))
        || typeof proof.deployBlob !== "string" || !/^[a-f0-9]{40}$/.test(proof.deployBlob)
        || proof.migrationOriginBlob !== reviewedBlobs.migrationOriginBlob
        || proof.deployBlob !== reviewedBlobs.deployBlob) {
        reject(`path ${changed} does not match its exact reviewed content binding`);
      }
      continue;
    }
    if (unboundNonRuntimePath) {
      if (unboundNonRuntimePath.test(changed)) continue;
      reject(`path ${changed} is not content-bound for this V4 deploy handoff`);
    }
    if (ALLOWED_PATH.test(changed)) continue;
    reject(`path ${changed} is outside the reviewed deploy compatibility allowlist`);
  }
}

function assertCriticalObjects(criticalObjects, trees = CRITICAL_TREES, files = CRITICAL_FILES) {
  if (!criticalObjects || typeof criticalObjects !== "object" || Array.isArray(criticalObjects)) {
    reject("compatibility evidence is incomplete");
  }
  for (const objectPath of [...trees, ...files]) {
    if (typeof criticalObjects[objectPath] !== "string" || !/^[a-f0-9]{40}$/.test(criticalObjects[objectPath])) {
      reject(`critical object proof for ${objectPath} is incomplete`);
    }
  }
}

function buildHandoffWrite({
  observed,
  migrationOriginSha,
  deploySha,
  state,
  changedPaths,
  changedPathObjects,
  criticalObjects,
  workflowRunId,
  workflowRunAttempt,
  authorizationId,
  lineageDigest,
  spawnState,
  provenance,
  contentBoundPaths,
  unboundNonRuntimePath,
}) {
  assertCompatibleChangedPaths(changedPaths, changedPathObjects, contentBoundPaths, unboundNonRuntimePath);
  assertCriticalObjects(criticalObjects);
  const digest = compatibilityDigest({
    migrationOriginSha,
    deploySha,
    changedPaths,
    changedPathObjects,
    criticalObjects,
  });
  const next = {
    manifestId: provenance.manifestId,
    migrationOriginSha,
    deploySha,
    state,
    workflowRunId,
    workflowRunAttempt,
    authorizationId,
    lineageDigest,
    spawnState,
    sourceMarkerDigest: observed.digest,
    compatibilityDigest: digest,
  };
  return {
    action: "write",
    marker: next,
    sourceDigest: observed.digest,
    compatibilityDigest: digest,
    bytes: serializeSchemaDeployHandoff(next),
  };
}

export function evaluateSchemaDeployHandoff({ markerText, deploySha, changedPaths, changedPathObjects, isAncestor, criticalObjects }) {
  if (!SHA.test(String(deploySha ?? ""))) reject("deploy candidate SHA is malformed");
  const observed = parseSchemaDeployMarker(markerText);
  const marker = observed.marker;
  if (marker.schemaVersion === 2 && marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID) {
    if (marker.state === "schema-applied" && marker.releaseSha === deploySha
      && marker.spawnState === "started" && /^[1-9][0-9]{0,19}$/.test(String(marker.workflowRunId ?? ""))
      && Number.isSafeInteger(marker.workflowRunAttempt) && marker.workflowRunAttempt > 0
      && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
      && DIGEST.test(String(marker.lineageDigest ?? ""))) {
      return { action: "not-needed", marker, sourceDigest: observed.digest };
    }
    if (!dynamicWorkoutSourceMarkerMatches(marker)) {
      reject("programless-workout migration marker run, lineage, origin, or state is not admitted");
    }
    assertCompatibleChangedPaths(changedPaths, changedPathObjects, Object.freeze({}), DYNAMIC_WORKOUT_NON_RUNTIME_PATH);
    assertCriticalObjects(criticalObjects, DYNAMIC_WORKOUT_CRITICAL_TREES, DYNAMIC_WORKOUT_CRITICAL_FILES);
    if (isAncestor !== true) reject("deploy candidate is not a descendant of the programless-workout migration origin");
    if (deploySha === marker.releaseSha) reject("an app-ready migration marker cannot be reused as a schema-applied deploy marker");
    return buildHandoffWrite({
      observed,
      migrationOriginSha: marker.releaseSha,
      deploySha,
      state: "schema-applied",
      changedPaths,
      changedPathObjects,
      criticalObjects,
      workflowRunId: marker.workflowRunId,
      workflowRunAttempt: marker.workflowRunAttempt,
      authorizationId: marker.authorizationId,
      lineageDigest: marker.lineageDigest,
      spawnState: marker.spawnState,
      provenance: { manifestId: DYNAMIC_WORKOUT_MANIFEST_ID },
      contentBoundPaths: Object.freeze({}),
      unboundNonRuntimePath: DYNAMIC_WORKOUT_NON_RUNTIME_PATH,
    });
  }
  if (marker.schemaVersion === 2 && marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID) {
    if (!trainingMutationSourceMarkerMatches(marker)) {
      reject("Training migration marker run, attempt, authorization lineage, release SHA, or state is not admitted");
    }
    if (deploySha !== marker.releaseSha) {
      reject("Training schema handoff requires the app deploy SHA to equal the exact migration release SHA");
    }
    assertCompatibleChangedPaths(changedPaths, changedPathObjects, Object.freeze({}));
    assertCriticalObjects(criticalObjects, TRAINING_MUTATION_LEDGER_CRITICAL_TREES, TRAINING_MUTATION_LEDGER_CRITICAL_FILES);
    if (isAncestor !== true) reject("Training app deploy is not the exact migration release commit");
    return buildHandoffWrite({
      observed,
      migrationOriginSha: marker.releaseSha,
      deploySha,
      state: "schema-applied",
      changedPaths,
      changedPathObjects,
      criticalObjects,
      workflowRunId: marker.workflowRunId,
      workflowRunAttempt: marker.workflowRunAttempt,
      authorizationId: marker.authorizationId,
      lineageDigest: marker.lineageDigest,
      spawnState: marker.spawnState,
      provenance: { manifestId: TRAINING_MUTATION_LEDGER_MANIFEST_ID },
      contentBoundPaths: Object.freeze({}),
    });
  }
  if (marker.schemaVersion === 2 && marker.manifestId === V4_REPUBLICATION_MANIFEST_ID
    && marker.releaseSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && marker.releaseSha === deploySha && marker.state === "schema-applied"
    && provenanceMatches(marker, V4_REPUBLICATION_HANDOFF_PROVENANCE)) {
    return { action: "not-needed", marker, sourceDigest: observed.digest };
  }
  if (v4SourceMarkerMatches(marker)) {
    assertCompatibleChangedPaths(changedPaths, changedPathObjects, V4_CONTENT_BOUND_PATHS, V4_UNBOUND_NON_RUNTIME_PATH);
    assertCriticalObjects(criticalObjects);
    if (isAncestor !== true) reject("deploy candidate is not a descendant of the V4 migration origin");
    if (deploySha === marker.releaseSha) reject("an app-ready migration marker cannot be reused as a schema-applied deploy marker");
    return buildHandoffWrite({
      observed,
      migrationOriginSha: marker.releaseSha,
      deploySha,
      state: "schema-applied",
      changedPaths,
      changedPathObjects,
      criticalObjects,
      workflowRunId: marker.workflowRunId,
      workflowRunAttempt: marker.workflowRunAttempt,
      authorizationId: marker.authorizationId,
      lineageDigest: marker.lineageDigest,
      spawnState: marker.spawnState,
      provenance: V4_REPUBLICATION_HANDOFF_PROVENANCE,
      contentBoundPaths: V4_CONTENT_BOUND_PATHS,
      unboundNonRuntimePath: V4_UNBOUND_NON_RUNTIME_PATH,
    });
  }
  if (marker.schemaVersion === 2 && marker.manifestId === V4_REPUBLICATION_MANIFEST_ID) {
    reject("V4 migration marker run, lineage, origin, or state does not match the admitted DDL execution");
  }
  if (marker.schemaVersion === 3) {
    if (!admittedV3Marker(marker) || !V3_STATES.has(marker.state)
      || marker.spawnState !== "started" || !DIGEST.test(marker.sourceMarkerDigest) || !DIGEST.test(marker.compatibilityDigest)) {
      reject("existing handoff provenance is malformed");
    }
    const dynamicWorkoutRelease = marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID;
    const trainingRelease = marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID;
    const contentBoundPaths = dynamicWorkoutRelease || trainingRelease ? Object.freeze({})
      : marker.migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA ? V4_CONTENT_BOUND_PATHS : CONTENT_BOUND_PATHS;
    const unboundNonRuntimePath = dynamicWorkoutRelease ? DYNAMIC_WORKOUT_NON_RUNTIME_PATH
      : marker.migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA ? V4_UNBOUND_NON_RUNTIME_PATH : undefined;
    assertCompatibleChangedPaths(changedPaths, changedPathObjects, contentBoundPaths, unboundNonRuntimePath);
    assertCriticalObjects(criticalObjects,
      dynamicWorkoutRelease ? DYNAMIC_WORKOUT_CRITICAL_TREES
        : trainingRelease ? TRAINING_MUTATION_LEDGER_CRITICAL_TREES : CRITICAL_TREES,
      dynamicWorkoutRelease ? DYNAMIC_WORKOUT_CRITICAL_FILES
        : trainingRelease ? TRAINING_MUTATION_LEDGER_CRITICAL_FILES : CRITICAL_FILES);
    if (isAncestor !== true) reject("deploy candidate is not a descendant of the migration origin");
    if (trainingRelease && marker.migrationOriginSha !== deploySha) {
      reject("Training handoff replay requires the exact same migration and app deploy SHA");
    }
    if (marker.deploySha === deploySha) {
      const recomputed = compatibilityDigest({
        migrationOriginSha: marker.migrationOriginSha,
        deploySha: marker.deploySha,
        changedPaths,
        changedPathObjects,
        criticalObjects,
      });
      if (marker.compatibilityDigest !== recomputed) {
        reject("existing handoff does not match this deploy candidate");
      }
      return { action: "replay", marker, sourceDigest: observed.digest, compatibilityDigest: recomputed };
    }
    if (!ADVANCEABLE_V3_STATES.has(marker.state)) {
      reject("existing handoff state cannot advance to another deploy candidate");
    }
    return buildHandoffWrite({
      observed,
      migrationOriginSha: marker.migrationOriginSha,
      deploySha,
      state: "schema-applied",
      changedPaths,
      changedPathObjects,
      criticalObjects,
      provenance: marker,
      contentBoundPaths,
      unboundNonRuntimePath,
      workflowRunId: marker.workflowRunId,
      workflowRunAttempt: marker.workflowRunAttempt,
      authorizationId: marker.authorizationId,
      lineageDigest: marker.lineageDigest,
      spawnState: marker.spawnState,
    });
  }
  if (!provenanceMatches(marker, SCHEMA_DEPLOY_HANDOFF_PROVENANCE)) reject("marker authorization, lineage, or migration provenance does not match the admitted release");
  if (marker.schemaVersion !== 2 || marker.state !== "schema-applied" || marker.releaseSha !== SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA) {
    reject("only the admitted schema-applied migration origin can be handed off");
  }
  if (deploySha === marker.releaseSha) return { action: "not-needed", marker, sourceDigest: observed.digest };
  if (isAncestor !== true) reject("deploy candidate is not a descendant of the migration origin");
  return buildHandoffWrite({
    observed,
    migrationOriginSha: marker.releaseSha,
    deploySha,
    state: "schema-applied",
    changedPaths,
    changedPathObjects,
    criticalObjects,
    workflowRunId: marker.workflowRunId,
    workflowRunAttempt: marker.workflowRunAttempt,
    authorizationId: marker.authorizationId,
    lineageDigest: marker.lineageDigest,
    spawnState: marker.spawnState,
    provenance: SCHEMA_DEPLOY_HANDOFF_PROVENANCE,
  });
}

export function validateSchemaDeployHandoffMarker(markerText) {
  const marker = parseSchemaDeployMarker(markerText).marker;
  if (marker.schemaVersion !== 3 || !V3_STATES.has(marker.state) || marker.spawnState !== "started"
    || !DIGEST.test(marker.sourceMarkerDigest) || !DIGEST.test(marker.compatibilityDigest)
    || !admittedV3Marker(marker)) {
    reject("schema deploy handoff marker provenance is not admitted");
  }
  return marker;
}

export function renderSchemaDeployTransition(markerText, state) {
  const marker = validateSchemaDeployHandoffMarker(markerText);
  if (!V3_STATES.has(state)) reject("transition is not a schema-deploy handoff state");
  return serializeSchemaDeployHandoff({ ...marker, state });
}

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function objectId(repo, sha, objectPath) {
  try {
    return git(repo, ["rev-parse", `${sha}:${objectPath}`]);
  } catch {
    reject(`required object ${objectPath} is absent at ${sha}`);
  }
}

function regularFileBlobId(repo, sha, objectPath, optional = false) {
  let listing;
  try {
    listing = git(repo, ["ls-tree", "-z", sha, "--", objectPath]);
  } catch {
    reject(`Git tree lookup failed for ${objectPath}`);
  }
  if (!listing) {
    if (optional) return null;
    reject(`required file ${objectPath} is absent at ${sha}`);
  }
  const [entry, rawListedPath] = listing.split("\t");
  const listedPath = rawListedPath?.replace(/\0$/, "");
  const match = /^100644 blob ([a-f0-9]{40})$/.exec(entry ?? "");
  if (!match || listedPath !== objectPath) reject(`required file ${objectPath} is not a regular non-executable blob at ${sha}`);
  return match[1];
}

function assertDynamicWorkoutOriginContract(repo, originSha) {
  const manifest = DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST;
  const expectedDirectories = [...manifest.requiredAppliedMigrations, ...manifest.migrations].map(({ name }) => name).sort();
  let directories;
  try {
    directories = git(repo, ["ls-tree", "-d", "--name-only", `${originSha}:prisma/migrations`]).split("\n").filter(Boolean).sort();
  } catch {
    reject("programless-workout migration origin does not contain its reviewed Prisma migration tree");
  }
  if (JSON.stringify(directories) !== JSON.stringify(expectedDirectories)) {
    reject("programless-workout migration origin does not match the exact reviewed migration directory set");
  }
  for (const migration of [...manifest.requiredAppliedMigrations, ...manifest.migrations]) {
    let bytes;
    try { bytes = execFileSync("git", ["cat-file", "blob", `${originSha}:prisma/migrations/${migration.name}/migration.sql`], { cwd: repo }); }
    catch { reject(`programless-workout migration ${migration.name} is unavailable at the migration origin`); }
    if (sha256(bytes) !== migration.sha256) reject(`programless-workout migration ${migration.name} differs from its reviewed checksum`);
  }
  try {
    const contract = readProductionAppCapabilitiesAtSha({ repositoryPath: repo, releaseSha: originSha });
    if (!contract.capabilities.includes(PROGRAMLESS_STRENGTH_SESSIONS_CAPABILITY)) {
      reject("programless-workout migration origin app is not certified for nullable program relations");
    }
  } catch (error) {
    if (String(error?.message ?? "").startsWith("Schema deploy handoff blocked:")) throw error;
    reject("programless-workout migration origin app capability contract is absent or invalid");
  }
}

function assertTrainingMutationOriginContract(repo, originSha) {
  const manifest = TRAINING_MUTATION_LEDGER_MANIFEST;
  const migrations = [...manifest.requiredAppliedMigrations, ...manifest.migrations];
  const expectedDirectories = migrations.map(({ name }) => name).sort();
  let directories;
  try {
    directories = git(repo, ["ls-tree", "-d", "--name-only", `${originSha}:prisma/migrations`]).split("\n").filter(Boolean).sort();
  } catch {
    reject("Training migration origin does not contain its reviewed Prisma migration tree");
  }
  if (JSON.stringify(directories) !== JSON.stringify(expectedDirectories)) {
    reject("Training migration origin does not match the exact predecessor-plus-seven migration directory set");
  }
  for (const migration of migrations) {
    let bytes;
    try { bytes = execFileSync("git", ["cat-file", "blob", `${originSha}:prisma/migrations/${migration.name}/migration.sql`], { cwd: repo }); }
    catch { reject(`Training migration ${migration.name} is unavailable at the migration origin`); }
    if (sha256(bytes) !== migration.sha256) reject(`Training migration ${migration.name} differs from its reviewed checksum`);
  }
  for (const objectPath of [...TRAINING_MUTATION_LEDGER_CRITICAL_TREES, ...TRAINING_MUTATION_LEDGER_CRITICAL_FILES]) {
    objectId(repo, originSha, objectPath);
  }
}

export function readGitCompatibility(repo, deploySha, migrationOriginSha = SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA, manifestId = null) {
  if (!SHA.test(deploySha)) reject("deploy candidate SHA is malformed");
  const origin = migrationOriginSha;
  const dynamicWorkoutRelease = manifestId === DYNAMIC_WORKOUT_MANIFEST_ID;
  const trainingRelease = manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID;
  try {
    git(repo, ["cat-file", "-e", `${origin}^{commit}`]);
    git(repo, ["cat-file", "-e", `${deploySha}^{commit}`]);
  } catch {
    reject("migration origin or deploy candidate commit is unavailable");
  }
  if (dynamicWorkoutRelease) assertDynamicWorkoutOriginContract(repo, origin);
  if (trainingRelease) assertTrainingMutationOriginContract(repo, origin);
  let isAncestor = false;
  try {
    git(repo, ["merge-base", "--is-ancestor", origin, deploySha]);
    isAncestor = true;
  } catch {
    isAncestor = false;
  }
  const changedPaths = git(repo, ["diff", "--name-only", "--no-renames", origin, deploySha])
    .split("\n").filter(Boolean).filter((objectPath) => {
      if (migrationOriginSha !== V4_REPUBLICATION_MIGRATION_ORIGIN_SHA || objectPath !== V4_RETIRED_WORKFLOW_PATH) return true;
      try {
        execFileSync("git", ["cat-file", "-e", `${deploySha}:${objectPath}`], { cwd: repo, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    });
  const criticalObjects = {};
  const criticalTrees = dynamicWorkoutRelease ? DYNAMIC_WORKOUT_CRITICAL_TREES
    : trainingRelease ? TRAINING_MUTATION_LEDGER_CRITICAL_TREES : CRITICAL_TREES;
  const criticalFiles = dynamicWorkoutRelease ? DYNAMIC_WORKOUT_CRITICAL_FILES
    : trainingRelease ? TRAINING_MUTATION_LEDGER_CRITICAL_FILES : CRITICAL_FILES;
  for (const objectPath of [...criticalTrees, ...criticalFiles]) {
    const originId = objectId(repo, origin, objectPath);
    const deployId = objectId(repo, deploySha, objectPath);
    if (originId !== deployId) reject(`${objectPath} differs from the migration origin`);
    criticalObjects[objectPath] = originId;
  }
  const changedPathObjects = {};
  const contentBoundPaths = dynamicWorkoutRelease ? Object.freeze({})
    : migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA ? V4_CONTENT_BOUND_PATHS : CONTENT_BOUND_PATHS;
  for (const objectPath of changedPaths.filter((changed) => Object.hasOwn(contentBoundPaths, changed))) {
    changedPathObjects[objectPath] = {
      migrationOriginBlob: regularFileBlobId(repo, origin, objectPath, true),
      deployBlob: regularFileBlobId(repo, deploySha, objectPath),
    };
  }
  return { changedPaths, changedPathObjects, isAncestor, criticalObjects };
}

function readCompatibilityForMarker(repo, marker, deploySha) {
  if (marker.schemaVersion === 2 && marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID) {
    assertDynamicWorkoutOriginContract(repo, marker.releaseSha);
    return readGitCompatibility(repo, deploySha, marker.releaseSha, DYNAMIC_WORKOUT_MANIFEST_ID);
  }
  if (marker.schemaVersion === 3 && marker.manifestId === DYNAMIC_WORKOUT_MANIFEST_ID
    && admittedV3Marker(marker)) {
    assertDynamicWorkoutOriginContract(repo, marker.migrationOriginSha);
    return readGitCompatibility(repo, deploySha, marker.migrationOriginSha, DYNAMIC_WORKOUT_MANIFEST_ID);
  }
  if (marker.schemaVersion === 2 && marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID
    && trainingMutationSourceMarkerMatches(marker)) {
    return readGitCompatibility(repo, deploySha, marker.releaseSha, TRAINING_MUTATION_LEDGER_MANIFEST_ID);
  }
  if (marker.schemaVersion === 3 && marker.manifestId === TRAINING_MUTATION_LEDGER_MANIFEST_ID
    && admittedV3Marker(marker)) {
    return readGitCompatibility(repo, deploySha, marker.migrationOriginSha, TRAINING_MUTATION_LEDGER_MANIFEST_ID);
  }
  if (marker.schemaVersion === 2 && v4SourceMarkerMatches(marker)) {
    return readGitCompatibility(repo, deploySha, V4_REPUBLICATION_MIGRATION_ORIGIN_SHA);
  }
  if (marker.schemaVersion === 3 && marker.migrationOriginSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && admittedV3Marker(marker)) {
    return readGitCompatibility(repo, deploySha, V4_REPUBLICATION_MIGRATION_ORIGIN_SHA);
  }
  return readGitCompatibility(repo, deploySha);
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function applySchemaDeployHandoff({ markerPath, deploySha, repo, beforeRename }) {
  const directory = path.dirname(path.resolve(markerPath));
  const details = await lstat(markerPath);
  if (!details.isFile() || details.isSymbolicLink()) reject("marker path is not a regular file");
  const current = parseSchemaDeployMarker(await readFile(markerPath));
  const exactMigrationMarker = current.marker.schemaVersion === 2
    && current.marker.manifestId === V4_REPUBLICATION_MANIFEST_ID
    && current.marker.releaseSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
    && current.marker.releaseSha === deploySha && current.marker.state === "schema-applied";
  const compatibility = exactMigrationMarker
    ? (provenanceMatches(current.marker, V4_REPUBLICATION_HANDOFF_PROVENANCE) ? {} : reject("exact V4 migration marker provenance is invalid"))
    : readCompatibilityForMarker(repo, current.marker, deploySha);
  const plan = evaluateSchemaDeployHandoff({ markerText: current.bytes, deploySha, ...compatibility });
  if (plan.action !== "write") return plan;
  const lockPath = `${markerPath}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") reject("another schema deploy handoff is already active or interrupted");
    throw error;
  });
  const temporary = path.join(directory, `.marker.handoff.${process.pid}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(plan.bytes);
      await handle.sync();
    } finally { await handle.close(); }
    if (beforeRename) await beforeRename();
    const latest = parseSchemaDeployMarker(await readFile(markerPath));
    if (latest.digest !== plan.sourceDigest) reject("marker changed during compatibility handoff");
    await rename(temporary, markerPath);
    await fsyncDirectory(directory);
    return { ...plan, digest: sha256(plan.bytes) };
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

async function main() {
  const [mode, markerPath, second, third] = process.argv.slice(2);
  if (mode === "--check" || mode === "--apply") {
    const deploySha = second;
    const repo = third || process.cwd();
    if (mode === "--check") {
      const markerText = await readFile(markerPath);
      const marker = parseSchemaDeployMarker(markerText).marker;
      const exactMigrationMarker = marker.schemaVersion === 2
        && marker.manifestId === V4_REPUBLICATION_MANIFEST_ID
        && marker.releaseSha === V4_REPUBLICATION_MIGRATION_ORIGIN_SHA
        && marker.releaseSha === deploySha && marker.state === "schema-applied";
      const compatibility = exactMigrationMarker
        ? (provenanceMatches(marker, V4_REPUBLICATION_HANDOFF_PROVENANCE) ? {} : reject("exact V4 migration marker provenance is invalid"))
        : readCompatibilityForMarker(repo, marker, deploySha);
      evaluateSchemaDeployHandoff({ markerText, deploySha, ...compatibility });
      return;
    }
    await applySchemaDeployHandoff({ markerPath, deploySha, repo });
    return;
  }
  if (mode === "--render-transition") {
    process.stdout.write(renderSchemaDeployTransition(await readFile(markerPath), second));
    return;
  }
  if (mode === "--validate-marker") {
    validateSchemaDeployHandoffMarker(await readFile(markerPath));
    return;
  }
  reject(`unknown mode ${mode ?? ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
