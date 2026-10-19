import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || options.has(key)) throw new Error("Malformed PostgreSQL storage sampler arguments.");
  options.set(key, value);
}

const containerId = options.get("--container-id");
const outputPath = options.get("--output");
const readyPath = options.get("--ready-file");
const intervalMs = Number(options.get("--interval-ms") ?? 100);
if (!/^[a-f0-9]{64}$/.test(containerId ?? "") || !outputPath || !readyPath
    || !Number.isSafeInteger(intervalMs) || intervalMs < 10 || intervalMs > 10_000) {
  throw new Error("PostgreSQL storage sampler requires an exact service container, output paths, and bounded interval.");
}

const storageProbe = [
  "set -eu",
  "data_path=\"$(readlink -f \"${PGDATA:-/var/lib/postgresql/data}\")\"",
  "wal_path=\"$(readlink -f \"$data_path/pg_wal\")\"",
  "data_bytes=\"$(du -sx -B1 --exclude=pg_wal -- \"$data_path\" | awk '{print $1}')\"",
  "wal_bytes=\"$(du -sx -B1 -- \"$wal_path\" | awk '{print $1}')\"",
  "printf '%s|%s\\n' \"$data_bytes\" \"$wal_bytes\"",
].join("\n");

function sample() {
  const result = spawnSync("docker", ["exec", containerId, "sh", "-eu", "-c", storageProbe], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("Could not sample isolated PostgreSQL data/WAL allocation.");
  const match = /^(\d+)\|(\d+)\r?\n?$/.exec(result.stdout);
  if (!match) throw new Error("Isolated PostgreSQL allocation sample is malformed.");
  const dataBytes = Number(match[1]);
  const walBytes = Number(match[2]);
  if (!Number.isSafeInteger(dataBytes) || dataBytes < 1 || !Number.isSafeInteger(walBytes) || walBytes < 0) {
    throw new Error("Isolated PostgreSQL allocation sample is outside the safe byte range.");
  }
  return { dataBytes, walBytes };
}

const startedAt = new Date().toISOString();
const baseline = sample();
let peak = { ...baseline };
let samples = 1;
let stop = false;
let resolveStop;
const stopped = new Promise((resolve) => { resolveStop = resolve; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stop = true; resolveStop(); });
writeFileSync(readyPath, `${JSON.stringify({ containerId, baseline, startedAt })}\n`, { flag: "wx", mode: 0o600 });

while (!stop) {
  await Promise.race([delay(intervalMs), stopped]);
  if (stop) break;
  const current = sample();
  peak = { dataBytes: Math.max(peak.dataBytes, current.dataBytes), walBytes: Math.max(peak.walBytes, current.walBytes) };
  samples += 1;
}

const final = sample();
peak = { dataBytes: Math.max(peak.dataBytes, final.dataBytes), walBytes: Math.max(peak.walBytes, final.walBytes) };
samples += 1;
const result = {
  containerId, startedAt, finishedAt: new Date().toISOString(), intervalMs, samples,
  baselineDataBytes: baseline.dataBytes, peakDataBytes: peak.dataBytes,
  dataPeakGrowthBytes: Math.max(0, peak.dataBytes - baseline.dataBytes),
  baselineWalBytes: baseline.walBytes, peakWalBytes: peak.walBytes,
  walPeakGrowthBytes: Math.max(0, peak.walBytes - baseline.walBytes),
};
writeFileSync(outputPath, `${JSON.stringify(result)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify(result)}\n`);
