import { describe, expect, it } from "vitest";
import frozenManifest from "./module-coverage-v1.json";
import type { ModuleCoverageManifest, ModuleCoverageMetric } from "../../scripts/refactor/module-coverage-core.mjs";
import {
  filterModuleCoverageSourcePaths,
  normalizeModuleCoverageReportPath,
  validateModuleCoverageManifest,
  verifyFrozenModuleCoverageInventory,
  verifyGlobalCoverage,
  verifyModuleCoverage,
} from "../../scripts/refactor/module-coverage-core.mjs";

const ROOT = "src/modules/training";
const BASELINE_SHA = "1".repeat(40);
type CoverageFileSummary = Record<"lines" | "functions" | "statements" | "branches", ModuleCoverageMetric>;

function metric(covered: number, total: number): ModuleCoverageMetric {
  return { covered, total, pct: total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)) };
}

function file(path: string, coverage: number) {
  const baseline = {
    lines: metric(coverage, 100),
    functions: metric(coverage, 100),
    statements: metric(coverage, 100),
    branches: metric(coverage, 100),
  };
  return { path, baseline };
}

function makeManifest(): ModuleCoverageManifest {
  return {
    schemaVersion: 2,
    baselineSha: BASELINE_SHA,
    measurement: "vitest-unit-shards-v8",
    sourceRoots: [ROOT],
    minimumForNewFiles: { lines: 85, functions: 85, statements: 85, branches: 80 },
    excludedPaths: [],
    files: [file(`${ROOT}/a.ts`, 50), file(`${ROOT}/b.ts`, 100)],
    pathMoves: [],
  };
}

function reportFor(paths: string[], coverageForPath: (filePath: string) => number, total = 100) {
  const summary: Record<string, CoverageFileSummary> = {};
  const aggregate = { covered: 0, total: 0 };
  for (const filePath of paths) {
    const covered = coverageForPath(filePath);
    const value = metric(covered, total);
    const metrics = { lines: value, functions: value, statements: value, branches: value };
    summary[filePath] = metrics;
    aggregate.covered += covered;
    aggregate.total += total;
  }
  const all = metric(aggregate.covered, aggregate.total);
  summary.total = { lines: all, functions: all, statements: all, branches: all };
  return summary;
}

describe("merged unit coverage gate", () => {
  it("accepts the frozen per-file floors from a merged report", () => {
    const manifest = makeManifest();
    const paths = manifest.files.map(({ path }) => path);
    expect(verifyModuleCoverage({
      manifest,
      trackedPaths: paths,
      coverageSummary: reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 50 : 100),
      repoRoot: "D:\\repo",
    })).toMatchObject({ baselineFilesChecked: 2, totalFilesChecked: 2, newFilesChecked: [] });
  });

  it("fails a per-file regression even when the combined report remains high", () => {
    const manifest = makeManifest();
    const paths = manifest.files.map(({ path }) => path);
    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: paths,
      coverageSummary: reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 49 : 100),
      repoRoot: "D:\\repo",
    })).toThrow("src/modules/training/a.ts lines coverage 49.00% is below frozen floor 50.00%.");
  });

  it("fails closed when a required file is absent from the merged report or source inventory", () => {
    const manifest = makeManifest();
    const [first, second] = manifest.files.map(({ path }) => path);
    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: [first!],
      coverageSummary: reportFor([first!], () => 50),
      repoRoot: "D:\\repo",
    })).toThrow(`Frozen baseline path is missing without a valid path move: ${second}.`);
    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: [first!, second!],
      coverageSummary: reportFor([first!], () => 50),
      repoRoot: "D:\\repo",
    })).toThrow(`Merged coverage report is missing required module path ${second}.`);
  });

  it("accepts new source only at the fixed 85/85/85/80 floors", () => {
    const manifest = makeManifest();
    const paths = [...manifest.files.map(({ path }) => path), `${ROOT}/new-module.ts`];
    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: paths,
      coverageSummary: reportFor(paths, (filePath) => filePath.endsWith("new-module.ts") ? 84 : filePath.endsWith("/a.ts") ? 50 : 100),
      repoRoot: "D:\\repo",
    })).toThrow("src/modules/training/new-module.ts lines coverage 84.00% is below frozen floor 85.00%.");
    const atFloor = reportFor(paths, (filePath) => filePath.endsWith("new-module.ts") ? 85 : filePath.endsWith("/a.ts") ? 50 : 100);
    expect(verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: atFloor, repoRoot: "D:\\repo" }).newFilesChecked)
      .toEqual([`${ROOT}/new-module.ts`]);
    atFloor[`${ROOT}/new-module.ts`].branches = metric(79, 100);
    expect(() => verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: atFloor, repoRoot: "D:\\repo" }))
      .toThrow("src/modules/training/new-module.ts branches coverage 79.00% is below frozen floor 80.00%.");
  });

  it("fails closed when a new module path has no line or statement observations", () => {
    const manifest = makeManifest();
    const paths = [...manifest.files.map(({ path }) => path), `${ROOT}/new-module.ts`];
    const summary = reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 50 : 100);
    summary[`${ROOT}/new-module.ts`] = {
      lines: metric(0, 0), functions: metric(0, 0), statements: metric(0, 0), branches: metric(0, 0),
    };
    expect(() => verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: summary, repoRoot: "D:\\repo" }))
      .toThrow("src/modules/training/new-module.ts has no instrumented lines or statements; merged coverage cannot verify executable code.");
  });

  it("uses the new-file floor when a frozen metric had no executable observations", () => {
    const manifest = makeManifest();
    manifest.files[0]!.baseline.lines = metric(0, 0);
    const paths = manifest.files.map(({ path }) => path);
    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: paths,
      coverageSummary: reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 84 : 100),
      repoRoot: "D:\\repo",
    })).toThrow("src/modules/training/a.ts lines coverage 84.00% is below frozen floor 85.00%.");
    const zeroLineReport = reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 50 : 100);
    zeroLineReport[`${ROOT}/a.ts`].lines = metric(0, 0);
    expect(() => verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: zeroLineReport, repoRoot: "D:\\repo" }))
      .toThrow("src/modules/training/a.ts has no instrumented lines or statements; merged coverage cannot verify executable code.");
  });

  it("fails if an executable file disappears from V8 instrumentation", () => {
    const manifest = makeManifest();
    const paths = manifest.files.map(({ path }) => path);
    const report = reportFor(paths, (filePath) => filePath.endsWith("/a.ts") ? 50 : 100);
    report[`${ROOT}/a.ts`] = { lines: metric(0, 0), functions: metric(0, 0), statements: metric(0, 0), branches: metric(0, 0) };
    expect(() => verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: report, repoRoot: "D:\\repo" }))
      .toThrow("src/modules/training/a.ts has no instrumented lines or statements; merged coverage cannot verify executable code.");
  });

  it("accepts a one-to-one path move and rejects ambiguous inventory", () => {
    const manifest = makeManifest();
    const oldPath = manifest.files[0]!.path;
    const newPath = `${ROOT}/renamed-a.ts`;
    manifest.files = [manifest.files[0]!];
    manifest.pathMoves = [{ from: oldPath, to: newPath }];
    expect(verifyModuleCoverage({
      manifest,
      trackedPaths: [newPath],
      coverageSummary: reportFor([newPath], () => 50),
      repoRoot: "D:\\repo",
    }).movedPaths).toEqual([{ from: oldPath, to: newPath }]);
    expect(() => verifyModuleCoverage({
      manifest,
      trackedPaths: [oldPath, newPath],
      coverageSummary: reportFor([oldPath, newPath], () => 50),
      repoRoot: "D:\\repo",
    })).toThrow(`Path move source still exists in the candidate inventory: ${oldPath}.`);
  });

  it("ignores other report scopes while retaining module-level missing-file checks", () => {
    const manifest = makeManifest();
    const paths = manifest.files.map(({ path }) => path);
    const outside = "src/app/api/profile/route.ts";
    const summary = reportFor([...paths, outside], (filePath) => filePath.endsWith("/a.ts") ? 50 : 100);
    expect(verifyModuleCoverage({ manifest, trackedPaths: paths, coverageSummary: summary, repoRoot: "D:\\repo" }).totalFilesChecked)
      .toBe(2);
  });

  it("combines global metrics only over the established include scope", () => {
    const global = "src/model/core.ts";
    const moduleSource = `${ROOT}/a.ts`;
    const unrelated = "src/app/api/test/route.ts";
    const summary = reportFor([global, moduleSource, unrelated], (filePath) => filePath === global ? 86 : 20);
    expect(verifyGlobalCoverage({
      coverageSummary: summary,
      trackedPaths: [global, moduleSource, unrelated],
      includePatterns: ["src/model/**/*.ts"],
      thresholds: { lines: 85, branches: 80, functions: 85, statements: 85 },
      repoRoot: "D:\\repo",
    })).toMatchObject({ filesChecked: 1, metrics: { lines: { covered: 86, total: 100, pct: 86 } } });
  });

  it("fails closed when the merged report omits an expected global source file", () => {
    const source = "src/model/core.ts";
    const summary = reportFor(["src/modules/training/a.ts"], () => 100);
    expect(() => verifyGlobalCoverage({
      coverageSummary: summary,
      trackedPaths: [source],
      includePatterns: ["src/model/**/*.ts"],
      thresholds: { lines: 85, branches: 80, functions: 85, statements: 85 },
      repoRoot: "D:\\repo",
    })).toThrow(`Merged coverage report is missing global-scope path ${source}.`);
  });

  it("fails closed when global metrics have no instrumented points", () => {
    const source = "src/model/core.ts";
    const summary = reportFor([source], () => 0, 0);
    expect(() => verifyGlobalCoverage({
      coverageSummary: summary,
      trackedPaths: [source],
      includePatterns: ["src/model/**/*.ts"],
      thresholds: { lines: 85, branches: 80, functions: 85, statements: 85 },
      repoRoot: "D:\\repo",
    })).toThrow("Merged global lines coverage has no instrumented points.");
  });

  it("uses the same two-decimal percent rounding as Vitest global thresholds", () => {
    const source = "src/model/core.ts";
    const rounded = metric(849_999, 1_000_000);
    const metrics = { lines: rounded, branches: rounded, functions: rounded, statements: rounded };
    const summary = { [source]: metrics, total: metrics };
    expect(verifyGlobalCoverage({
      coverageSummary: summary,
      trackedPaths: [source],
      includePatterns: ["src/model/**/*.ts"],
      thresholds: { lines: 85, branches: 80, functions: 85, statements: 85 },
      repoRoot: "D:\\repo",
    }).metrics.lines.pct).toBe(85);
  });

  it("normalizes Windows paths and rejects paths outside the checkout", () => {
    expect(normalizeModuleCoverageReportPath("D:\\repo\\src\\modules\\training\\a.ts", "D:\\repo"))
      .toBe(`${ROOT}/a.ts`);
    expect(() => normalizeModuleCoverageReportPath("D:\\outside\\a.ts", "D:\\repo"))
      .toThrow("Coverage path is outside the repository root");
    expect(() => normalizeModuleCoverageReportPath("../outside/a.ts", "D:\\repo"))
      .toThrow("Coverage path is outside the repository root");
  });

  it("rejects duplicate normalized report paths", () => {
    const manifest = makeManifest();
    const metrics = metric(50, 100);
    const summary = {
      "D:\\repo\\src\\modules\\training\\a.ts": { lines: metrics, functions: metrics, statements: metrics, branches: metrics },
      [`${ROOT}/a.ts`]: { lines: metrics, functions: metrics, statements: metrics, branches: metrics },
      total: { lines: metrics, functions: metrics, statements: metrics, branches: metrics },
    };
    expect(() => verifyModuleCoverage({ manifest, trackedPaths: manifest.files.map(({ path }) => path), coverageSummary: summary, repoRoot: "D:\\repo" }))
      .toThrow(`Coverage summary repeats normalized path ${ROOT}/a.ts.`);
  });
});

describe("frozen module coverage inventory", () => {
  it("accepts the checked-in baseline and confirms it has no repeat-run bookkeeping", () => {
    expect(() => validateModuleCoverageManifest(frozenManifest)).not.toThrow();
    expect(frozenManifest.measurement).toBe("vitest-unit-shards-v8");
    expect("testFileCount" in frozenManifest).toBe(false);
    expect("testInputFingerprint" in frozenManifest).toBe(false);
    expect(filterModuleCoverageSourcePaths([
      "src/modules/training/a.ts",
      "src/modules/training/testing/database-helper.ts",
    ], { ...frozenManifest, excludedPaths: [{ path: "src/modules/training/testing/database-helper.ts", reason: "Test helper." }] } as ModuleCoverageManifest))
      .toEqual(["src/modules/training/a.ts"]);
  });

  it("requires the checked-in baseline source inventory", () => {
    const manifest = makeManifest();
    const paths = manifest.files.map(({ path }) => path);
    expect(verifyFrozenModuleCoverageInventory({ manifest, baselinePaths: paths }))
      .toEqual({ baselineSourceFilesChecked: 2 });
    expect(() => verifyFrozenModuleCoverageInventory({
      manifest,
      baselinePaths: [...paths, `${ROOT}/unlisted.ts`],
    })).toThrow("Frozen source inventory does not match");
  });

  it("keeps exclusions reasoned and separate from measured files", () => {
    const manifest = makeManifest();
    const excludedPath = `${ROOT}/compatibility-export.ts`;
    manifest.excludedPaths = [{ path: excludedPath, reason: "Compatibility re-export." }];
    expect(() => validateModuleCoverageManifest(manifest)).not.toThrow();
    expect(filterModuleCoverageSourcePaths([excludedPath, `${ROOT}/measured.ts`], manifest))
      .toEqual([`${ROOT}/measured.ts`]);
  });
});
