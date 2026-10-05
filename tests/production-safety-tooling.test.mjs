import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createEncryptedPostgresBackup } from "../scripts/backup-postgres.mjs";
import {
  decodeBackupKey,
  decryptBackupToWritable,
  encryptBackupStream,
} from "../scripts/production-backup-envelope.mjs";
import {
  evaluateProductionPreflight,
  EXPECTED_MIGRATION_OBJECTS,
  EXPECTED_PENDING_MIGRATIONS,
  verifyRestoredBackup,
} from "../scripts/production-migration-preflight.mjs";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST, STAGE_02_MANIFEST } from "../scripts/production-migration-manifests.mjs";
import { getExpectedSchemaObjectNames, renderProductionDbPreflightSql } from "../scripts/production-db-preflight.mjs";
import {
  isDisposableNonProductionTarget,
  isLocalDockerEndpoint,
  isProductionLikeName,
  dockerTargetSelection,
  verifyEncryptedBackupOnDisposableTarget,
} from "../scripts/verify-postgres-restore.mjs";
import { filterKnownHostRecords } from "../scripts/filter-ssh-known-hosts.mjs";
import { assertPostgresClientCompatibility } from "../scripts/postgres-client-versions.mjs";
import { restoreEncryptedPostgresBackup } from "../scripts/restore-encrypted-postgres-backup.mjs";

describe("encrypted PostgreSQL restore diagnostics", () => {
  it("reports pg_restore stderr and exit code when it closes stdin (EPIPE is secondary)", async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), "bodycast-restore-diagnostics-"));
    const archive = path.join(scratch, "synthetic.pgdump.enc");
    const key = Buffer.alloc(32, 19);
    try {
      await encryptBackupStream(Readable.from([Buffer.alloc(256 * 1024, 7)]), archive, key);
      const childScript = [
        "process.stdin.once('data', () => {",
        "  process.stderr.write('pg_restore: error: deliberate restore diagnostic\\n');",
        "  process.stdin.destroy();",
        "  process.exitCode = 7;",
        "});",
      ].join("\n");
      const logged = [];
      await expect(restoreEncryptedPostgresBackup({
        inputPath: archive,
        key,
        command: process.execPath,
        args: ["-e", childScript],
        env: { ...process.env, DATABASE_URL: "postgresql://user:password@host/db", PGPASSWORD: "password" },
        redactValues: ["password", "postgresql://user:password@host/db"],
        log: (message) => logged.push(message),
      })).rejects.toMatchObject({ exitCode: 7 });
      expect(logged.join("\n")).toContain("pg_restore failed with exit code 7");
      expect(logged.join("\n")).toContain("pg_restore: error: deliberate restore diagnostic");
      expect(logged.join("\n")).toContain("EPIPE");
      expect(logged.join("\n")).not.toContain("postgresql://user:password@host/db");
      expect(logged.join("\n")).not.toContain("password");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("PostgreSQL backup client compatibility", () => {
  it("accepts matching majors even when patch versions differ", () => {
    expect(assertPostgresClientCompatibility(
      "pg_dump (PostgreSQL) 17.5",
      "pg_restore (PostgreSQL) 17.11",
    )).toEqual({ pgDumpMajor: 17, pgRestoreMajor: 17 });
  });

  it("rejects an older restore client before attempting restore", () => {
    expect(() => assertPostgresClientCompatibility(
      "pg_dump (PostgreSQL) 17.11",
      "pg_restore (PostgreSQL) 16.10",
    )).toThrow("pg_restore major 16 is older than pg_dump major 17");
  });

  it("rejects missing or unparseable client versions", () => {
    expect(() => assertPostgresClientCompatibility("unknown", "pg_restore (PostgreSQL) 17.11"))
      .toThrow("Could not parse pg_dump PostgreSQL version");
  });
});

function preflightFixture(migrationDirectories) {
  const stage02Checksums = new Map(STAGE_02_MANIFEST.migrations.map(({ name, sha256 }) => [name, sha256]));
  const appliedMigrations = migrationDirectories.filter((name) => !EXPECTED_PENDING_MIGRATIONS.includes(name));
  return {
    identity: { database: "bodycast", databaseOid: 16384, role: "bodycast", serverVersion: "17.0", serverAddress: "172.20.0.2", serverPort: 5432 },
    migrations: appliedMigrations.map((name) => ({
      name,
      checksum: stage02Checksums.get(name) ?? "a".repeat(64),
      startedAt: "2026-09-01T00:00:00.000Z",
      finishedAt: "2026-09-01T00:00:01.000Z",
      rolledBackAt: null,
      hasLogs: false,
    })),
    objects: getExpectedSchemaObjectNames().map((name) => ({
      name,
      present: EXPECTED_MIGRATION_OBJECTS.includes(name),
      kind: name.includes(".") ? "column" : "constraint",
      signature: EXPECTED_MIGRATION_OBJECTS.includes(name) ? "reviewed-object-signature" : null,
    })),
    tables: {
      Workout: { exists: true, estimatedRows: 1, totalBytes: 4096 },
      Profile: { exists: true, estimatedRows: 1, totalBytes: 4096 },
      ModelEpisode: { exists: true, estimatedRows: 1, totalBytes: 4096 },
      PhysiologyV7Lifecycle: { exists: true, estimatedRows: 1, totalBytes: 4096 },
      DailyModelState: { exists: true, estimatedRows: 1, totalBytes: 4096 },
      StrengthDiarySession: { exists: true, estimatedRows: 22, totalBytes: 4096 },
      ExerciseCatalog: { exists: true, estimatedRows: 44, totalBytes: 8192 },
      _prisma_migrations: { exists: true, estimatedRows: 5, totalBytes: 4096 },
    },
    longTransactions: [],
    conflictingLocks: [],
    preparedTransactions: [],
  };
}

describe("pinned SSH known_hosts filtering", () => {
  it("keeps only exact fingerprint matches from a mixed scanned key set", () => {
    const fingerprint = `SHA256:${"A".repeat(43)}`;
    const candidates = [
      "release.example ssh-ed25519 AAAA-correct-key",
      "release.example ecdsa-sha2-nistp256 AAAA-unmatched-key",
    ].join("\n");

    const trusted = filterKnownHostRecords(candidates, fingerprint, (_keyType, keyData) => (
      keyData === "AAAA-correct-key" ? fingerprint : `SHA256:${"B".repeat(43)}`
    ));

    expect(trusted).toBe("release.example ssh-ed25519 AAAA-correct-key\n");
    expect(trusted).not.toContain("AAAA-unmatched-key");
  });

  it("fails closed when no scanned record matches the exact fingerprint", () => {
    expect(() => filterKnownHostRecords(
      "release.example ssh-ed25519 AAAA-unmatched-key\n",
      `SHA256:${"A".repeat(43)}`,
      () => `SHA256:${"B".repeat(43)}`,
    )).toThrow("No scanned SSH host key matched");
  });
});

describe("production backup envelope", () => {
  it("encrypts to a restrictive custom envelope and authenticates the complete archive", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-backup-test-"));
    const output = path.join(directory, "backup.pgdump.enc");
    const key = Buffer.alloc(32, 9);
    const source = Buffer.from("custom-format-postgresql-archive\0bytes");
    try {
      const result = await encryptBackupStream(Readable.from([source]), output, key);
      const encrypted = await readFile(output);
      const chunks = [];
      await decryptBackupToWritable(output, new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }), key);

      expect(result.inputBytes).toBe(source.length);
      expect(encrypted.subarray(0, 8).toString("ascii")).toBe("BCPGDMP1");
      expect(Buffer.concat(chunks)).toEqual(source);
      if (process.platform !== "win32") expect((await stat(output)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a wrong key, tampering, empty input, and malformed key material", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-backup-negative-"));
    const output = path.join(directory, "backup.pgdump.enc");
    const key = Buffer.alloc(32, 3);
    try {
      await expect(encryptBackupStream(Readable.from([]), output, key)).rejects.toThrow("empty");
      await expect(stat(output)).rejects.toThrow();
      await encryptBackupStream(Readable.from([Buffer.from("archive")]), output, key);
      await expect(decryptBackupToWritable(output, new Writable({ write(_chunk, _encoding, callback) { callback(); } }), Buffer.alloc(32, 4))).rejects.toThrow();

      const corrupted = await readFile(output);
      corrupted[corrupted.length - 17] ^= 0x40;
      await writeFile(output, corrupted);
      await expect(decryptBackupToWritable(output, new Writable({ write(_chunk, _encoding, callback) { callback(); } }), key)).rejects.toThrow();
      expect(() => decodeBackupKey("not-a-key")).toThrow("32 bytes");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("production migration preflight evaluator", () => {
  it("keeps the rendered SQL object inventory aligned with the Stage 02 and release manifests", async () => {
    const sql = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    const rendered = renderProductionDbPreflightSql(sql);
    expect(rendered).toContain(JSON.stringify(getExpectedSchemaObjectNames()));
    expect(rendered).not.toContain("__EXPECTED_SCHEMA_OBJECTS_JSON__");
    expect(getExpectedSchemaObjectNames()).toEqual([...new Set([
      ...EXPECTED_MIGRATION_OBJECTS,
      ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects,
    ])].sort());
  });

  it("accepts only the exact full Active Energy pending set with Stage 02 preserved", () => {
    const migrations = ["20260801000000_baseline", ...STAGE_02_MANIFEST.migrations.map(({ name }) => name), ...EXPECTED_PENDING_MIGRATIONS];
    const result = evaluateProductionPreflight(preflightFixture(migrations), migrations);
    expect(result.readyForOwnerAuthorization).toBe(true);
    expect(result.pending).toEqual([...EXPECTED_PENDING_MIGRATIONS].sort());
  });

  it("blocks failed rows, partial target objects, and DDL-conflicting locks while retaining long-transaction diagnostics", () => {
    const migrations = ["20260801000000_baseline", ...STAGE_02_MANIFEST.migrations.map(({ name }) => name), ...EXPECTED_PENDING_MIGRATIONS];
    const report = preflightFixture(migrations);
    report.migrations.push({ name: "20260801000000_baseline", startedAt: "2026-09-02T00:00:00.000Z", finishedAt: null, rolledBackAt: null, hasLogs: true });
    report.objects.find((object) => object.name === ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects[0]).present = true;
    report.longTransactions.push({ pid: 100, xactAgeSeconds: 500 });
    report.conflictingLocks.push({ pid: 100, relation: "PhysiologyV7Lifecycle", mode: "AccessShareLock", granted: true });

    const result = evaluateProductionPreflight(report, migrations);
    expect(result.readyForOwnerAuthorization).toBe(false);
    expect(result.blockers.join(" ")).toContain("Incomplete/failed migration");
    expect(result.blockers.join(" ")).toContain("already exist");
    expect(result.blockers.join(" ")).toContain("conflict with the exact migration DDL");
    expect(result.diagnostics.longTransactions).toEqual(report.longTransactions);
  });

  it("reports backend and pid-less prepared lock blockers without unverified per-lock attribution", async () => {
    const sql = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    expect(sql).toContain("LEFT JOIN pg_stat_activity a ON a.pid = l.pid");
    expect(sql).toContain("prepared_transactions AS (");
    expect(sql).toContain("'preparedTransactions'");
    expect(sql).toContain('prepared AS "preparedAt"');
    expect(sql).toContain('transaction::text AS transaction');
    expect(sql).toContain("l.pid IS NULL OR l.pid <> pg_backend_pid()");
    expect(sql).toContain("CASE WHEN l.pid IS NULL THEN 'prepared-transaction'");

    const preparedTransactions = [{ gid: "diagnostic-only", transaction: "42", preparedAt: "2026-09-01T00:00:00Z", database: "bodycast" }];
    const report = evaluateProductionPreflight({
      ...preflightFixture(["20260801000000_baseline", ...STAGE_02_MANIFEST.migrations.map(({ name }) => name), ...EXPECTED_PENDING_MIGRATIONS]),
      preparedTransactions,
    }, ["20260801000000_baseline", ...STAGE_02_MANIFEST.migrations.map(({ name }) => name), ...EXPECTED_PENDING_MIGRATIONS]);
    expect(report.readyForOwnerAuthorization).toBe(true);
    expect(report.preparedTransactions).toEqual(preparedTransactions);
  });

  it("requires restored migration history and baseline tables to match the source report", () => {
    const source = preflightFixture(["20260801000000_baseline", ...STAGE_02_MANIFEST.migrations.map(({ name }) => name), ...EXPECTED_PENDING_MIGRATIONS]);
    expect(verifyRestoredBackup(
      source,
      { migrationHistory: source.migrations, objects: source.objects, readability: Object.fromEntries(["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"].map((name) => [name, { rowCount: 1 }])) },
    ).verified).toBe(true);
    expect(verifyRestoredBackup(
      source,
      { migrationHistory: [], objects: source.objects, readability: { Workout: { rowCount: 0 } } },
    ).verified).toBe(false);
  });
});

describe("disposable restore safety gate", () => {
  it("accepts only explicitly labelled nonproduction disposable containers on local Docker", () => {
    expect(isDisposableNonProductionTarget({ container: "bodycast-test-pg", environment: "nonproduction", disposable: "true" })).toBe(true);
    expect(isDisposableNonProductionTarget({ container: "bodycast-db-prod", environment: "nonproduction", disposable: "true" })).toBe(false);
    expect(isDisposableNonProductionTarget({ container: "bodycast-test-pg", environment: "production", disposable: "true" })).toBe(false);
    expect(isDisposableNonProductionTarget({ container: "bodycast-test-pg", environment: "nonproduction", disposable: "false" })).toBe(false);
    expect(isProductionLikeName("prod")).toBe(true);
    expect(isProductionLikeName("production-context")).toBe(true);
    expect(isProductionLikeName("bodycast-test-pg")).toBe(false);
    expect(isLocalDockerEndpoint("npipe:////./pipe/docker_engine")).toBe(true);
    expect(isLocalDockerEndpoint("npipe:////prod-host/pipe/docker_engine")).toBe(false);
    expect(isLocalDockerEndpoint("npipe:////./pipe/docker_engine/extra")).toBe(false);
    expect(isLocalDockerEndpoint("npipe:///./pipe/docker_engine")).toBe(false);
    expect(isLocalDockerEndpoint("unix:///var/run/docker.sock")).toBe(true);
    expect(isLocalDockerEndpoint("ssh://production.example/docker.sock")).toBe(false);
    expect(isLocalDockerEndpoint("tcp://10.0.0.3:2376")).toBe(false);
  });

  it("refuses a restore without explicit nonproduction confirmation before contacting Docker", async () => {
    await expect(verifyEncryptedBackupOnDisposableTarget({
      container: "bodycast-db-prod",
      user: "bodycast",
      backup: "bodycast.pgdump.enc",
      confirmation: "",
    }, {})).rejects.toThrow("Explicit container/user/backup");
  });

  it("rejects production-like restore container names before inspecting Docker or reading a key", async () => {
    await expect(verifyEncryptedBackupOnDisposableTarget({
      container: "bodycast-db-prod",
      user: "bodycast",
      backup: "not-present.pgdump.enc",
      confirmation: "nonproduction-disposable",
    }, {})).rejects.toThrow("production-like container names are forbidden");
  });

  it("refuses an implicit or unconfirmed backup source before contacting Docker", async () => {
    await expect(createEncryptedPostgresBackup({
      container: "bodycast-db-prod",
      database: "bodycast",
      user: "bodycast",
      output: "bodycast-production-20261001T120000Z.pgdump.enc",
      confirmation: "",
    }, {})).rejects.toThrow("Explicit container/database/user/output");

    await expect(createEncryptedPostgresBackup({
      container: "bodycast-db-prod",
      database: "bodycast",
      user: "bodycast",
      output: "bodycast-production.pgdump.enc",
      confirmation: "read-only-production-snapshot",
    }, { PRODUCTION_BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") })).rejects.toThrow("UTC timestamp");
  });

  it("rejects a remote DOCKER_CONTEXT combined with a local-looking DOCKER_HOST", () => {
    expect(() => dockerTargetSelection({
      DOCKER_CONTEXT: "remote-context",
      DOCKER_HOST: "unix:///var/run/docker.sock",
    })).toThrow("DOCKER_CONTEXT and DOCKER_HOST conflict");
  });
});

describe("workflow mutation boundary", () => {
  it("keeps production inspection read-only and runs migrate deploy only on the restored disposable database", async () => {
    const workflow = await readFile(new URL("../.github/workflows/production-migration-preflight.yml", import.meta.url), "utf8");
    const safetyWorkflow = await readFile(new URL("../.github/workflows/production-migration-safety-ci.yml", import.meta.url), "utf8");
    const sql = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pg_dump --format=custom");
    expect(workflow).toContain("production-backup-envelope.mjs encrypt");
    expect(workflow).toContain("isolated-postgres:");
    expect(workflow).toContain("postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24");
    expect(workflow).not.toMatch(/image:\s+postgres:17-alpine\s*$/m);
    expect(workflow).toContain("scripts/filter-ssh-known-hosts.mjs");
    expect(safetyWorkflow).toContain('"scripts/filter-ssh-known-hosts.mjs"');
    expect(workflow).toContain("DATABASE_URL: postgresql://bodycast_restore:");
    expect(workflow).toContain("npx prisma migrate deploy --schema prisma/schema.prisma");
    expect(workflow.indexOf("node scripts/production-migration-restore-check.mjs --base")).toBeLessThan(workflow.indexOf("npx prisma migrate deploy --schema prisma/schema.prisma"));
    expect(workflow).toContain("production migration: NOT EXECUTED");
    expect(sql).toMatch(/^BEGIN READ ONLY;/);
    expect(sql).toContain("JOIN ddl_targets t ON t.table_name = c.relname");
    expect(sql).toContain("l.pid IS NULL OR l.pid <> pg_backend_pid()");
    expect(sql).not.toMatch(/^\s*(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
    expect(safetyWorkflow.match(/image:\s+postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24/g)).toHaveLength(2);
    expect(safetyWorkflow).not.toMatch(/image:\s+postgres:17-alpine\s*$/m);
    const smoke = await readFile(new URL("../scripts/ci/production-safety-postgres-smoke.mjs", import.meta.url), "utf8");
    expect(workflow).toContain("node scripts/restore-encrypted-postgres-backup.mjs");
    expect(workflow).not.toContain("bodycast-archive-list.txt");
    expect(smoke).toContain("restoreEncryptedPostgresBackup");
    expect(smoke).toContain('const POSTGRES_IMAGE = "postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24"');
    expect(smoke).not.toContain('"postgres:17-alpine"');
  });
});
