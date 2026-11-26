import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acknowledgePrismaSpawn, parseProductionReleaseMarker, readAuthPredecessorMarker, readProductionReleaseMarker, writeDdlStartingMarker } from "../scripts/production-release-marker.mjs";
import {
  evaluateSchemaDeployHandoff,
  readGitCompatibility,
  renderSchemaDeployTransition,
  validateAuthMarkerForTrainingMigrationHandoff,
} from "../scripts/production-schema-deploy-handoff.mjs";
import { AUTH_MULTIUSER_MANIFEST } from "../scripts/production-migration-manifests.mjs";

const AUTH_MULTIUSER_MIGRATION_APP_SHA = "18e67d53856af1f4742bbe9626abbd005b70e8bf";
const AUTH_PREVIOUS_DEPLOY_SHA = "c616eba0f874c8c481cb889fade149b68f9ba590";

const directories = [];
async function markerFixture() {
  const markerDirectory = await mkdtemp(path.join(os.tmpdir(), "bodycast-release-marker-test-"));
  directories.push(markerDirectory);
  return { markerDirectory, markerPath: path.join(markerDirectory, "marker") };
}
const markerArguments = {
  releaseSha: "a".repeat(40), workflowRunId: "390001", workflowRunAttempt: 1,
  authorizationId: "authorization-marker-test-12345", lineageDigest: "b".repeat(64),
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("durable Prisma DDL marker handoff", () => {
  it("parses only the closed Auth app-ready predecessor marker shape", async () => {
    const fixture = await markerFixture();
    const text = [
      "schemaVersion=3", "manifestId=auth-multiuser-v1", `migrationOriginSha=${AUTH_MULTIUSER_MIGRATION_APP_SHA}`,
      `deploySha=${AUTH_PREVIOUS_DEPLOY_SHA}`, "state=app-ready", "workflowRunId=41545707543", "workflowRunAttempt=1",
      "authorizationId=auth-marker-predecessor-test", `lineageDigest=${"a".repeat(64)}`, "spawnState=started",
      `sourceMarkerDigest=${"b".repeat(64)}`, `compatibilityDigest=${"c".repeat(64)}`, "",
    ].join("\n");
    await writeFile(fixture.markerPath, text, { flag: "wx", mode: 0o600 });

    const parsed = await readAuthPredecessorMarker(fixture.markerPath);
    expect(parsed.marker).toMatchObject({
      schemaVersion: 3, manifestId: "auth-multiuser-v1", state: "app-ready",
      deploySha: AUTH_PREVIOUS_DEPLOY_SHA, migrationOriginSha: AUTH_MULTIUSER_MIGRATION_APP_SHA,
    });
    expect(parsed.digest).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(fixture.markerPath, text.replace("state=app-ready", "state=ddl-started"));
    await expect(readAuthPredecessorMarker(fixture.markerPath)).rejects.toThrow(/values are invalid/);
  });

  it("accepts the reviewed Auth manifest in a canonical DDL marker", () => {
    const marker = parseProductionReleaseMarker([
      "schemaVersion=2",
      "manifestId=auth-multiuser-v1",
      `releaseSha=${markerArguments.releaseSha}`,
      "state=ddl-starting",
      `workflowRunId=${markerArguments.workflowRunId}`,
      `workflowRunAttempt=${markerArguments.workflowRunAttempt}`,
      `authorizationId=${markerArguments.authorizationId}`,
      `lineageDigest=${markerArguments.lineageDigest}`,
      "spawnState=not-started",
      "",
    ].join("\n"));
    expect(marker).toMatchObject({ manifestId: "auth-multiuser-v1", state: "ddl-starting", spawnState: "not-started" });
  });

  it.skipIf(process.platform === "win32")("accepts the Auth manifest through the standard DDL marker lifecycle", async () => {
    const fixture = await markerFixture();
    const marker = await writeDdlStartingMarker({
      markerDirectory: fixture.markerDirectory,
      ...markerArguments,
      manifestId: "auth-multiuser-v1",
    });
    expect(marker.marker.manifestId).toBe("auth-multiuser-v1");
    const acknowledged = await acknowledgePrismaSpawn({ markerPath: fixture.markerPath, expectedDigest: marker.digest });
    expect(acknowledged.marker).toMatchObject({ manifestId: "auth-multiuser-v1", state: "ddl-started", spawnState: "started" });
  });

  it.skipIf(process.platform === "win32")("removes the temporary marker lock when an unreviewed manifest is rejected before publication", async () => {
    const fixture = await markerFixture();
    await expect(writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments,
      manifestId: "unreviewed-manifest" })).rejects.toThrow("refusing malformed release marker values");
    expect(await readdir(fixture.markerDirectory)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("atomically chains only the exact Auth app-ready marker into Training DDL start", async () => {
    const fixture = await markerFixture();
    const compatibility = readGitCompatibility(process.cwd(), AUTH_PREVIOUS_DEPLOY_SHA,
      AUTH_MULTIUSER_MIGRATION_APP_SHA, AUTH_MULTIUSER_MANIFEST.id);
    const handoff = evaluateSchemaDeployHandoff({
      markerText: ["schemaVersion=2", "manifestId=auth-multiuser-v1",
        `releaseSha=${AUTH_MULTIUSER_MIGRATION_APP_SHA}`, "state=app-ready",
        "workflowRunId=41545707543", "workflowRunAttempt=1",
        "authorizationId=auth-marker-predecessor-test", `lineageDigest=${"a".repeat(64)}`,
        "spawnState=started", ""].join("\n"),
      deploySha: AUTH_PREVIOUS_DEPLOY_SHA,
      ...compatibility,
    });
    const priorText = renderSchemaDeployTransition(handoff.bytes, "app-ready");
    const witness = { ...validateAuthMarkerForTrainingMigrationHandoff(priorText, {
      liveAppSha: AUTH_PREVIOUS_DEPLOY_SHA,
      repositoryPath: process.cwd(),
    }), liveAppSha: AUTH_PREVIOUS_DEPLOY_SHA };
    await writeFile(fixture.markerPath, priorText, { flag: "wx", mode: 0o600 });

    const next = await writeDdlStartingMarker({
      markerDirectory: fixture.markerDirectory,
      ...markerArguments,
      manifestId: "training-session-context-v1",
      expectedPriorDigest: witness.digest,
      expectedPriorMarker: witness,
      expectedPriorMode: "auth-to-training-session-context",
    });

    expect(next.marker).toMatchObject({ manifestId: "training-session-context-v1", state: "ddl-starting", spawnState: "not-started" });
    expect(await readProductionReleaseMarker(fixture.markerPath)).toMatchObject({
      marker: { manifestId: "training-session-context-v1", state: "ddl-starting" }, digest: next.digest,
    });
    await expect(writeDdlStartingMarker({
      markerDirectory: fixture.markerDirectory, ...markerArguments,
      manifestId: "training-session-context-v1", expectedPriorDigest: witness.digest,
      expectedPriorMarker: witness, expectedPriorMode: "auth-to-training-session-context",
    })).rejects.toThrow();
  }, 30_000);

  it.skipIf(process.platform === "win32")("preserves the Auth marker when its digest or provenance does not match", async () => {
    const fixture = await markerFixture();
    const compatibility = readGitCompatibility(process.cwd(), AUTH_PREVIOUS_DEPLOY_SHA,
      AUTH_MULTIUSER_MIGRATION_APP_SHA, AUTH_MULTIUSER_MANIFEST.id);
    const handoff = evaluateSchemaDeployHandoff({
      markerText: ["schemaVersion=2", "manifestId=auth-multiuser-v1",
        `releaseSha=${AUTH_MULTIUSER_MIGRATION_APP_SHA}`, "state=app-ready",
        "workflowRunId=41545707543", "workflowRunAttempt=1",
        "authorizationId=auth-marker-predecessor-test", `lineageDigest=${"a".repeat(64)}`,
        "spawnState=started", ""].join("\n"),
      deploySha: AUTH_PREVIOUS_DEPLOY_SHA,
      ...compatibility,
    });
    const priorText = renderSchemaDeployTransition(handoff.bytes, "app-ready");
    const witness = { ...validateAuthMarkerForTrainingMigrationHandoff(priorText, {
      liveAppSha: AUTH_PREVIOUS_DEPLOY_SHA,
      repositoryPath: process.cwd(),
    }), liveAppSha: AUTH_PREVIOUS_DEPLOY_SHA };
    await writeFile(fixture.markerPath, priorText, { flag: "wx", mode: 0o600 });
    const before = await readFile(fixture.markerPath, "utf8");

    await expect(writeDdlStartingMarker({
      markerDirectory: fixture.markerDirectory,
      ...markerArguments,
      manifestId: "training-session-context-v1",
      expectedPriorDigest: "0".repeat(64),
      expectedPriorMarker: witness,
      expectedPriorMode: "auth-to-training-session-context",
    })).rejects.toThrow(/lineage changed/);
    expect(await readFile(fixture.markerPath, "utf8")).toBe(before);
  }, 30_000);

  it.skipIf(process.platform === "win32")("fsync-publishes a blocking pre-spawn marker before the caller can spawn Prisma", async () => {
    const fixture = await markerFixture();
    const marker = await writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments });
    expect(marker.marker).toMatchObject({ state: "ddl-starting", spawnState: "not-started" });
    expect(await readProductionReleaseMarker(fixture.markerPath)).toMatchObject({
      marker: { state: "ddl-starting", spawnState: "not-started" }, digest: marker.digest,
    });
    expect((await readdir(fixture.markerDirectory)).sort()).toEqual(["marker"]);
  });

  it.skipIf(process.platform === "win32")("preserves the exact new manifest identity across the DDL marker lifecycle", async () => {
    const fixture = await markerFixture();
    const marker = await writeDdlStartingMarker({
      markerDirectory: fixture.markerDirectory,
      ...markerArguments,
      manifestId: "unified-v4-republication-v1",
    });
    expect(marker.marker.manifestId).toBe("unified-v4-republication-v1");
    const acknowledged = await acknowledgePrismaSpawn({ markerPath: fixture.markerPath, expectedDigest: marker.digest });
    expect(acknowledged.marker).toMatchObject({
      manifestId: "unified-v4-republication-v1",
      state: "ddl-started",
      spawnState: "started",
    });
    expect((await readProductionReleaseMarker(fixture.markerPath)).marker.manifestId)
      .toBe("unified-v4-republication-v1");
  });

  it.skipIf(process.platform === "win32")("accepts the Training ledger manifest through the standard DDL marker lifecycle", async () => {
    const fixture = await markerFixture();
    const marker = await writeDdlStartingMarker({
      markerDirectory: fixture.markerDirectory,
      ...markerArguments,
      manifestId: "training-mutation-ledger-refresh-queue-v1",
    });
    expect(marker.marker.manifestId).toBe("training-mutation-ledger-refresh-queue-v1");
    const acknowledged = await acknowledgePrismaSpawn({ markerPath: fixture.markerPath, expectedDigest: marker.digest });
    expect(acknowledged.marker).toMatchObject({
      manifestId: "training-mutation-ledger-refresh-queue-v1",
      state: "ddl-started",
      spawnState: "started",
    });
  });

  it.skipIf(process.platform === "win32")("records Prisma as started only after the OS spawn acknowledgement and durable transition", async () => {
    const fixture = await markerFixture();
    const marker = await writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments });
    const acknowledged = await acknowledgePrismaSpawn({ markerPath: fixture.markerPath, expectedDigest: marker.digest });
    expect(acknowledged.marker).toMatchObject({ state: "ddl-started", spawnState: "started" });
    expect(await readProductionReleaseMarker(fixture.markerPath)).toMatchObject({
      marker: { state: "ddl-started", spawnState: "started" }, digest: acknowledged.digest,
    });
  });

  it.skipIf(process.platform === "win32")("allows only one concurrent marker publication and keeps the winner durable", async () => {
    const fixture = await markerFixture();
    const attempts = await Promise.allSettled([
      writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments }),
      writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments, workflowRunId: "390002" }),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const persisted = await readProductionReleaseMarker(fixture.markerPath);
    expect(persisted.marker.state).toBe("ddl-starting");
    expect(persisted.marker.spawnState).toBe("not-started");
  });

  it.skipIf(process.platform === "win32")("fails closed on stale marker digest and does not advance the state", async () => {
    const fixture = await markerFixture();
    const marker = await writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments });
    await expect(acknowledgePrismaSpawn({ markerPath: fixture.markerPath, expectedDigest: "0".repeat(64) }))
      .rejects.toThrow("changed before spawn acknowledgement");
    expect((await readProductionReleaseMarker(fixture.markerPath)).digest).toBe(marker.digest);
    expect((await readProductionReleaseMarker(fixture.markerPath)).marker.state).toBe("ddl-starting");
  });
});
