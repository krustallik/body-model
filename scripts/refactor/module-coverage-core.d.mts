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
    provider: "v8";
    selection: "related";
    nodeMajor: 24;
    vitestVersion: string;
    reportSha256: string;
    logSha256: string;
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

export function validateModuleCoverageRelativePath(value: unknown, label: string): string;
export function validateModuleCoverageManifest(value: unknown): ModuleCoverageManifest;
export function normalizeModuleCoverageReportPath(value: unknown, repoRoot: string): string;
export function filterModuleCoverageSourcePaths(paths: string[], manifest: ModuleCoverageManifest): string[];
export function verifyFrozenModuleCoverageInventory(args: {
  manifest: ModuleCoverageManifest;
  baselinePaths: string[];
  baselineBlobShas: Record<string, string>;
}): { baselineSourceFilesChecked: number; baselineBlobFilesChecked: number };
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
