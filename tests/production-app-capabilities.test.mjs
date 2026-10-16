import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRollbackAppCanReadProgramlessSessions, readProductionAppCapabilitiesAtSha } from "../scripts/production-app-capabilities.mjs";
import { verifyProgramlessSessionRollbackCompatibility } from "../scripts/production-recovery/schema-compatibility.mjs";

const directories = [];

async function createRelease({ capabilityContract = null } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-app-capabilities-"));
  directories.push(directory);
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "BodyCast tests"], { cwd: directory });
  if (capabilityContract !== null) {
    await mkdir(path.join(directory, "scripts"), { recursive: true });
    await writeFile(path.join(directory, "scripts/production-app-capabilities.json"), capabilityContract);
    execFileSync("git", ["add", "scripts/production-app-capabilities.json"], { cwd: directory });
  }
  execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", "release"], { cwd: directory });
  return { directory, repositoryPath: directory,
    releaseSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim() };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("rollback app data compatibility capability", () => {
  it("allows an old app only while the restored database has no programless sessions", async () => {
    const oldRelease = await createRelease();
    expect(assertRollbackAppCanReadProgramlessSessions({ ...oldRelease, programlessSessionCount: 0 })).toMatchObject({
      verified: true, capabilityRequired: false,
    });
    expect(() => assertRollbackAppCanReadProgramlessSessions({ ...oldRelease, programlessSessionCount: 1 }))
      .toThrow(/no immutable BodyCast capability contract/);
  });

  it("requires exact source-SHA certification when programless sessions exist", async () => {
    const compatibleRelease = await createRelease({ capabilityContract: JSON.stringify({
      schemaVersion: 1, capabilities: ["programless-strength-sessions-v1"],
    }) });
    const capability = readProductionAppCapabilitiesAtSha(compatibleRelease);
    expect(capability.capabilities).toEqual(["programless-strength-sessions-v1"]);
    expect(capability.capabilityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(assertRollbackAppCanReadProgramlessSessions({ ...compatibleRelease, programlessSessionCount: 2 }))
      .toMatchObject({ verified: true, capabilityRequired: true, programlessSessionCount: 2 });

    const uncertified = await createRelease({ capabilityContract: JSON.stringify({ schemaVersion: 1, capabilities: [] }) });
    expect(() => assertRollbackAppCanReadProgramlessSessions({ ...uncertified, programlessSessionCount: 1 }))
      .toThrow(/not certified to read existing programless strength sessions/);
  });

  it("binds a read-only, sanitized session count to exact rollback SHA and database identity", async () => {
    const oldRelease = await createRelease();
    const databaseDigest = "a".repeat(64);
    const run = async ({ release, count }) => verifyProgramlessSessionRollbackCompatibility({
      repositoryPath: release.repositoryPath,
      rollbackAppSha: release.releaseSha,
      expectedLogicalProductionDbIdentityDigest: databaseDigest,
      resolveLogicalDatabaseIdentity: async () => ({ identityDigest: databaseDigest }),
      withReadOnlyTransaction: async (callback) => callback(async (sql) => {
        if (sql === "SET TRANSACTION READ ONLY") return [];
        expect(sql).toContain('WHERE "programId" IS NULL AND "programVersionId" IS NULL');
        return [{ programlessSessionCount: String(count) }];
      }),
    });
    await expect(run({ release: oldRelease, count: 0 })).resolves.toMatchObject({
      rollbackAppSha: oldRelease.releaseSha, programlessSessionCount: 0,
      rollbackAppSupportsProgramlessSessions: false, programlessSessionCompatible: true,
    });
    await expect(run({ release: oldRelease, count: 1 })).rejects.toThrow(/no immutable BodyCast capability contract/);
    await expect(verifyProgramlessSessionRollbackCompatibility({
      repositoryPath: oldRelease.repositoryPath, rollbackAppSha: oldRelease.releaseSha,
      expectedLogicalProductionDbIdentityDigest: "b".repeat(64),
      resolveLogicalDatabaseIdentity: async () => ({ identityDigest: databaseDigest }),
      withReadOnlyTransaction: async (callback) => callback(async (sql) => sql === "SET TRANSACTION READ ONLY"
        ? [] : [{ programlessSessionCount: "0" }]),
    })).rejects.toThrow(/captured logical production database/);
  });

  it("fails closed for malformed, unsorted, or unknown capability contracts", async () => {
    for (const contract of [
      "{",
      JSON.stringify({ schemaVersion: 2, capabilities: ["programless-strength-sessions-v1"] }),
      JSON.stringify({ schemaVersion: 1, capabilities: ["unknown-capability"] }),
      JSON.stringify({ schemaVersion: 1, capabilities: ["z-capability", "a-capability"] }),
    ]) {
      const release = await createRelease({ capabilityContract: contract });
      expect(() => readProductionAppCapabilitiesAtSha(release)).toThrow(/malformed/);
    }
  });
});
