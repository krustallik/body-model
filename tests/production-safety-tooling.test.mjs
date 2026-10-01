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
import {
  isDisposableNonProductionTarget,
  isLocalDockerEndpoint,
  isProductionLikeName,
  dockerTargetSelection,
  verifyEncryptedBackupOnDisposableTarget,
} from "../scripts/verify-postgres-restore.mjs";
import { filterKnownHostRecords } from "../scripts/filter-ssh-known-hosts.mjs";

function preflightFixture(migrationDirectories) {
  const appliedMigrations = migrationDirectories.filter((name) => !EXPECTED_PENDING_MIGRATIONS.includes(name));
  return {
    identity: { database: "bodycast", role: "bodycast", serverVersion: "17.0" },
    migrations: appliedMigrations.map((name) => ({
      name,
      startedAt: "2026-09-01T00:00:00.000Z",
      finishedAt: "2026-09-01T00:00:01.000Z",
      rolledBackAt: null,
      hasLogs: false,
    })),
    objects: EXPECTED_MIGRATION_OBJECTS.map((name) => ({ name, present: false })),
    tables: {
      StrengthDiarySession: { exists: true, estimatedRows: 22, totalBytes: 4096 },
      ExerciseCatalog: { exists: true, estimatedRows: 44, totalBytes: 8192 },
    },
    longTransactions: [],
    relevantLocks: [],
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
  it("keeps the SQL object inventory aligned with the reviewed manifest", async () => {
    const sql = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    const sqlNames = [...sql.matchAll(/^\s*\('([^']+)',/gm)].map((match) => match[1]).sort();
    expect(sqlNames).toEqual([...EXPECTED_MIGRATION_OBJECTS].sort());
  });

  it("accepts only the exact pending Stage 02 pair when the schema is otherwise clean", () => {
    const migrations = ["20260801000000_baseline", ...EXPECTED_PENDING_MIGRATIONS];
    const result = evaluateProductionPreflight(preflightFixture(migrations), migrations);
    expect(result.readyForOwnerAuthorization).toBe(true);
    expect(result.pending).toEqual([...EXPECTED_PENDING_MIGRATIONS].sort());
  });

  it("blocks failed rows, partial/manual objects, long transactions, and relevant locks", () => {
    const migrations = ["20260801000000_baseline", ...EXPECTED_PENDING_MIGRATIONS];
    const report = preflightFixture(migrations);
    report.migrations.push({ name: "20260801000000_baseline", startedAt: "2026-09-02T00:00:00.000Z", finishedAt: null, rolledBackAt: null, hasLogs: true });
    report.objects.find((object) => object.name === "StrengthSessionAccountingSnapshot").present = true;
    report.longTransactions.push({ pid: 100, xactAgeSeconds: 500 });
    report.relevantLocks.push({ pid: 100, relation: "StrengthDiarySession", blockerCount: 1 });

    const result = evaluateProductionPreflight(report, migrations);
    expect(result.readyForOwnerAuthorization).toBe(false);
    expect(result.blockers.join(" ")).toContain("Incomplete/failed migration");
    expect(result.blockers.join(" ")).toContain("already exist");
    expect(result.blockers.join(" ")).toContain("transaction(s)");
    expect(result.blockers.join(" ")).toContain("relevant DDL-conflicting relation lock(s)");
  });

  it("reports backend and prepared-transaction lock sources without dropping pid-less locks", async () => {
    const sql = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    expect(sql).toContain("LEFT JOIN pg_stat_activity a ON a.pid = l.pid");
    expect(sql).toContain("LEFT JOIN pg_prepared_xacts prepared ON l.virtualtransaction = '-1/' || prepared.transaction");
    expect(sql).toContain("OR l.pid IS NULL");
    expect(sql).toContain("CASE WHEN l.pid IS NULL THEN 'prepared-transaction'");
    expect(sql).toContain("a.pid <> pg_backend_pid()");
    expect(sql).toContain("l.virtualtransaction AS \"virtualTransaction\"");
  });

  it("requires restored migration history and baseline tables to match the source report", () => {
    const history = [{ name: "baseline", startedAt: "t1", finishedAt: "t2", rolledBackAt: null, hasLogs: false }];
    expect(verifyRestoredBackup(
      { migrations: history },
      { migrationHistory: history, readability: { StrengthDiarySession: { rowCount: 0 }, ExerciseCatalog: { rowCount: 1 } } },
    ).verified).toBe(true);
    expect(verifyRestoredBackup(
      { migrations: history },
      { migrationHistory: [], readability: { StrengthDiarySession: { rowCount: 0 }, ExerciseCatalog: { rowCount: 1 } } },
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
  it("only defines a manually dispatched read-only preflight and never runs migrate deploy", async () => {
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
    expect(workflow).not.toMatch(/^\s*(?:npx|npm|pnpm|yarn)\s+(?:prisma\s+migrate|exec\s+prisma\s+migrate)\s+deploy\b/m);
    expect(sql).toMatch(/^BEGIN READ ONLY;/);
    expect(sql).toContain("JOIN alter_table_targets target ON target.table_name = c.relname");
    expect(sql).toContain("AND a.pid <> pg_backend_pid()");
    expect(sql).not.toMatch(/^\s*(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
    expect(safetyWorkflow.match(/image:\s+postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24/g)).toHaveLength(2);
    expect(safetyWorkflow).not.toMatch(/image:\s+postgres:17-alpine\s*$/m);
    const smoke = await readFile(new URL("../scripts/ci/production-safety-postgres-smoke.mjs", import.meta.url), "utf8");
    expect(smoke).toContain('const POSTGRES_IMAGE = "postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24"');
    expect(smoke).not.toContain('"postgres:17-alpine"');
  });
});
