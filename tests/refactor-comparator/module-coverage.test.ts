import { describe, expect, it } from "vitest";
import frozenManifest from "./module-coverage-v1.json";
import type { ModuleCoverageManifest, ModuleCoverageMetric } from "../../scripts/refactor/module-coverage-core.mjs";
import {
  assertRepeatedModuleCoverageMatches,
  EXPECTED_MODULE_COVERAGE_MANIFEST_SHA256,
  filterModuleCoverageSourcePaths,
  normalizeModuleCoverageReportPath,
  validateModuleCoverageManifest,
  verifyPinnedModuleCoverageManifest,
  verifyFrozenExcludedPathBlobs,
  verifyFrozenModuleCoverageInventory,
  verifyModuleCoverage,
} from "../../scripts/refactor/module-coverage-core.mjs";
import { readFileSync } from "node:fs";

const ROOT = "src/modules/training";
const BASELINE_SHA = "1".repeat(40);
const BLOB_A = "a".repeat(40);
const BLOB_B = "b".repeat(40);

function metric(covered: number, total: number): ModuleCoverageMetric {
  return { covered, total, pct: total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)) };
}

function file(path: string, coverage: number, gitBlobSha: string) {
  const baseline = {
    lines: metric(coverage, 100),
    functions: metric(coverage, 100),
    statements: metric(coverage, 100),
    branches: metric(coverage, 100),
  };
  return { path, gitBlobSha, baseline };
}

function makeManifest(): ModuleCoverageManifest {
  return {
    schemaVersion: 1,
    baselineSha: BASELINE_SHA,
    measurement: {
      provider: "istanbul",
      selection: "related",
      nodeMajor: 24,
      nodeVersion: "v24.19.0",
      v8Version: "13.6.233.17-node.51",
      profile: "exact-tracked-paths-istanbul-v1",
      coverageAll: true,
      ci: true,
      nodeEnv: "test",
      maxWorkers: 4,
      minWorkers: 1,
      vitestVersion: "3.2.7",
      coverageProviderVersion: "3.2.7",
      reportSha256: "c".repeat(64),
      logSha256: "d".repeat(64),
      confirmationReportSha256: "c".repeat(64),
      confirmationLogSha256: "e".repeat(64),
      baselineTestInputFingerprintSha256: "f".repeat(64),
      baselineTestSelectionFingerprintSha256: "a".repeat(64),
      repeatedRunCount: 2,
      sourceFileCount: 2,
      testFileCount: 1,
      testsPassed: 1,
    },
    sourceRoots: [ROOT],
    minimumForNewFiles: { lines: 85, functions: 85, statements: 85, branches: 80 },
    excludedPaths: [],
    files: [
      file(`${ROOT}/a.ts`, 50, BLOB_A),
      file(`${ROOT}/b.ts`, 100, BLOB_B),
    ],
    pathMoves: [],
  };
}

function reportMetric(covered: number, total: number) {
  return metric(covered, total);
}

function reportFor(paths: string[], coverageForPath: (filePath: string) => number, total = 100) {
  return Object.fromEntries(paths.map((filePath) => {
    const covered = coverageForPath(filePath);
    const metrics = {
      lines: reportMetric(covered, total),
      functions: reportMetric(covered, total),
      statements: reportMetric(covered, total),
      branches: reportMetric(covered, total),
    };
    return [filePath, metrics];
  }));
}

describe("per-file module coverage gate", () => {
  it("accepts the frozen per-file baseline", () => {
    const manifest = makeManifest();
    const paths = manifest.files.map(({ path }) => path);

    expect(verifyModuleCoverage({
      manifest,
      trackedPaths: paths,
      coverageSummary: reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 50 : 100),
      repoRoot: "D:\\repo",
    })).toMatchObject({ baselineFilesChecked: 2, totalFilesChecked: 2, newFilesChecked: [] });
  });

  it("fails a per-file regression even when other files keep aggregate coverage high", () => {
    const manifest = makeManifest();
    const paths = manifest.files.map(({ path }) => path);
    const report = reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 49 : 100);

    expect(() => verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: report, repoRoot: "D:\\repo" }))
      .toThrow("src/modules/training/a.ts lines coverage 49.00% is below frozen floor 50.00%.");
  });

  it("fails closed when a baseline path is absent from the candidate inventory or report", () => {
    const manifest = makeManifest();
    const [firstPath, secondPath] = manifest.files.map(({ path }) => path);

    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: [firstPath!],
      coverageSummary: reportFor([firstPath!], () => 50),
      repoRoot: "D:\\repo",
    })).toThrow(`Frozen baseline path is missing without an explicit path move: ${secondPath}.`);
    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: [firstPath!, secondPath!],
      coverageSummary: reportFor([firstPath!], () => 50),
      repoRoot: "D:\\repo",
    })).toThrow(`Coverage report is missing required path ${secondPath}.`);
  });

  it("rejects coverage report paths outside the tracked module inventory", () => {
    const manifest = makeManifest();
    const trackedPaths = manifest.files.map(({ path }) => path);
    const unexpectedPath = `${ROOT}/untracked-report-only.ts`;

    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths,
      coverageSummary: reportFor([...trackedPaths, unexpectedPath], (filePath) => filePath.endsWith("untracked-report-only.ts") ? 100 : 50),
      repoRoot: "D:\\repo",
    })).toThrow(`Coverage report contains paths outside the tracked module inventory: ${unexpectedPath}.`);
  });

  it("requires new files to satisfy fixed 85/85/85/80 percent floors", () => {
    const manifest = makeManifest();
    const paths = [...manifest.files.map(({ path }) => path), `${ROOT}/new-module.ts`];
    const belowFloor = reportFor(paths, (filePath) => {
      if (filePath.endsWith("/a.ts")) return 50;
      if (filePath.endsWith("/b.ts")) return 100;
      return 84;
    });

    expect(() => verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: belowFloor, repoRoot: "D:\\repo" }))
      .toThrow("src/modules/training/new-module.ts lines coverage 84.00% is below the new-file floor 85%.");

    const atFloor = reportFor(paths, (filePath) => {
      if (filePath.endsWith("/a.ts")) return 50;
      if (filePath.endsWith("/b.ts")) return 100;
      return 85;
    });
    expect(verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: atFloor, repoRoot: "D:\\repo" }).newFilesChecked)
      .toEqual([`${ROOT}/new-module.ts`]);

    const belowBranchFloor = reportFor(paths, (filePath) => {
      if (filePath.endsWith("/a.ts")) return 50;
      if (filePath.endsWith("/b.ts")) return 100;
      return 85;
    });
    belowBranchFloor[`${ROOT}/new-module.ts`].branches = reportMetric(79, 100);
    expect(() => verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: belowBranchFloor, repoRoot: "D:\\repo" }))
      .toThrow("src/modules/training/new-module.ts branches coverage 79.00% is below the new-file floor 80%.");
  });

  it("uses the fixed new-file floor when a frozen metric had no executable observations", () => {
    const manifest = makeManifest();
    const entry = manifest.files[0]!;
    entry.baseline.lines = metric(0, 0);
    const paths = manifest.files.map(({ path }) => path);
    const report = reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 84 : 100);

    expect(() => verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: report, repoRoot: "D:\\repo" }))
      .toThrow("src/modules/training/a.ts lines coverage 84.00% is below frozen floor 85.00%.");
  });

  it("fails closed if a previously executable file disappears from instrumentation", () => {
    const manifest = makeManifest();
    const paths = manifest.files.map(({ path }) => path);
    const report = reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 50 : 100);
    const empty = metric(0, 0);
    report[`${ROOT}/a.ts`] = { lines: empty, functions: empty, statements: empty, branches: empty };

    expect(() => verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: report, repoRoot: "D:\\repo" }))
      .toThrow("src/modules/training/a.ts lines coverage has no instrumented points; frozen baseline had 100.");
  });

  it("accepts an explicit one-to-one path move and rejects an ambiguous move", () => {
    const manifest = makeManifest();
    manifest.files = [manifest.files[0]!];
    manifest.measurement.sourceFileCount = 1;
    const oldPath = manifest.files[0]!.path;
    const newPath = `${ROOT}/renamed-a.ts`;
    manifest.pathMoves = [{ from: oldPath, to: newPath }];
    const report = reportFor([newPath], () => 50);

    expect(verifyModuleCoverage({ manifest, trackedPaths: [newPath], coverageSummary: report, repoRoot: "D:\\repo" }).movedPaths)
      .toEqual([{ from: oldPath, to: newPath }]);
    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: [oldPath, newPath],
      coverageSummary: reportFor([oldPath, newPath], () => 50),
      repoRoot: "D:\\repo",
    })).toThrow(`Path move source still exists in the candidate inventory: ${oldPath}.`);
  });

  it("normalizes Windows report paths and rejects paths outside the repository", () => {
    expect(normalizeModuleCoverageReportPath("D:\\repo\\src\\modules\\training\\a.ts", "D:\\repo"))
      .toBe(`${ROOT}/a.ts`);
    expect(() => normalizeModuleCoverageReportPath("D:\\outside\\a.ts", "D:\\repo"))
      .toThrow("Coverage path is outside the repository root");
    expect(() => normalizeModuleCoverageReportPath("../outside/a.ts", "D:\\repo"))
      .toThrow("Coverage path is outside the repository root");
  });

  it("rejects duplicate normalized paths in the coverage report", () => {
    const manifest = makeManifest();
    const metrics = reportMetric(50, 100);
    const report = {
      "D:\\repo\\src\\modules\\training\\a.ts": { lines: metrics, functions: metrics, statements: metrics, branches: metrics },
      [`${ROOT}/a.ts`]: { lines: metrics, functions: metrics, statements: metrics, branches: metrics },
    };

    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: manifest.files.map(({ path }) => path),
      coverageSummary: report,
      repoRoot: "D:\\repo",
    })).toThrow(`Coverage summary repeats normalized path ${ROOT}/a.ts.`);
  });

  it("requires two coverage reports to match exact paths and covered/total counts", () => {
    const paths = makeManifest().files.map(({ path }) => path);
    const first = reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 50 : 100);
    const sameInDifferentOrder = Object.fromEntries(Object.entries(first).reverse());

    expect(assertRepeatedModuleCoverageMatches({
      firstSummary: first,
      secondSummary: sameInDifferentOrder,
      repoRoot: "D:\\repo",
    })).toEqual({ filesCompared: 2 });

    const changedCovered = structuredClone(first);
    changedCovered[`${ROOT}/a.ts`].branches = reportMetric(49, 100);
    expect(() => assertRepeatedModuleCoverageMatches({
      firstSummary: first,
      secondSummary: changedCovered,
      repoRoot: "D:\\repo",
    })).toThrow(`Repeated module coverage differs for ${ROOT}/a.ts branches: 50/100 vs 49/100.`);

    const changedTotal = structuredClone(first);
    changedTotal[`${ROOT}/a.ts`].functions = reportMetric(51, 102);
    expect(() => assertRepeatedModuleCoverageMatches({
      firstSummary: first,
      secondSummary: changedTotal,
      repoRoot: "D:\\repo",
    })).toThrow(`Repeated module coverage differs for ${ROOT}/a.ts functions: 50/100 vs 51/102.`);

    const missingPath = { ...first };
    delete missingPath[`${ROOT}/b.ts`];
    expect(() => assertRepeatedModuleCoverageMatches({
      firstSummary: first,
      secondSummary: missingPath,
      repoRoot: "D:\\repo",
    })).toThrow(`Repeated module coverage path set differs; missingFromSecond=${ROOT}/b.ts; unexpectedInSecond=none.`);
  });
});

describe("frozen module coverage inventory", () => {
  it("keeps the checked-in executable-file baseline and explicit exclusions internally consistent", () => {
    expect(() => validateModuleCoverageManifest(frozenManifest)).not.toThrow();
    expect(frozenManifest.files).toHaveLength(71);
    expect(frozenManifest.measurement.sourceFileCount).toBe(71);
    expect(frozenManifest.excludedPaths).toHaveLength(5);
    expect(frozenManifest.excludedPaths.map(({ path }) => path)).toEqual(expect.arrayContaining([
      "src/modules/training/experimental-strength-energy.ts",
      "src/modules/training/index.ts",
      "src/modules/training/training.types.ts",
    ]));
    expect(frozenManifest.measurement.provider).toBe("istanbul");
    expect(frozenManifest.measurement.coverageProviderVersion).toBe("3.2.7");
    expect(frozenManifest.measurement.baselineTestInputFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(frozenManifest.measurement.baselineTestSelectionFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("pins the canonical checked-in baseline manifest content and rejects a sentinel edit", () => {
    const bytes = readFileSync(new URL("./module-coverage-v1.json", import.meta.url));
    expect(verifyPinnedModuleCoverageManifest(bytes)).toBe(EXPECTED_MODULE_COVERAGE_MANIFEST_SHA256);
    const windowsLineEndings = Buffer.from(bytes.toString("utf8").replace(/\n/g, "\r\n"), "utf8");
    expect(verifyPinnedModuleCoverageManifest(windowsLineEndings)).toBe(EXPECTED_MODULE_COVERAGE_MANIFEST_SHA256);

    const changedBytes = Buffer.from(bytes);
    changedBytes[0] = changedBytes[0]! ^ 1;
    expect(() => verifyPinnedModuleCoverageManifest(changedBytes))
      .toThrow("does not match the reviewed pin.");
  });

  it("fails closed if an uninstrumented compatibility path changes or disappears", () => {
    const manifest = makeManifest();
    const excludedPath = `${ROOT}/compatibility-export.ts`;
    manifest.excludedPaths = [{
      path: excludedPath,
      gitBlobSha: BLOB_A,
      reason: "Re-export-only compatibility contract has no Istanbul executable counters.",
    }];

    expect(verifyFrozenExcludedPathBlobs({
      manifest,
      candidateBlobShas: { [excludedPath]: BLOB_A },
    })).toEqual({ excludedFilesChecked: 1 });
    expect(() => verifyFrozenExcludedPathBlobs({
      manifest,
      candidateBlobShas: { [excludedPath]: BLOB_B },
    })).toThrow(`Frozen excluded path changed without an executable coverage baseline update: ${excludedPath}.`);
    expect(() => verifyFrozenExcludedPathBlobs({ manifest, candidateBlobShas: {} }))
      .toThrow(`Frozen excluded path is missing from the candidate tree: ${excludedPath}.`);
  });

  it("requires every eligible baseline file and verifies its Git blob identity", () => {
    const manifest = makeManifest();
    const paths = manifest.files.map(({ path }) => path);
    const blobShas = Object.fromEntries(manifest.files.map(({ path, gitBlobSha }) => [path, gitBlobSha]));

    expect(verifyFrozenModuleCoverageInventory({ manifest, baselinePaths: paths, baselineBlobShas: blobShas }))
      .toEqual({ baselineSourceFilesChecked: 2, baselineBlobFilesChecked: 2 });
    expect(() => verifyFrozenModuleCoverageInventory({
      manifest,
      baselinePaths: paths,
      baselineBlobShas: { ...blobShas, [paths[0]!]: "e".repeat(40) },
    })).toThrow(`Frozen Git blob identity changed for ${paths[0]}.`);
    expect(() => verifyFrozenModuleCoverageInventory({
      manifest,
      baselinePaths: [...paths, `${ROOT}/unlisted.ts`],
      baselineBlobShas: blobShas,
    })).toThrow("Frozen source inventory mismatch");
  });

  it("retains excluded test-support paths as hashed, reasoned baseline entries", () => {
    const manifest = makeManifest();
    const excludedPath = `${ROOT}/testing/database-helper.ts`;
    manifest.excludedPaths = [{
      path: excludedPath,
      gitBlobSha: "e".repeat(40),
      reason: "Test support file, excluded from the product source coverage gate.",
    }];
    const paths = [...manifest.files.map(({ path }) => path), excludedPath];
    const blobShas = Object.fromEntries([
      ...manifest.files.map(({ path, gitBlobSha }) => [path, gitBlobSha]),
      [excludedPath, "e".repeat(40)],
    ]);

    expect(verifyFrozenModuleCoverageInventory({ manifest, baselinePaths: paths, baselineBlobShas: blobShas }).baselineBlobFilesChecked)
      .toBe(3);
    expect(filterModuleCoverageSourcePaths(paths, manifest)).not.toContain(excludedPath);
  });

  it("rejects overlapping source roots and malformed or duplicated frozen paths", () => {
    const manifest = makeManifest();
    manifest.sourceRoots = ["src/modules", ROOT];
    expect(() => validateModuleCoverageManifest(manifest)).toThrow("sourceRoots must not overlap.");

    const duplicate = makeManifest();
    duplicate.files[1] = { ...duplicate.files[0]! };
    expect(() => validateModuleCoverageManifest(duplicate)).toThrow("Baseline file paths contains duplicates.");
    expect(() => filterModuleCoverageSourcePaths(["../outside.ts"], makeManifest()))
      .toThrow("sourcePaths[0] must not escape the repository root.");
  });
});
