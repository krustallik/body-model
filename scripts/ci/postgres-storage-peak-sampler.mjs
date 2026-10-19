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
  "wal_entry=\"$data_path/pg_wal\"",
  "wal_path=\"$(readlink -f \"$wal_entry\")\"",
  "[ -d \"$data_path\" ] && [ -d \"$wal_path\" ] || { printf '%s\\n' 'PGDATA or pg_wal is not a directory.' >&2; exit 1; }",
  "root_allocation=\"$(stat -c '%b|%B' \"$data_path\")\"",
  "case \"$root_allocation\" in *'|'*) root_blocks=\"${root_allocation%%|*}\"; root_block_bytes=\"${root_allocation#*|}\";; *) printf '%s\\n' 'PGDATA allocation output is malformed.' >&2; exit 1;; esac",
  "case \"$root_blocks\" in ''|*[!0-9]*) printf '%s\\n' 'PGDATA allocation output is malformed.' >&2; exit 1;; esac",
  "case \"$root_block_bytes\" in ''|*[!0-9]*) printf '%s\\n' 'PGDATA allocation output is malformed.' >&2; exit 1;; esac",
  "printf 'R|%s|%s\\n' \"$root_blocks\" \"$root_block_bytes\"",
  // BusyBox du has no GNU --exclude contract; exclude the WAL entry explicitly and measure its resolved target once below.
  "for path in \"$data_path\"/* \"$data_path\"/.[!.]* \"$data_path\"/..?*; do",
  "  [ -e \"$path\" ] || [ -L \"$path\" ] || continue",
  "  [ \"$path\" = \"$wal_entry\" ] && continue",
  "  usage=\"$(du -sk -- \"$path\")\" || exit $?",
  "  set -- $usage",
  "  [ \"$#\" -eq 2 ] || { printf '%s\\n' 'PGDATA du output is malformed.' >&2; exit 1; }",
  "  case \"$1\" in ''|*[!0-9]*) printf '%s\\n' 'PGDATA du output is malformed.' >&2; exit 1;; esac",
  "  [ \"$2\" = \"$path\" ] || { printf '%s\\n' 'PGDATA du path does not match.' >&2; exit 1; }",
  "  printf 'D|%s\\n' \"$1\"",
  "done",
  "wal_usage=\"$(du -sk -- \"$wal_path\")\" || exit $?",
  "set -- $wal_usage",
  "[ \"$#\" -eq 2 ] || { printf '%s\\n' 'WAL du output is malformed.' >&2; exit 1; }",
  "case \"$1\" in ''|*[!0-9]*) printf '%s\\n' 'WAL du output is malformed.' >&2; exit 1;; esac",
  "[ \"$2\" = \"$wal_path\" ] || { printf '%s\\n' 'WAL du path does not match.' >&2; exit 1; }",
  "printf 'W|%s\\n' \"$1\"",
].join("\n");

function sample() {
  const result = spawnSync("docker", ["exec", containerId, "sh", "-eu", "-c", storageProbe], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = String(result.stderr ?? "");
  if (result.error || result.status !== 0 || stderr.trim() !== "") {
    const diagnostic = (stderr || result.error?.message || `docker exec exited with status ${result.status ?? "unknown"}`)
      .trim().slice(0, 512);
    throw new Error(`Could not sample isolated PostgreSQL data/WAL allocation: ${diagnostic}`);
  }
  if (!result.stdout.endsWith("\n")) throw new Error("Isolated PostgreSQL allocation sample is malformed.");
  const output = result.stdout.replace(/\r?\n$/, "");
  if (!output || output.endsWith("\n") || output.includes("\r")) {
    throw new Error("Isolated PostgreSQL allocation sample is malformed.");
  }
  const rows = output.split(/\r?\n/);
  let dataBytes = 0n;
  let walBytes = null;
  let rootBlocks = null;
  let dataEntries = 0;
  for (const row of rows) {
    const rootMatch = /^R\|(\d+)\|(\d+)$/.exec(row);
    if (rootMatch) {
      const blocks = BigInt(rootMatch[1]);
      const blockBytes = BigInt(rootMatch[2]);
      if (rootBlocks !== null || blockBytes < 1n) {
        throw new Error("Isolated PostgreSQL allocation sample is malformed.");
      }
      rootBlocks = blocks * blockBytes;
      continue;
    }
    const match = /^(D|W)\|(\d+)$/.exec(row);
    if (!match) throw new Error("Isolated PostgreSQL allocation sample is malformed.");
    const value = BigInt(match[2]);
    if (match[1] === "D") {
      dataBytes += value * 1024n;
      dataEntries += 1;
    } else {
      if (walBytes !== null) throw new Error("Isolated PostgreSQL allocation sample is malformed.");
      walBytes = value * 1024n;
    }
  }
  if (rootBlocks === null || walBytes === null || dataEntries === 0) {
    throw new Error("Isolated PostgreSQL allocation sample is malformed.");
  }
  dataBytes += rootBlocks;
  if (dataBytes > BigInt(Number.MAX_SAFE_INTEGER) || walBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Isolated PostgreSQL allocation sample is outside the safe byte range.");
  }
  const dataByteCount = Number(dataBytes);
  const walByteCount = Number(walBytes);
  if (!Number.isSafeInteger(dataByteCount) || dataByteCount < 1 || !Number.isSafeInteger(walByteCount) || walByteCount < 0) {
    throw new Error("Isolated PostgreSQL allocation sample is outside the safe byte range.");
  }
  return { dataBytes: dataByteCount, walBytes: walByteCount };
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
