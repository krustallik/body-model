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
export function validateManifest(value: unknown): Record<string, unknown>;
export function validateComparatorDatabaseUrl(
  databaseUrl: string,
  expected: DatabaseTarget,
  mode: string,
): DatabaseTarget & { mode: string };
export function canonicalizeJson(value: unknown): unknown;
export function stableJson(value: unknown): string;
export function diffJson(before: unknown, after: unknown, currentPath?: string): JsonDifference[];
export function sha256(data: string | Uint8Array): string;