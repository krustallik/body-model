import { execFileSync } from "node:child_process";
import { statSync, statfsSync, realpathSync } from "node:fs";

const GIB = 1024 ** 3;
const OS_FREE_RESERVE_BYTES = 10 * GIB;
const fail = (message) => { throw new Error(`V4 recovery disk headroom blocked: ${message}`); };

export function recoveryTerminalMarkerBudgetTemplate(startMarker, input) {
  return { ...startMarker,
    state: "completed", result: "current", finishedAt: "2000-01-01T00:00:00.000Z",
    sourceFingerprint: input.sourceFingerprint, postflightSchemaSha256: input.schemaSha256,
    sourceModelDayKeys: [...input.sourceModelDayKeys], coveredModelDayKeys: [...input.coveredModelDayKeys],
    rehearsalCoverageSha256: input.rehearsalCoverageSha256,
    sourceModelDayCount: Number.MAX_SAFE_INTEGER, coveredDayCount: Number.MAX_SAFE_INTEGER,
    blocksRemaining: Number.MAX_SAFE_INTEGER, unifiedPublishedGeneration: Number.MAX_SAFE_INTEGER,
    productionPublishedGeneration: Number.MAX_SAFE_INTEGER,
    unifiedTargetRevision: input.unifiedTargetRevision, unifiedPublicationBlockedFromDate: null,
    rolloutEpoch: Number.MAX_SAFE_INTEGER };
}

export function serializedRecoveryMarkerBytes(marker) {
  return Buffer.byteLength(`${JSON.stringify(marker)}\n`);
}

function positiveSafeInteger(value, name, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) fail(`${name} is malformed.`);
  return value;
}

function filesystem(path) {
  let canonical;
  try { canonical = realpathSync(path); } catch { fail(`Required filesystem path is absent: ${path}`); }
  const stat = statSync(canonical);
  const fs = statfsSync(canonical);
  const availableBytes = fs.bavail * fs.bsize;
  if (!Number.isSafeInteger(availableBytes) || availableBytes < 0) fail(`Could not measure available bytes at ${canonical}.`);
  if (!Number.isSafeInteger(fs.bsize) || fs.bsize < 1) fail(`Could not measure filesystem allocation size at ${canonical}.`);
  return { path: canonical, device: String(stat.dev), availableBytes, blockSize: fs.bsize };
}

function directoryAllocatedBytes(path, excludeWal = false) {
  let output;
  try {
    output = execFileSync("du", ["-sx", "-B1", ...(excludeWal ? ["--exclude=pg_wal"] : []), "--", path],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    fail(`Could not measure allocated PostgreSQL bytes at ${path}.`);
  }
  const match = /^(\d+)\t[^\r\n]+(?:\r?\n)?$/.exec(output);
  if (!match) fail(`Could not parse allocated PostgreSQL bytes at ${path}.`);
  const bytes = Number(match[1]);
  if (!Number.isSafeInteger(bytes) || bytes < 1) fail(`Allocated PostgreSQL bytes at ${path} are malformed.`);
  return bytes;
}

function livePostgresUsage(postgresData, postgresWal, measureDirectoryUsage) {
  const postgresDataBytes = measureDirectoryUsage(postgresData.path, true);
  const postgresWalBytes = measureDirectoryUsage(postgresWal.path);
  return { postgresDataBytes, postgresWalBytes };
}

export function calculateRecoveryHeadroom({ phase, metrics, paths, imagePresent, measureFilesystem = filesystem,
  measureDirectoryUsage = directoryAllocatedBytes }) {
  if (!["before-transfer", "before-load", "before-execute"].includes(phase)) fail("Unknown gate phase.");
  for (const key of ["archiveBytes", "imageBytes", "dataPeakGrowthBytes", "walPeakGrowthBytes", "temporaryPeakBytes"]) {
    positiveSafeInteger(metrics[key], key, true);
  }
  for (const key of ["archiveBytes", "imageBytes", "recoveryStartMarkerBytes", "recoveryTerminalMarkerBytes"]) {
    positiveSafeInteger(metrics[key], key);
  }
  if (imagePresent !== true && imagePresent !== false) fail("Image presence is unknown.");

  const locations = {
    root: measureFilesystem(paths.root),
    artifact: measureFilesystem(paths.artifact),
    docker: measureFilesystem(paths.docker),
    postgresData: measureFilesystem(paths.postgresData),
    postgresWal: measureFilesystem(paths.postgresWal),
    temporary: measureFilesystem(paths.temporary),
    recoveryState: measureFilesystem(paths.recoveryState),
  };
  const filesystems = new Map();
  for (const location of Object.values(locations)) {
    const prior = filesystems.get(location.device);
    if (!prior) filesystems.set(location.device, { device: location.device, availableBytes: location.availableBytes,
      blockSize: location.blockSize, paths: [location.path], requiredBytes: 0, reasons: [] });
    else {
      prior.availableBytes = Math.min(prior.availableBytes, location.availableBytes);
      if (!prior.paths.includes(location.path)) prior.paths.push(location.path);
    }
  }
  const add = (location, bytes, reason) => {
    if (bytes === 0) return;
    const target = filesystems.get(location.device);
    target.requiredBytes += bytes;
    if (!Number.isSafeInteger(target.requiredBytes)) fail("Combined recovery disk requirement exceeds the supported byte range.");
    target.reasons.push({ reason, bytes });
  };

  const liveUsage = livePostgresUsage(locations.postgresData, locations.postgresWal, measureDirectoryUsage);

  for (const location of Object.values(locations)) {
    const afterScan = measureFilesystem(location.path);
    if (afterScan.path !== location.path || afterScan.device !== location.device || afterScan.blockSize !== location.blockSize) {
      fail("Filesystem identity changed during the measurement.");
    }
    const target = filesystems.get(location.device);
    target.availableBytes = Math.min(target.availableBytes, afterScan.availableBytes);
  }

  add(locations.root, OS_FREE_RESERVE_BYTES, "minimum-operating-system-free-reserve");
  add(locations.postgresData, liveUsage.postgresDataBytes, "reserve-equal-to-live-allocated-postgres-data");
  add(locations.postgresData, metrics.dataPeakGrowthBytes, "measured-peak-recovery-postgres-data-growth");
  if (liveUsage.postgresWalBytes > 0) {
    add(locations.postgresWal, liveUsage.postgresWalBytes, "reserve-equal-to-live-allocated-postgres-wal");
  }
  add(locations.postgresWal, metrics.walPeakGrowthBytes, "measured-peak-recovery-postgres-wal-growth");
  if (phase === "before-transfer") add(locations.artifact, metrics.archiveBytes, "transferred-image-archive");
  if (phase !== "before-execute" && !imagePresent) {
    add(locations.docker, 2 * metrics.imageBytes, "image-load-staging-plus-retained-image-layers");
  }
  add(locations.temporary, metrics.temporaryPeakBytes, "measured-recovery-temporary-files");
  const markerBlocks = (bytes) => Math.ceil(bytes / locations.recoveryState.blockSize) + 1;
  const markerPeakBytes = (markerBlocks(metrics.recoveryStartMarkerBytes)
    + markerBlocks(metrics.recoveryTerminalMarkerBytes)) * locations.recoveryState.blockSize;
  add(locations.recoveryState, markerPeakBytes, "simultaneous-start-and-terminal-one-shot-markers-with-allocation-blocks");

  const report = [...filesystems.values()].map((entry) => ({ ...entry, paths: entry.paths.sort() }))
    .sort((left, right) => left.device.localeCompare(right.device));
  const insufficient = report.filter((entry) => entry.availableBytes < entry.requiredBytes);
  if (insufficient.length) {
    fail(JSON.stringify({ phase, filesystems: report.map(({ device, availableBytes, requiredBytes, reasons, paths: mountedPaths }) => ({
      device, availableBytes, requiredBytes, reasons, paths: mountedPaths,
    })) }));
  }
  return { phase, osFreeReserveBytes: OS_FREE_RESERVE_BYTES, livePostgresUsage: liveUsage, filesystems: report };
}

if (process.argv[2] === "--check") {
  const [, , , phase, metricsJson, artifact, docker, postgresData, postgresWal, temporary, recoveryState, imagePresentText] = process.argv;
  try {
    const imagePresent = imagePresentText === "true" ? true : imagePresentText === "false" ? false : undefined;
    const report = calculateRecoveryHeadroom({ phase, metrics: JSON.parse(metricsJson), imagePresent,
      paths: { root: "/", artifact, docker, postgresData, postgresWal, temporary, recoveryState } });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "V4 recovery disk headroom blocked"}\n`);
    process.exitCode = 1;
  }
}
