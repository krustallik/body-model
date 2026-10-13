import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { assertProductionDatabaseEndpointBinding } from "../scripts/production-db-endpoint-binding.mjs";
import {
  isCanonicalPostgresDatabaseIdentity,
  isHistoricalPostgresDatabaseIdentity,
  matchesPostgresDatabaseIdentityDigest,
  normalizePostgresDatabaseIdentityRow,
  postgresDatabaseIdentityLegacyDigestProjection,
  samePostgresDatabaseIdentity,
} from "../scripts/postgres-database-identity.mjs";
import { canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import { previousAppDatabaseCompatibilityDigests } from "../scripts/production-previous-app-provenance.mjs";
import { assertProductionDatabaseIdentityMatches } from "../scripts/production-migration-preflight.mjs";

const liveIdentity = Object.freeze({
  database: "bodycast",
  databaseOid: 16384,
  clusterSystemIdentifier: "7419276301947620311",
  role: "bodycast",
  serverVersion: "17.11",
  serverAddress: "172.20.0.2",
  serverPort: 5432,
});

describe("canonical PostgreSQL endpoint identity", () => {
  it("accepts and normalizes a bare PostgreSQL host address only", () => {
    expect(isCanonicalPostgresDatabaseIdentity(liveIdentity)).toBe(true);
    expect(normalizePostgresDatabaseIdentityRow(liveIdentity)).toEqual(liveIdentity);
    for (const serverAddress of ["172.20.0.2/32", "172.20.0.2/24", "", null, "172.20.999.2", "db-primary"]) {
      expect(() => normalizePostgresDatabaseIdentityRow({ ...liveIdentity, serverAddress })).toThrow("incomplete or invalid endpoint identity");
    }
  });

  it("binds the exact inspected IPv4 endpoint and PostgreSQL port", () => {
    expect(assertProductionDatabaseEndpointBinding({ identity: liveIdentity }, "172.20.0.2")).toBe(true);
    for (const [report, expected] of [
      [{ identity: { ...liveIdentity, serverAddress: "172.20.0.99" } }, "172.20.0.2"],
      [{ identity: { ...liveIdentity, serverAddress: "172.20.0.2/32" } }, "172.20.0.2"],
      [{ identity: { ...liveIdentity, serverAddress: "172.20.0.2", serverPort: 5433 } }, "172.20.0.2"],
      [{ identity: { ...liveIdentity, serverPort: null } }, "172.20.0.2"],
      [{ identity: { ...liveIdentity, serverAddress: null } }, "172.20.0.2"],
      [{ identity: liveIdentity }, "172.20.0.3"],
    ]) {
      expect(() => assertProductionDatabaseEndpointBinding(report, expected)).toThrow("fixed PostgreSQL container endpoint");
    }
  });

  it("preserves historical identity signatures without rewriting old artifact values", () => {
    const historicalIdentity = { ...liveIdentity, serverAddress: "172.20.0.2/32" };
    const legacyDigest = canonicalSha256(historicalIdentity);
    expect(isHistoricalPostgresDatabaseIdentity(historicalIdentity)).toBe(true);
    expect(isCanonicalPostgresDatabaseIdentity(historicalIdentity)).toBe(false);
    expect(matchesPostgresDatabaseIdentityDigest(liveIdentity, legacyDigest)).toBe(true);
    expect(matchesPostgresDatabaseIdentityDigest(liveIdentity, canonicalSha256(liveIdentity))).toBe(true);
    expect(matchesPostgresDatabaseIdentityDigest(liveIdentity, "f".repeat(64))).toBe(false);
    expect(samePostgresDatabaseIdentity(historicalIdentity, liveIdentity)).toBe(true);
    expect(assertProductionDatabaseIdentityMatches(historicalIdentity, liveIdentity)).toBe(true);
    for (const changed of [
      { ...liveIdentity, serverAddress: "172.20.0.99" },
      { ...liveIdentity, serverAddress: "172.20.0.2/32" },
      { ...liveIdentity, serverAddress: "172.20.0.2/24" },
      { ...liveIdentity, serverPort: 5433 },
      { ...liveIdentity, database: "bodycast_restore" },
      { ...liveIdentity, clusterSystemIdentifier: "7419276301947620312" },
    ]) expect(() => assertProductionDatabaseIdentityMatches(historicalIdentity, changed)).toThrow();
    expect(postgresDatabaseIdentityLegacyDigestProjection(liveIdentity)).toEqual(historicalIdentity);
    expect(matchesPostgresDatabaseIdentityDigest({ ...liveIdentity, serverAddress: "172.20.0.3" }, legacyDigest)).toBe(false);
    expect(matchesPostgresDatabaseIdentityDigest({ ...liveIdentity, database: "bodycast_restore" }, legacyDigest)).toBe(false);
    expect(matchesPostgresDatabaseIdentityDigest({ ...liveIdentity, clusterSystemIdentifier: "7419276301947620312" }, legacyDigest)).toBe(false);
    expect(matchesPostgresDatabaseIdentityDigest({ ...liveIdentity, serverPort: 5433 }, legacyDigest)).toBe(false);
    expect(isHistoricalPostgresDatabaseIdentity({ ...liveIdentity, serverAddress: "172.20.0.2/24" })).toBe(false);
    expect(matchesPostgresDatabaseIdentityDigest({ ...liveIdentity, serverAddress: "172.20.0.2/24" }, legacyDigest)).toBe(false);
  });

  it("reconciles existing previous-app capture and resume receipt digests across inet text rendering", () => {
    const oldIdentity = { ...liveIdentity, serverAddress: "172.20.0.2/32" };
    const migrations = [{ name: "20261001_baseline", checksum: "b".repeat(64),
      startedAt: "2026-10-01T00:00:00.000Z", finishedAt: "2026-10-01T00:01:00.000Z", rolledBackAt: null }];
    const objects = [{ name: "DailyModelState", present: true, kind: "table", signature: "id:text" }];
    const before = previousAppDatabaseCompatibilityDigests({ identity: oldIdentity, migrations, objects });
    const after = previousAppDatabaseCompatibilityDigests({ identity: liveIdentity, migrations, objects });
    expect(after).toEqual(before);
    expect(before.databaseIdentityDigest).toBe(canonicalSha256(oldIdentity));
    expect(before.compatibilityDigest).toBe(canonicalSha256({ identity: oldIdentity, migrations, objects }));
  });

  it("keeps the standard encrypted backup tied to the captured container ID", async () => {
    const workflow = (await readFile(new URL("../.github/workflows/production-migration-preflight.yml", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    const targetStart = workflow.indexOf("      - name: Verify production container and PostgreSQL client versions");
    const backupStart = workflow.indexOf("      - name: Capture pg_dump start on production host and create encrypted backup");
    const restoreStart = workflow.indexOf("      - name: Restore snapshot, compare source state, and rehearse exact migrations");
    expect(targetStart).toBeGreaterThanOrEqual(0);
    expect(backupStart).toBeGreaterThan(targetStart);
    expect(restoreStart).toBeGreaterThan(backupStart);
    const targetStep = workflow.slice(targetStart, backupStart);
    expect(targetStep).toContain('[[ "$CONTAINER_ID" =~ ^[a-f0-9]{64}$ ]]');
    expect(targetStep).toContain('"docker exec \'$CONTAINER_ID\' pg_dump --version"');
    expect(targetStep).not.toContain("docker exec bodycast-db-prod pg_dump --version");
    const backupStep = workflow.slice(backupStart, restoreStart);
    expect(backupStep).toContain('[[ "$EXPECTED_CONTAINER_ID" =~ ^[a-f0-9]{64}$ ]]');
    expect(backupStep).toContain('"bash -s -- \'$EXPECTED_CONTAINER_ID\'"');
    const remoteStart = backupStep.indexOf("<<'REMOTE'\n");
    const remoteEnd = backupStep.indexOf("\n          REMOTE", remoteStart);
    expect(remoteStart).toBeGreaterThanOrEqual(0);
    expect(remoteEnd).toBeGreaterThan(remoteStart);
    const remoteScript = backupStep.slice(remoteStart + "<<'REMOTE'\n".length, remoteEnd);
    expect(remoteScript).toContain("docker inspect --format '{{.Id}}' bodycast-db-prod");
    expect(remoteScript).toContain('docker exec "$EXPECTED_CONTAINER_ID"');
    expect(remoteScript).toContain("Production DB container changed during pg_dump.");
    expect(remoteScript.indexOf("changed before pg_dump")).toBeLessThan(remoteScript.indexOf('docker exec "$EXPECTED_CONTAINER_ID"'));
    expect(remoteScript.lastIndexOf("docker inspect --format")).toBeGreaterThan(remoteScript.indexOf('docker exec "$EXPECTED_CONTAINER_ID"'));
    expect(remoteScript).not.toContain("docker exec bodycast-db-prod pg_dump");
  });

  it("fails the standard backup if the named container is replaced during pg_dump", async () => {
    const workflow = (await readFile(new URL("../.github/workflows/production-migration-preflight.yml", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    const backupStart = workflow.indexOf("      - name: Capture pg_dump start on production host and create encrypted backup");
    const uploadStart = workflow.indexOf("      - name: Upload encrypted production backup artifact");
    const restoreStart = workflow.indexOf("      - name: Restore snapshot, compare source state, and rehearse exact migrations");
    const backupStep = workflow.slice(backupStart, restoreStart);
    const uploadStep = workflow.slice(uploadStart, workflow.indexOf("      - name:", uploadStart + 1));
    const remoteStart = backupStep.indexOf("<<'REMOTE'\n");
    expect(remoteStart).toBeGreaterThanOrEqual(0);
    const expectedId = "a".repeat(64);
    const replacementId = "b".repeat(64);
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "bodycast-db-container-race-"));
    try {
      const bashEnvironmentPath = join(temporaryDirectory, "bash-environment.sh");
      await writeFile(bashEnvironmentPath, `install() { local destination; for destination do :; done; mkdir -p "$destination"; }
ssh() { exec bash -s -- "$EXPECTED_CONTAINER_ID"; }
docker() {
  if [[ "$1" == inspect ]]; then
    count=0
    [[ ! -f .inspect-count ]] || read -r count < .inspect-count
    count=$((count + 1))
    printf '%s\\n' "$count" > .inspect-count
    if [[ "$count" == 1 ]]; then printf '%s\\n' "$EXPECTED_CONTAINER_ID"; else printf '%s\\n' "$REPLACEMENT_ID"; fi
  elif [[ "$1" == exec ]]; then
    [[ "$2" == "$EXPECTED_CONTAINER_ID" ]]
    printf 'BODYCAST_BACKUP_STARTED_AT=2026-10-13T00:00:00Z\\n' >&2
    printf 'partial-pgdump-stream'
  else
    return 64
  fi
}
node() {
  [[ "$1" == scripts/production-backup-envelope.mjs && "$2" == encrypt ]]
  shift 2
  local output=""
  while (($#)); do
    if [[ "$1" == --output ]]; then shift; output="$1"; fi
    shift
  done
  [[ -n "$output" ]]
  cat > "$output"
}
`);
      const bash = process.platform === "win32"
        ? [join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")]
        : ["bash"];
      const availableBash = process.platform !== "win32" || existsSync(bash[0]);
      expect(availableBash, "Bash is required to execute the workflow's backup step").toBe(true);
      const shellPath = process.platform === "win32"
        ? temporaryDirectory.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
        : temporaryDirectory;
      const gitBinPath = process.platform === "win32"
        ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin").replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
        : null;
      const runMarker = backupStep.indexOf("        run: |\n");
      expect(runMarker).toBeGreaterThanOrEqual(0);
      const runScript = backupStep.slice(runMarker + "        run: |\n".length)
        .split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
      const githubOutput = join(temporaryDirectory, "github-output");
      const runnerTemp = join(temporaryDirectory, "runner");
      expect(runScript.startsWith("set -Eeuo pipefail\n")).toBe(true);
      expect(backupStep).not.toContain("continue-on-error:");
      expect(backupStep).not.toContain("if: always()");
      try {
        execFileSync(bash[0], ["-c", runScript], {
          cwd: temporaryDirectory,
          env: {
            ...process.env,
            PATH: process.platform === "win32"
              ? `${shellPath}:${gitBinPath.replace(/\/bin$/, "/usr/bin")}:${gitBinPath}`
              : `${temporaryDirectory}${delimiter}${process.env.PATH ?? ""}`,
            RUNNER_TEMP: process.platform === "win32" ? `${shellPath}/runner` : runnerTemp,
            GITHUB_OUTPUT: process.platform === "win32" ? `${shellPath}/github-output` : githubOutput,
            BASH_ENV: process.platform === "win32" ? `${shellPath}/bash-environment.sh` : bashEnvironmentPath,
            SSH_PORT: "22", SSH_USER: "test", SSH_HOST: "test.invalid",
            BODYCAST_SSH_KEY: "test-key", BODYCAST_KNOWN_HOSTS: "test-known-hosts",
            PRODUCTION_BACKUP_ENCRYPTION_KEY: "test-only-key",
            EXPECTED_CONTAINER_ID: expectedId,
            REPLACEMENT_ID: replacementId,
          },
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        throw new Error("Expected the outer backup pipeline to fail after container replacement");
      } catch (error) {
        if (error instanceof Error && error.message === "Expected the outer backup pipeline to fail after container replacement") throw error;
        expect(error.status).not.toBe(0);
        const startLogPath = join(temporaryDirectory, "runner", "pgdump-start.log");
        if (!existsSync(startLogPath)) throw new Error(`Backup shell failed before pg_dump boundary: ${error.stderr}`);
        expect(await readFile(startLogPath, "utf8"))
          .toContain("Production DB container changed during pg_dump.");
      }
      expect(existsSync(githubOutput)).toBe(false);
      expect(existsSync(join(temporaryDirectory, "runner", "bodycast-backup-artifact", "production-backup.pgdump.enc"))).toBe(true);
      expect(uploadStart).toBeGreaterThan(restoreStart);
      expect(uploadStep).not.toContain("if:");
      expect(backupStep.indexOf('echo "file=$BACKUP_FILE" >> "$GITHUB_OUTPUT"')).toBeGreaterThan(backupStep.indexOf("node scripts/production-backup-envelope.mjs encrypt"));
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
