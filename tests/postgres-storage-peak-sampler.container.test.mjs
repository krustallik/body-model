import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";

const POSTGRES_IMAGE = "docker.io/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const sampler = fileURLToPath(new URL("../scripts/ci/postgres-storage-peak-sampler.mjs", import.meta.url));
const actualContainerTest = process.env.BODYCAST_REQUIRE_POSTGRES_STORAGE_CONTAINER_TEST === "1" ? it : it.skip;

function docker(args, timeout = 120_000) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout, windowsHide: true });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || `docker exited with ${result.status ?? "unknown"}`).trim();
    throw new Error(`docker ${args[0]} failed: ${detail.slice(0, 2_000)}`);
  }
  return result.stdout.trim();
}

function allocatedKib(containerId, path) {
  const output = docker(["exec", containerId, "du", "-sk", "--", path]);
  const kib = Number(output.split(/\s+/, 1)[0]);
  expect(Number.isSafeInteger(kib)).toBe(true);
  return kib;
}

actualContainerTest("measures real PostgreSQL 17.11 PGDATA and mounted WAL allocation", async () => {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const containerName = `bodycast-storage-sampler-${suffix}`;
  const dataVolume = `bodycast-storage-sampler-data-${suffix}`;
  const walVolume = `bodycast-storage-sampler-wal-${suffix}`;
  const createdVolumes = [];
  const root = mkdtempSync(join(tmpdir(), "bodycast-pg-storage-container-"));
  let samplerProcess;
  let samplerExit;
  let containerId;
  let stdout = "";
  let stderr = "";

  try {
    for (const volume of [dataVolume, walVolume]) {
      expect(docker(["volume", "create", volume])).toBe(volume);
      createdVolumes.push(volume);
    }

    docker([
      "run", "--pull=always", "--detach", "--name", containerName,
      "--mount", `type=volume,source=${dataVolume},target=/var/lib/postgresql/data`,
      "--mount", `type=volume,source=${walVolume},target=/var/lib/postgresql/wal`,
      "--env", "POSTGRES_PASSWORD=isolated_storage_sampler_test",
      "--env", "POSTGRES_INITDB_WALDIR=/var/lib/postgresql/wal",
      POSTGRES_IMAGE,
      "-c", "wal_keep_size=256MB",
      "-c", "max_wal_size=512MB",
    ], 240_000);
    containerId = docker(["inspect", "--format", "{{.Id}}", containerName]);
    expect(containerId).toMatch(/^[a-f0-9]{64}$/);
    expect(docker(["inspect", "--format", "{{.Config.Image}}", containerName])).toBe(POSTGRES_IMAGE);

    const readyDeadline = Date.now() + 90_000;
    while (Date.now() < readyDeadline) {
      const ready = spawnSync("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "postgres"], {
        encoding: "utf8", timeout: 5_000, windowsHide: true,
      });
      if (ready.status === 0) break;
      await delay(250);
    }
    const version = docker(["exec", containerId, "psql", "--no-psqlrc", "-U", "postgres", "-d", "postgres", "-Atqc", "SELECT version()"]);
    expect(version).toContain("PostgreSQL 17.11");
    expect(version).toContain("linux-musl");

    const walTarget = docker(["exec", containerId, "readlink", "/var/lib/postgresql/data/pg_wal"]);
    expect(walTarget).toBe("/var/lib/postgresql/wal");
    const mounts = JSON.parse(docker(["inspect", "--format", "{{json .Mounts}}", containerName]));
    expect(mounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ Destination: "/var/lib/postgresql/data", Type: "volume" }),
      expect.objectContaining({ Destination: "/var/lib/postgresql/wal", Type: "volume" }),
    ]));

    const legacyProbe = [
      "set -eu",
      'data_path="$(readlink -f "${PGDATA:-/var/lib/postgresql/data}")"',
      'wal_path="$(readlink -f "$data_path/pg_wal")"',
      'data_bytes="$(du -sx -B1 --exclude=pg_wal -- "$data_path" | awk \'{print $1}\')"',
      'wal_bytes="$(du -sx -B1 -- "$wal_path" | awk \'{print $1}\')"',
      "printf '%s|%s\\n' \"$data_bytes\" \"$wal_bytes\"",
    ].join("\n");
    const legacy = spawnSync("docker", ["exec", containerId, "sh", "-eu", "-c", legacyProbe], {
      encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    expect(legacy.status).toBe(0);
    expect(legacy.stderr).not.toBe("");
    expect(legacy.stdout).not.toMatch(/^\d+\|\d+\r?\n?$/);

    const unsupported = spawnSync("docker", ["exec", containerId, "sh", "-eu", "-c", "du --bodycast-unsupported-option -- /var/lib/postgresql/data"], {
      encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    expect(unsupported.status).not.toBe(0);
    expect(unsupported.stderr).not.toBe("");
    process.stdout.write(`${JSON.stringify({
      postgresImage: POSTGRES_IMAGE,
      postgresVersion: version,
      legacyProbeExitCode: legacy.status,
      legacyProbeStdout: legacy.stdout.trim(),
      legacyProbeStderr: legacy.stderr.trim().slice(0, 512),
      unsupportedOptionExitCode: unsupported.status,
      unsupportedOptionStderr: unsupported.stderr.trim().slice(0, 512),
    })}\n`);

    docker(["exec", containerId, "psql", "--no-psqlrc", "--quiet", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
      "-c", "SELECT pg_create_physical_replication_slot('bodycast_storage_sampler_hold')",
      "-c", "CREATE TABLE sampler_payload (id integer PRIMARY KEY, payload text NOT NULL)",
      "-c", "ALTER TABLE sampler_payload ALTER COLUMN payload SET STORAGE EXTERNAL",
      "-c", "CHECKPOINT"]);

    const readyFile = join(root, "sampler-ready.json");
    const outputFile = join(root, "sampler-output.json");
    samplerProcess = spawn(process.execPath, [sampler, "--container-id", containerId, "--output", outputFile,
      "--ready-file", readyFile, "--interval-ms", "25"], {
      env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    samplerProcess.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    samplerProcess.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    samplerExit = once(samplerProcess, "exit");

    const sampleDeadline = Date.now() + 15_000;
    while (Date.now() < sampleDeadline) {
      try {
        JSON.parse(readFileSync(readyFile, "utf8"));
        break;
      } catch {
        if (samplerProcess.exitCode !== null) throw new Error(`Sampler failed before baseline evidence: ${stderr}`);
        await delay(25);
      }
    }
    const baselineEvidence = JSON.parse(readFileSync(readyFile, "utf8"));
    expect(baselineEvidence.containerId).toBe(containerId);
    expect(baselineEvidence.baseline.dataBytes).toBeGreaterThan(0);
    expect(baselineEvidence.baseline.walBytes).toBeGreaterThan(0);
    const independentPgDataBytes = allocatedKib(containerId, "/var/lib/postgresql/data") * 1024;
    const independentWalBytes = allocatedKib(containerId, "/var/lib/postgresql/wal") * 1024;
    expect(Math.abs(baselineEvidence.baseline.dataBytes - independentPgDataBytes)).toBeLessThanOrEqual(64 * 1024);
    expect(baselineEvidence.baseline.walBytes).toBe(independentWalBytes);

    docker(["exec", containerId, "psql", "--no-psqlrc", "--quiet", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
      "-c", "INSERT INTO sampler_payload SELECT g, repeat(md5(g::text), 1024) FROM generate_series(1, 1024) AS g",
      "-c", "CHECKPOINT",
      "-c", "SELECT pg_switch_wal()",
      "-c", "CHECKPOINT"]);
    await delay(300);
    samplerProcess.kill("SIGTERM");
    const [exitCode] = await samplerExit;
    expect(exitCode, stderr).toBe(0);

    const peak = JSON.parse(readFileSync(outputFile, "utf8"));
    expect(peak.samples).toBeGreaterThanOrEqual(3);
    expect(peak.baselineDataBytes).toBe(baselineEvidence.baseline.dataBytes);
    expect(peak.baselineWalBytes).toBe(baselineEvidence.baseline.walBytes);
    expect(peak.dataPeakGrowthBytes).toBeGreaterThan(0);
    expect(peak.walPeakGrowthBytes).toBeGreaterThan(0);
    expect(stdout).toContain('"walPeakGrowthBytes"');
  } finally {
    if (samplerProcess && samplerProcess.exitCode === null) {
      samplerProcess.kill("SIGKILL");
      await samplerExit?.catch(() => {});
    }
    if (containerId || containerName) spawnSync("docker", ["rm", "--force", containerId || containerName], { encoding: "utf8", timeout: 20_000, windowsHide: true });
    for (const volume of createdVolumes) spawnSync("docker", ["volume", "rm", "--force", volume], { encoding: "utf8", timeout: 20_000, windowsHide: true });
    rmSync(root, { recursive: true, force: true });
  }
}, 300_000);
