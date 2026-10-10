import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acknowledgePrismaSpawn, readProductionReleaseMarker, writeDdlStartingMarker } from "../scripts/production-release-marker.mjs";

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
  it.skipIf(process.platform === "win32")("atomically consumes one signed prior armed marker without reusing its run authorization", async () => {
    const fixture = await markerFixture();
    const prior = { workflowRunId: "38062632284", workflowRunAttempt: 1,
      releaseSha: "b0a31fb6e6552d6ea5419939c96ee42ca7d6ffca",
      authorizationId: "0e616010-fb95-4832-9dd5-df4c386fa003", lineageDigest: "9".repeat(64) };
    await writeFile(fixture.markerPath, ["schemaVersion=2", "manifestId=active-energy-unified-v2",
      `releaseSha=${prior.releaseSha}`, "state=forward-resume-armed",
      `workflowRunId=${prior.workflowRunId}`, `workflowRunAttempt=${prior.workflowRunAttempt}`,
      `authorizationId=${prior.authorizationId}`, `lineageDigest=${prior.lineageDigest}`,
      "spawnState=not-started", ""].join("\n"), { flag: "wx", mode: 0o600 });
    const before = await readProductionReleaseMarker(fixture.markerPath);
    const next = await writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments,
      expectedPriorDigest: before.digest, expectedPriorMarker: prior });
    expect(next.marker).toMatchObject({ state: "ddl-starting", spawnState: "not-started",
      releaseSha: markerArguments.releaseSha, workflowRunId: markerArguments.workflowRunId,
      authorizationId: markerArguments.authorizationId });
    expect((await readProductionReleaseMarker(fixture.markerPath)).digest).toBe(next.digest);
    await expect(writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments,
      expectedPriorDigest: before.digest, expectedPriorMarker: prior })).rejects.toThrow();
    expect((await readdir(fixture.markerDirectory)).sort()).toEqual(["marker"]);
  });

  it.skipIf(process.platform === "win32")("rejects a forged prior authorization without changing the armed marker", async () => {
    const fixture = await markerFixture();
    await writeFile(fixture.markerPath, ["schemaVersion=2", "manifestId=active-energy-unified-v2",
      `releaseSha=${markerArguments.releaseSha}`, "state=forward-resume-armed",
      "workflowRunId=38062632284", "workflowRunAttempt=1",
      "authorizationId=0e616010-fb95-4832-9dd5-df4c386fa003", `lineageDigest=${"9".repeat(64)}`,
      "spawnState=not-started", ""].join("\n"), { flag: "wx", mode: 0o600 });
    const before = await readProductionReleaseMarker(fixture.markerPath);
    await expect(writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments,
      expectedPriorDigest: before.digest, expectedPriorMarker: {
        releaseSha: markerArguments.releaseSha, workflowRunId: "38062632284", workflowRunAttempt: 1,
        authorizationId: "forged-authorization-id", lineageDigest: "9".repeat(64),
      } })).rejects.toThrow("lineage changed");
    expect((await readProductionReleaseMarker(fixture.markerPath)).digest).toBe(before.digest);
  });

  it.skipIf(process.platform === "win32")("rejects a substituted old release SHA before publishing the new main SHA", async () => {
    const fixture = await markerFixture();
    const oldSha = "b0a31fb6e6552d6ea5419939c96ee42ca7d6ffca";
    await writeFile(fixture.markerPath, ["schemaVersion=2", "manifestId=active-energy-unified-v2",
      `releaseSha=${oldSha}`, "state=forward-resume-armed", "workflowRunId=38062632284",
      "workflowRunAttempt=1", "authorizationId=0e616010-fb95-4832-9dd5-df4c386fa003",
      `lineageDigest=${"9".repeat(64)}`, "spawnState=not-started", ""].join("\n"), { flag: "wx", mode: 0o600 });
    const before = await readProductionReleaseMarker(fixture.markerPath);
    await expect(writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments,
      expectedPriorDigest: before.digest, expectedPriorMarker: {
        releaseSha: "c".repeat(40), workflowRunId: "38062632284", workflowRunAttempt: 1,
        authorizationId: "0e616010-fb95-4832-9dd5-df4c386fa003", lineageDigest: "9".repeat(64),
      } })).rejects.toThrow("lineage changed");
    expect((await readProductionReleaseMarker(fixture.markerPath)).digest).toBe(before.digest);
    expect((await readdir(fixture.markerDirectory)).sort()).toEqual(["marker"]);
  });

  it.skipIf(process.platform === "win32")("fsync-publishes a blocking pre-spawn marker before the caller can spawn Prisma", async () => {
    const fixture = await markerFixture();
    const marker = await writeDdlStartingMarker({ markerDirectory: fixture.markerDirectory, ...markerArguments });
    expect(marker.marker).toMatchObject({ state: "ddl-starting", spawnState: "not-started" });
    expect(await readProductionReleaseMarker(fixture.markerPath)).toMatchObject({
      marker: { state: "ddl-starting", spawnState: "not-started" }, digest: marker.digest,
    });
    expect((await readdir(fixture.markerDirectory)).sort()).toEqual(["marker"]);
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
