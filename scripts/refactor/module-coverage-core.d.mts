export interface ModuleCoverageMetric {
  covered: number;
  total: number;
  pct: number;
}

export interface ModuleCoverageFile {
  path: string;
  gitBlobSha: string;
  baseline: Record<"lines" | "functions" | "statements" | "branches", ModuleCoverageMetric>;
}

export interface ModuleCoverageManifest {
  schemaVersion: 1;
  baselineSha: string;
  measurement: {
    provider: "istanbul";
    selection: "related";
    nodeMajor: 24;
    nodeVersion: string;
    v8Version: string;
    profile: "exact-tracked-paths-istanbul-single-worker-v1";
    coverageAll: true;
    ci: true;
    nodeEnv: "test";
    maxWorkers: 1;
    minWorkers: 1;
    vitestVersion: string;
    coverageProviderVersion: string;
    reportSha256: string;
    logSha256: string;
    confirmationReportSha256: string;
    confirmationLogSha256: string;
    baselineTestInputFingerprintSha256: string;
    baselineTestSelectionFingerprintSha256: string;
    repeatedRunCount: 2;
    sourceFileCount: number;
    testFileCount: number;
    testsPassed: number;
  };
  sourceRoots: string[];
  minimumForNewFiles: Record<"lines" | "functions" | "statements" | "branches", number>;
  excludedPaths: Array<{ path: string; gitBlobSha: string; reason: string }>;
  files: ModuleCoverageFile[];
  pathMoves: Array<{ from: string; to: string }>;
}

export const EXPECTED_MODULE_COVERAGE_MANIFEST_SHA256: string;
export function verifyPinnedModuleCoverageManifest(bytes: string | Uint8Array): string;
export function assertRepeatedModuleCoverageMatches(args: {
  firstSummary: Record<string, unknown>;
  secondSummary: Record<string, unknown>;
  repoRoot: string;
}): { filesCompared: number };
export function validateModuleCoverageRelativePath(value: unknown, label: string): string;
export function validateModuleCoverageTestPath(value: unknown, label?: string): string;
export function validateModuleCoverageManifest(value: unknown): ModuleCoverageManifest;
export function normalizeModuleCoverageReportPath(value: unknown, repoRoot: string): string;
export function filterModuleCoverageSourcePaths(paths: string[], manifest: ModuleCoverageManifest): string[];
export function verifyFrozenModuleCoverageInventory(args: {
  manifest: ModuleCoverageManifest;
  baselinePaths: string[];
  baselineBlobShas: Record<string, string>;
}): { baselineSourceFilesChecked: number; baselineBlobFilesChecked: number };
export function verifyFrozenExcludedPathBlobs(args: {
  manifest: ModuleCoverageManifest;
  candidateBlobShas: Record<string, string>;
}): { excludedFilesChecked: number };
export function verifyModuleCoverage(args: {
  manifest: ModuleCoverageManifest;
  coverageSummary: Record<string, unknown>;
  trackedPaths: string[];
  repoRoot: string;
}): {
  baselineSha: string;
  baselineFilesChecked: number;
  movedPaths: Array<{ from: string; to: string }>;
  newFilesChecked: string[];
  totalFilesChecked: number;
};
