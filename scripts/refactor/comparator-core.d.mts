export interface ComparatorArguments {
  baseSha: string;
  candidateSha: string;
  manifest: string;
  evidenceDir: string;
}

export interface DatabaseTarget {
  host: string;
  port: number;
  database: string;
  role: string;
}

export interface EvidenceSide {
  present: true;
  value: unknown;
}

export interface MissingEvidenceSide {
  present: false;
}

export interface JsonDifference {
  path: string;
  before: EvidenceSide | MissingEvidenceSide;
  after: EvidenceSide | MissingEvidenceSide;
}

export function parseComparatorArgs(argv: string[]): ComparatorArguments;
export function validateRelativePath(value: unknown, label: string): string;
export function validateResolvedPostgresImage(image: string, repoDigests: unknown): string;
export function validateManifest(value: unknown): Record<string, unknown>;
export function assertAdditiveManifestExtension(baseValue: unknown, candidateValue: unknown): {
  additive: boolean;
  addedUnitSuites: string[];
  addedIntegrationSuites: string[];
  addedUnitPaths: string[];
  addedIntegrationArgs: string[];
  addedObservations: string[];
  addedCaseGroups: string[];
};
export function validateComparatorDatabaseUrl(
  databaseUrl: string,
  expected: DatabaseTarget,
  mode: string,
): DatabaseTarget & { mode: string };
export function canonicalizeJson(value: unknown): unknown;
export function stableJson(value: unknown): string;
export function diffJson(before: unknown, after: unknown, currentPath?: string): JsonDifference[];
export interface PersistedStateClockEvidence {
  table: string;
  primaryKey: Record<string, unknown>;
  fields: Record<string, string | number>;
}
export type ComparatorClockFieldKind = "zoned-timestamp" | "local-timestamp" | "epoch-seconds";
export type ComparatorClockFieldPolicy = Record<string, Record<string, ComparatorClockFieldKind>>;
export function projectPersistedStateForComparison(
  persisted: unknown,
  databaseClockFields: ComparatorClockFieldPolicy,
): { comparable: unknown; clockEvidence: PersistedStateClockEvidence[] };
export function deriveDatabaseClockTransitions(
  initialEvidence: PersistedStateClockEvidence[],
  finalEvidence: PersistedStateClockEvidence[],
  databaseClockFields: ComparatorClockFieldPolicy,
): Array<{ table: string; primaryKey: Record<string, unknown>; fields: Record<string, "created" | "deleted" | "unchanged" | "updated"> }>;
export function sortObservationsByCaseId<T extends { caseId: string }>(observations: readonly T[]): T[];
export interface ComparatorCaseRun {
  suiteId: string;
  cases: Array<{ file: string; name: string; status: string }>;
}
export interface ComparatorCaseCoverage {
  file: string;
  name: string;
  occurrence: number;
  executedIn: string[];
  filteredIn: string[];
}
export function aggregateSuiteCases(suiteRuns: ComparatorCaseRun[]): ComparatorCaseCoverage[];
export function sha256(data: string | Uint8Array): string;
