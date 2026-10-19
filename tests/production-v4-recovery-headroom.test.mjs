import { describe, expect, it } from "vitest";
import { calculateRecoveryHeadroom } from "../scripts/production-v4-recovery-headroom.mjs";

const GiB = 1024 ** 3;
const metrics = { archiveBytes: 500, imageBytes: 1_000,
  dataPeakGrowthBytes: 200, walPeakGrowthBytes: 300, temporaryPeakBytes: 100,
  recoveryStartMarkerBytes: 3000, recoveryTerminalMarkerBytes: 5000 };
const paths = { root: "/root", artifact: "/artifact", docker: "/docker", postgresData: "/pgdata",
  postgresWal: "/pgwal", temporary: "/temporary", recoveryState: "/recovery" };
const liveUsage = { "/pgdata": 10_000, "/pgwal": 2_000 };

function measureWith(devices, freeByDevice) {
  return (path) => ({ path, device: devices[path], availableBytes: freeByDevice[devices[path]], blockSize: 4096 });
}

function measureUsage(values = liveUsage) {
  return (path) => values[path];
}

const markerAllocation = (bytes) => Math.ceil(bytes / 4096) * 4096 + 4096;
const markerPeakAllocation = markerAllocation(metrics.recoveryStartMarkerBytes) + markerAllocation(metrics.recoveryTerminalMarkerBytes);

describe("V4 recovery filesystem headroom gate", () => {
  it("sums archive, image staging, measured PostgreSQL/WAL, temp, and reserves on a shared filesystem", () => {
    const devices = Object.fromEntries(Object.values(paths).map((path) => [path, "root"]));
    const required = 10 * GiB + liveUsage[paths.postgresData] + liveUsage[paths.postgresWal]
      + metrics.archiveBytes + 2 * metrics.imageBytes + metrics.temporaryPeakBytes + markerPeakAllocation
      + metrics.dataPeakGrowthBytes + metrics.walPeakGrowthBytes;
    const report = calculateRecoveryHeadroom({ phase: "before-transfer", metrics, paths, imagePresent: false,
      measureFilesystem: measureWith(devices, { root: required }), measureDirectoryUsage: measureUsage() });
    expect(report.filesystems).toHaveLength(1);
    expect(report.filesystems[0].requiredBytes).toBe(required);
    expect(report.filesystems[0].availableBytes).toBe(required);
  });

  it("keeps PostgreSQL/WAL requirements separate when the real mount devices differ", () => {
    const devices = { "/root": "root", "/artifact": "root", "/docker": "root", "/temporary": "root",
      "/pgdata": "pg", "/pgwal": "wal", "/recovery": "state" };
    const rootRequired = 10 * GiB + metrics.archiveBytes + 2 * metrics.imageBytes + metrics.temporaryPeakBytes;
    const pgRequired = liveUsage[paths.postgresData] + metrics.dataPeakGrowthBytes;
    const walRequired = liveUsage[paths.postgresWal] + metrics.walPeakGrowthBytes;
    const report = calculateRecoveryHeadroom({ phase: "before-transfer", metrics, paths, imagePresent: false,
      measureFilesystem: measureWith(devices, { root: rootRequired, pg: pgRequired, wal: walRequired, state: markerPeakAllocation }),
      measureDirectoryUsage: measureUsage() });
    expect(report.filesystems.map((item) => [item.device, item.requiredBytes])).toEqual([
      ["pg", pgRequired], ["root", rootRequired], ["state", markerPeakAllocation], ["wal", walRequired],
    ]);
  });

  it("fails closed before archive transfer when the shared root filesystem is short", () => {
    const devices = Object.fromEntries(Object.values(paths).map((path) => [path, "root"]));
    expect(() => calculateRecoveryHeadroom({ phase: "before-transfer", metrics, paths, imagePresent: false,
      measureFilesystem: measureWith(devices, { root: 10 * GiB }), measureDirectoryUsage: measureUsage() })).toThrow(/disk headroom blocked/);
  });

  it("rechecks image load and execute using only the still-unconsumed bytes", () => {
    const devices = Object.fromEntries(Object.values(paths).map((path) => [path, "root"]));
    const beforeLoad = 10 * GiB + liveUsage[paths.postgresData] + liveUsage[paths.postgresWal]
      + 2 * metrics.imageBytes + metrics.temporaryPeakBytes + markerPeakAllocation
      + metrics.dataPeakGrowthBytes + metrics.walPeakGrowthBytes;
    expect(calculateRecoveryHeadroom({ phase: "before-load", metrics, paths, imagePresent: false,
      measureFilesystem: measureWith(devices, { root: beforeLoad }), measureDirectoryUsage: measureUsage() }).filesystems[0].requiredBytes).toBe(beforeLoad);
    const beforeExecute = 10 * GiB + liveUsage[paths.postgresData] + liveUsage[paths.postgresWal]
      + metrics.temporaryPeakBytes + markerPeakAllocation + metrics.dataPeakGrowthBytes + metrics.walPeakGrowthBytes;
    expect(calculateRecoveryHeadroom({ phase: "before-execute", metrics, paths, imagePresent: true,
      measureFilesystem: measureWith(devices, { root: beforeExecute }), measureDirectoryUsage: measureUsage() }).filesystems[0].requiredBytes).toBe(beforeExecute);
    expect(() => calculateRecoveryHeadroom({ phase: "before-execute", metrics, paths, imagePresent: true,
      measureFilesystem: measureWith(devices, { root: beforeExecute - 1 }), measureDirectoryUsage: measureUsage() })).toThrow(/disk headroom blocked/);
  });

  it("fails the later gate if filesystem availability falls after an earlier successful check", () => {
    const devices = Object.fromEntries(Object.values(paths).map((path) => [path, "root"]));
    const beforeTransferRequired = 10 * GiB + liveUsage[paths.postgresData] + liveUsage[paths.postgresWal]
      + metrics.archiveBytes + 2 * metrics.imageBytes + metrics.temporaryPeakBytes + markerPeakAllocation
      + metrics.dataPeakGrowthBytes + metrics.walPeakGrowthBytes;
    let available = beforeTransferRequired;
    const measureFilesystem = measureWith(devices, { get root() { return available; } });
    expect(calculateRecoveryHeadroom({ phase: "before-transfer", metrics, paths, imagePresent: false,
      measureFilesystem, measureDirectoryUsage: measureUsage() }).filesystems[0].availableBytes).toBe(beforeTransferRequired);

    available = beforeTransferRequired - metrics.archiveBytes - 1;
    expect(() => calculateRecoveryHeadroom({ phase: "before-load", metrics, paths, imagePresent: false,
      measureFilesystem, measureDirectoryUsage: measureUsage() })).toThrow(/disk headroom blocked/);
  });

  it("rechecks filesystem availability after PGDATA/WAL scans instead of trusting a stale pre-scan snapshot", () => {
    const devices = Object.fromEntries(Object.values(paths).map((path) => [path, "root"]));
    const required = 10 * GiB + liveUsage[paths.postgresData] + liveUsage[paths.postgresWal]
      + metrics.archiveBytes + 2 * metrics.imageBytes + metrics.temporaryPeakBytes + markerPeakAllocation
      + metrics.dataPeakGrowthBytes + metrics.walPeakGrowthBytes;
    let scanningStarted = false;
    const measureFilesystem = (path) => ({ path, device: devices[path], availableBytes: scanningStarted ? required - 1 : required, blockSize: 4096 });
    const measureDirectoryUsage = (path) => { scanningStarted = true; return liveUsage[path]; };
    expect(() => calculateRecoveryHeadroom({ phase: "before-transfer", metrics, paths, imagePresent: false,
      measureFilesystem, measureDirectoryUsage })).toThrow(/disk headroom blocked/);
  });

  it("fails closed if a measured filesystem path changes identity during the usage scan", () => {
    const devices = Object.fromEntries(Object.values(paths).map((path) => [path, "root"]));
    let scanningStarted = false;
    const measureFilesystem = (path) => ({ path, device: scanningStarted && path === paths.postgresData ? "replacement" : devices[path],
      availableBytes: 100 * GiB, blockSize: 4096 });
    const measureDirectoryUsage = () => { scanningStarted = true; return 1; };
    expect(() => calculateRecoveryHeadroom({ phase: "before-transfer", metrics, paths, imagePresent: false,
      measureFilesystem, measureDirectoryUsage })).toThrow(/Filesystem identity changed during the measurement/);
  });

  it("rejects either absent one-shot marker budget", () => {
    const missingMarkerBudget = { ...metrics };
    delete missingMarkerBudget.recoveryTerminalMarkerBytes;
    const devices = Object.fromEntries(Object.values(paths).map((path) => [path, "root"]));
    expect(() => calculateRecoveryHeadroom({ phase: "before-execute", metrics: missingMarkerBudget, paths, imagePresent: true,
      measureFilesystem: measureWith(devices, { root: 100 * GiB }), measureDirectoryUsage: measureUsage() }))
      .toThrow(/recoveryTerminalMarkerBytes is malformed/);
  });

  it("fails before execute when only the start marker, not the simultaneous terminal receipt, fits", () => {
    const devices = Object.fromEntries(Object.values(paths).map((path) => [path, "root"]));
    const requiredWithoutMarkers = 10 * GiB + liveUsage[paths.postgresData] + liveUsage[paths.postgresWal]
      + metrics.temporaryPeakBytes + metrics.dataPeakGrowthBytes + metrics.walPeakGrowthBytes;
    const startOnly = requiredWithoutMarkers + markerAllocation(metrics.recoveryStartMarkerBytes);
    expect(startOnly).toBeLessThan(requiredWithoutMarkers + markerPeakAllocation);
    expect(() => calculateRecoveryHeadroom({ phase: "before-execute", metrics, paths, imagePresent: true,
      measureFilesystem: measureWith(devices, { root: startOnly }), measureDirectoryUsage: measureUsage() }))
      .toThrow(/disk headroom blocked/);
  });
});
