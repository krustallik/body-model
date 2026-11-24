import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../fixtures/refactor-comparator/invariants-v1.json";
import bodyMapUiBaseline from "../fixtures/refactor-comparator/body-map-ui-baseline-v1.json";

function sha256File(path: string): string {
  const bytes = readFileSync(resolve(process.cwd(), path));
  const textExtensions = new Set([".css", ".js", ".json", ".md", ".mjs", ".sql", ".test.ts", ".ts", ".tsx", ".txt"]);
  if (textExtensions.has(extname(path).toLowerCase())) {
    return createHash("sha256").update(bytes.toString("utf8").replaceAll("\r\n", "\n"), "utf8").digest("hex");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

function expectArtifactHash(path: string, expected: string, label: string): void {
  const fullPath = resolve(process.cwd(), path);
  expect(existsSync(fullPath), `${label}: ${path}`).toBe(true);
  expect(sha256File(path), label).toBe(expected);
}

describe("frozen refactor comparator manifest", () => {
  it("pins one exact deterministic clock and random seed", () => {
    expect(manifest.determinism).toEqual({
      clock: "2026-11-23T12:00:00.000Z",
      randomSeed: "bodycast-refactor-comparator-v1",
    });
  });

  it("contains unique suites, paths, tables, and observation IDs", () => {
    const suiteIds = [
      ...manifest.unitSuites.map(({ id }) => id),
      ...manifest.integrationSuites.map(({ id }) => id),
    ];
    expect(new Set(suiteIds).size).toBe(suiteIds.length);

    const unitPaths = manifest.unitSuites.flatMap(({ paths }) => paths);
    expect(new Set(unitPaths).size).toBe(unitPaths.length);
    expect(new Set(manifest.postgres.snapshotTables).size).toBe(manifest.postgres.snapshotTables.length);
    expect(new Set(manifest.observations.map(({ id }) => id)).size).toBe(manifest.observations.length);
  });

  it("points every frozen test and fixture to an existing repository path", () => {
    expect(existsSync(resolve(process.cwd(), manifest.fixtureTree))).toBe(true);
    for (const path of manifest.unitSuites.flatMap(({ paths }) => paths)) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
    for (const observation of manifest.observations) {
      expect(existsSync(resolve(process.cwd(), observation.path)), observation.path).toBe(true);
      if (observation.integrationSuiteId === undefined) {
        expect(manifest.unitSuites.some(({ paths }) => paths.includes(observation.path))).toBe(true);
      } else {
        expect(manifest.integrationSuites.find(({ id }) => id === observation.integrationSuiteId)?.args)
          .toContain(observation.path);
      }
    }
    for (const suite of manifest.integrationSuites) {
      for (const path of suite.args) expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
  });

  it("pins complete historical and UI case groups to executable suites and exact input hashes", () => {
    const requiredGroups = [
      "RAW-01", "TRAIN-HIST-01", "ENERGY-01", "TRAIN-02", "V7-01", "UNIFIED-01",
      "TX-CONCURRENCY-01", "FORECAST-CALENDAR-01", "BODYMAP-UI-01", "BODYMAP-ANALYTICS-01",
      "BODYMAP-PERFORMANCE-01", "BODYMAP-ENERGY-01", "BODYMAP-MAPPING-V3-01", "TRAIN-LOAD-ASSESS-01",
    ];
    expect(manifest.caseGroups.map(({ id }) => id)).toEqual(requiredGroups);

    const unitPaths = new Set(manifest.unitSuites.flatMap(({ paths }) => paths));
    const suiteIds = new Set(manifest.integrationSuites.map(({ id }) => id));
    const observationIds = new Set(manifest.observations.map(({ id }) => id));
    const expectedGroupMembers: Record<string, string[]> = {
      "ENERGY-01": ["tests/distance-ledger-v1.test.ts", "tests/workout-feed-coverage.test.ts"],
      "TRAIN-02": [
        "tests/model-occupational-activity.test.ts",
        "tests/training-day-fact-currentness.test.ts",
        "tests/session-set-time-and-strength-energy.test.ts",
        "tests/strength-training-input-v7.test.ts",
      ],
      "BODYMAP-UI-01": ["tests/body-map-training-analytics-panel.test.tsx"],
      "BODYMAP-ANALYTICS-01": ["tests/body-map-analytics-period-v1.test.ts"],
      "BODYMAP-PERFORMANCE-01": ["tests/body-map-training-analytics-panel.test.tsx"],
    };
    for (const [groupId, paths] of Object.entries(expectedGroupMembers)) {
      const group = manifest.caseGroups.find(({ id }) => id === groupId);
      expect(group, groupId).toBeDefined();
      for (const path of paths) expect(group?.unitPaths, `${groupId}:${path}`).toContain(path);
    }
    for (const group of manifest.caseGroups) {
      for (const path of group.unitPaths) expect(unitPaths.has(path), `${group.id}:${path}`).toBe(true);
      for (const id of group.integrationSuiteIds) expect(suiteIds.has(id), `${group.id}:${id}`).toBe(true);
      for (const id of group.databaseStateSuiteIds) expect(group.integrationSuiteIds).toContain(id);
      for (const id of group.observationIds) expect(observationIds.has(id), `${group.id}:${id}`).toBe(true);
      for (const input of group.inputFiles) {
        expect(sha256File(input.path), `${group.id}:${input.path}`).toBe(input.sha256);
      }
      if (group.uiEvidence) {
        expect(sha256File(group.uiEvidence.path), `${group.id}:uiEvidence`).toBe(group.uiEvidence.sha256);
        expect(group.id).toBe("BODYMAP-UI-01");
      }
      expect(group.unitPaths.length + group.integrationSuiteIds.length + group.observationIds.length
        + group.databaseStateSuiteIds.length + Number(Boolean(group.uiEvidence))).toBeGreaterThan(0);
    }
  });

  it("retains and verifies the exact BodyMap and Training UI characterization evidence", () => {
    const runnerCommitSha = "381021b362a4c82f48d722b14d5fbf8e5f3508cc";
    for (const runner of [bodyMapUiBaseline.bodyMap, bodyMapUiBaseline.training]) {
      expect(runner.runnerCommitSha).toBe(runnerCommitSha);
      expect(runner.runnerHashBasis).toBe("exact-git-blob-bytes");
      expect(runner.runnerPath).toMatch(/^scripts\/qa\/[a-z0-9-]+\.ts$/);
      expectArtifactHash(runner.runnerPath, runner.runnerSha256, `UI characterization runner ${runner.runnerPath}`);
    }

    const bodyMap = bodyMapUiBaseline.bodyMap;
    expectArtifactHash(bodyMap.reportPath, bodyMap.reportSha256, "BodyMap QA report");
    expectArtifactHash(bodyMap.issuesEvidencePath, bodyMap.issuesEvidenceSha256, "BodyMap Next/WebGL issue evidence");
    expectArtifactHash(bodyMap.contractTestOutputPath, bodyMap.contractTestOutputSha256, "BodyMap contract test output");
    expectArtifactHash(bodyMap.manifestPath, bodyMap.manifestSha256, "BodyMap public manifest");
    expectArtifactHash(bodyMap.bodyParts3dGlbPath, bodyMap.bodyParts3dGlbSha256, "BodyMap model asset");
    expectArtifactHash(bodyMap.profilePayloadPath, bodyMap.profilePayloadSha256, "BodyMap profile API payload");
    for (const [file, sha256] of Object.entries(bodyMap.screenshotsSha256)) {
      expectArtifactHash(`${bodyMap.artifactRoot}/${file}`, sha256, `BodyMap screenshot ${file}`);
    }
    expect(Object.keys(bodyMap.analyticsPayloadPaths).sort()).toEqual(Object.keys(bodyMap.analyticsPayloadSha256).sort());
    for (const [window, path] of Object.entries(bodyMap.analyticsPayloadPaths)) {
      expectArtifactHash(path, bodyMap.analyticsPayloadSha256[window as keyof typeof bodyMap.analyticsPayloadSha256], `BodyMap ${window} API payload`);
    }

    const training = bodyMapUiBaseline.training;
    expectArtifactHash(training.reportPath, training.reportSha256, "Training QA report");
    expectArtifactHash(training.interactionTracePath, training.interactionTraceSha256, "Training interaction trace");
    for (const [file, sha256] of Object.entries(training.screenshotsSha256)) {
      expectArtifactHash(`${training.artifactRoot}/${file}`, sha256, `Training screenshot ${file}`);
    }
    for (const [file, sha256] of Object.entries(training.fixtureSha256)) {
      expectArtifactHash(`${training.artifactRoot}/${file}`, sha256, `Training API fixture ${file}`);
    }
  });

  it("pins separate exact loopback PostgreSQL endpoints and an immutable image digest", () => {
    expect(manifest.postgres.before.host).toBe("127.0.0.1");
    expect(manifest.postgres.after.host).toBe("127.0.0.1");
    expect(manifest.postgres.before.port).not.toBe(manifest.postgres.after.port);
    expect(manifest.postgres.before.database).not.toBe(manifest.postgres.after.database);
    expect(manifest.postgres.before.role).not.toBe(manifest.postgres.after.role);
    expect(manifest.postgres.before.port).toBe(55436);
    expect(manifest.postgres.after.port).toBe(55437);
    expect(manifest.postgres.image).toMatch(/^docker\.io\/library\/postgres@sha256:[a-f0-9]{64}$/);
    expect(manifest.postgres.legacyMigrationCount).toBe(74);
    expect(manifest.postgres.auth.before).toEqual(manifest.postgres.auth.after);
    expect(manifest.postgres.auth.before).toEqual({
      host: "127.0.0.1",
      port: 55435,
      database: "bodycast_training_postcommit_test",
      role: "bodycast_test_runner",
    });
    expect(manifest.integrationSuites.find(({ id }) => id === "postgres-auth-multiuser")).toMatchObject({
      databaseProfile: "auth",
      authEnvironment: true,
    });
    expect(manifest.integrationSuites.some(({ args }) => args.includes("tests/integration/database-safety.test.ts"))).toBe(false);
  });
});
