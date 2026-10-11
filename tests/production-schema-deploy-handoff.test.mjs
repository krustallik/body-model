import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  SCHEMA_DEPLOY_HANDOFF_PROVENANCE, SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA,
  applySchemaDeployHandoff, evaluateSchemaDeployHandoff, parseSchemaDeployMarker,
  readGitCompatibility, renderSchemaDeployTransition,
} from "../scripts/production-schema-deploy-handoff.mjs";

const DEPLOY_SHA = "71c091cd712cd3862d2cebe2714963917c9b5ca2";
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

  it("accepts the current checkout only when its exact transient-water runtime paths remain schema-compatible", () => {
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(), encoding: "utf8",
    }).trim();
    const compatibility = readGitCompatibility(process.cwd(), candidateSha);
    expect(compatibility.isAncestor).toBe(true);
    expect(compatibility.changedPaths).toContain("src/modules/model-episodes/transient-exercise-water-episode-time-v2.ts");
    expect(compatibility.changedPaths).toContain("src/modules/training/experimental-transient-exercise-water-shadow.service.ts");
    expect(compatibility.changedPathObjects).toEqual({
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
        deployBlob: "331bc320b23c51d5b36519dfb0f15ac0a9fdb530",
      },
      "scripts/production-forward-resume.mjs": {
        migrationOriginBlob: "2c07e0636146caaa5bfef69522f351c4e37aa13d",
        deployBlob: "43373e740cdad93d6f88c37c565288b2db1ad70d",
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

  it("admits only the four exact reviewed production-script blob pairs", () => {
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(), encoding: "utf8",
    }).trim();
    const compatibility = readGitCompatibility(process.cwd(), candidateSha);

    for (const [changedPath, replacementBlob] of [
      ["scripts/github-forward-resume-evidence.mjs", "e".repeat(40)],
      ["scripts/production-forward-resume.mjs", "f".repeat(40)],
      ["scripts/production-app-container-health-wait.sh", "a".repeat(40)],
      ["scripts/production-checkout-diagnostic.sh", "b".repeat(40)],
    ]) {
      const changedPathObjects = {
        ...compatibility.changedPathObjects,
        [changedPath]: { ...compatibility.changedPathObjects[changedPath], deployBlob: replacementBlob },
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
