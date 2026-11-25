export interface ModuleCoverageMetric {
  covered: number;
  total: number;
  pct: number;
}

export interface ModuleCoverageFile {
  path: string;
  baseline: Record<"lines" | "functions" | "statements" | "branches", ModuleCoverageMetric>;
}

export interface ModuleCoverageManifest {
  schemaVersion: 2;
  baselineSha: string;
  measurement: "vitest-unit-shards-v8";
  sourceRoots: string[];
  minimumForNewFiles: Record<"lines" | "functions" | "statements" | "branches", number>;
  excludedPaths: Array<{ path: string; reason: string }>;
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
}): { baselineSourceFilesChecked: number };
export function verifyGlobalCoverage(args: {
  coverageSummary: Record<string, unknown>;
  trackedPaths: string[];
  includePatterns: string[];
  excludedPaths?: string[];
  thresholds: Record<"lines" | "functions" | "statements" | "branches", number>;
  repoRoot: string;
}): { filesChecked: number; metrics: Record<string, ModuleCoverageMetric> };
export function verifyModuleCoverage(args: {
  manifest: ModuleCoverageManifest;
  coverageSummary: Record<string, unknown>;
  trackedPaths: string[];
  repoRoot: string;
}): {
  baselineFilesChecked: number;
  movedPaths: Array<{ from: string; to: string }>;
  newFilesChecked: string[];
  totalFilesChecked: number;
};
