import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  SCHEMA_DEPLOY_HANDOFF_PROVENANCE, SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA,
  V4_REPUBLICATION_HANDOFF_PROVENANCE, V4_REPUBLICATION_MIGRATION_ORIGIN_SHA,
  applySchemaDeployHandoff, evaluateSchemaDeployHandoff, parseSchemaDeployMarker,
  readGitCompatibility, renderSchemaDeployTransition,
} from "../scripts/production-schema-deploy-handoff.mjs";

const DEPLOY_SHA = "71c091cd712cd3862d2cebe2714963917c9b5ca2";
const V4_MIGRATION_SHA = V4_REPUBLICATION_MIGRATION_ORIGIN_SHA;
const SCHEMA_COMPATIBLE_CHECKOUT_SHA = "9c7a6c9ac9270da52e6e2f5afe55094106f66e2d";
const provenance = SCHEMA_DEPLOY_HANDOFF_PROVENANCE;
const directories = [];

function ensureHandoffHistory() {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA, DEPLOY_SHA], { stdio: "ignore" });
  } catch {
    execFileSync("git", ["fetch", "--no-tags", "--depth=2", "origin", DEPLOY_SHA], { stdio: "ignore" });
  }
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
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
    const compatibility = readGitCompatibility(process.cwd(), candidateSha, V4_REPUBLICATION_MIGRATION_ORIGIN_SHA);
    expect(compatibility.isAncestor).toBe(true);
    expect(compatibility.changedPaths).toContain("scripts/unified-v4-activate-replay.ts");
    expect(compatibility.changedPaths).toContain("src/modules/model-episodes/unified-rollout-v4.service.ts");
    expect(compatibility.changedPaths).not.toContain(".github/workflows/activate-unified-v4-production.yml");
    const expectedV4Bindings = {
      "src/modules/activity/active-energy-materialization.ts": {
        migrationOriginBlob: "ec066afe744ec0de47f8c5503266764eff311608",
        deployBlob: "dd43f11d6e0a797a503bcaf70abf1aaa9eb58854",
      },
      "src/modules/activity/active-energy-publication.ts": {
        migrationOriginBlob: "3c1fcfec0ca73ac6b599ae6a7527c067b77adb2f",
        deployBlob: "e2b499afb6b7bbfc43d3d440aec8bd7b574269fd",
      },
      "scripts/production-full-history-recalculate.ts": {
        migrationOriginBlob: "4bce126c880af008295b4648701575c4b967da5e",
        deployBlob: "667df800575c02a31b3a338aa55d5b3236c06f1c",
      },
      ".github/workflows/ci.yml": {
        migrationOriginBlob: "ea1f581e1ee17e0e3ca6ed811f15ba51e94670a2",
        deployBlob: "5d174f4045ab34a2d5698199c879fd2bc6deb92d",
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
        deployBlob: "7ef145cc9b60362e0e96a4165cd23e1ccd4b567e",
      },
      "src/modules/model-episodes/unified-experimental-physiology-state.service.ts": {
        migrationOriginBlob: "0c7850cbb866f62d20a4a35ab384f18906a67ef8",
        deployBlob: "0539c383df630be9980a7b0967df9c13fe1709d9",
      },
      "src/modules/training/experimental-transient-exercise-water-shadow.service.ts": {
        migrationOriginBlob: "4291768358207464a59476a75e3897e5a85f9332",
        deployBlob: "04ec3b9aab6254ef70735d1c0cc37de7205c12b4",
      },
      "src/modules/model-episodes/unified-v4-derived-recovery.service.ts": {
        migrationOriginBlob: null,
        deployBlob: "badc2862271f11c38a6d629eb7f53f7289b3c61a",
      },
      "src/modules/model-episodes/physiology-v7-persistence.repository.ts": {
        migrationOriginBlob: "07e75f6a1393cdb8cae8f9c593575930a124d394",
        deployBlob: "97a3b66d8f6aa16152d24d1ed0102c219826cd2d",
      },
      "src/modules/profile/experimental-stepper-active-energy-shadow.service.ts": {
        migrationOriginBlob: "b4ec529a9755c9a3b15ea2b6c9ba19216bd6e888",
        deployBlob: "5244ce9f1d1092a881776232128464d8d6705127",
      },
      "src/modules/training/experimental-strength-energy-shadow.service.ts": {
        migrationOriginBlob: "2f556ff6817db3dff23a09d0ff15ba8254543551",
        deployBlob: "d71feacc49ec151295f9a783acad5becdb235ffd",
      },
      "src/modules/training/training.repository.ts": {
        migrationOriginBlob: "b3c1e67807030129a9175e1704ab47c5061c899a",
        deployBlob: "1f599db58a6098895ec4fd3a9bb3b4bd97592233",
      },
      "src/modules/training/training.service.ts": {
        migrationOriginBlob: "d036d589304338b07d43c1b1eebb8314910b3acb",
        deployBlob: "615d511b052d63eed76a455cdb9d5b3468435f2f",
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
  });

  it("blocks wrong V4 run lineage, manifest, ancestry, schema, and changed runtime blobs", () => {
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
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
    for (const changedPath of ["Dockerfile"]) {
      expect(() => evaluateSchemaDeployHandoff({
        markerText: v4AppReadyMarkerText(), deploySha: candidateSha, ...compatibility,
        changedPaths: [...compatibility.changedPaths, changedPath],
      })).toThrow(/not content-bound/);
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
  });

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
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
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
  });

  it("does not overwrite a V4 marker changed during the handoff write", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v4-schema-handoff-race-"));
    directories.push(directory);
    const markerPath = path.join(directory, "marker");
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
    const original = v4AppReadyMarkerText();
    const concurrentMarker = v4AppReadyMarkerText({ lineageDigest: "d".repeat(64) });
    await writeFile(markerPath, original, { flag: "wx", mode: 0o600 });
    await expect(applySchemaDeployHandoff({
      markerPath, deploySha: candidateSha, repo: process.cwd(),
      beforeRename: () => writeFile(markerPath, concurrentMarker),
    })).rejects.toThrow(/marker changed during compatibility handoff/);
    expect(await readFile(markerPath, "utf8")).toBe(concurrentMarker);
    expect((await readdir(directory)).sort()).toEqual(["marker"]);
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
