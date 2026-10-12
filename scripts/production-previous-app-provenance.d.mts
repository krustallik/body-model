export interface PreviousAppProvenanceRecord {
  schemaVersion: number;
  targetSha: string;
  provenanceKind: string;
  previousSha: string;
  previousImageId: string;
  previousImagePin?: string;
  previousContainerId: string;
  previousHealth: string;
  previousRuntimeConfigDigest: string;
  preDdlDatabaseIdentityDigest: string;
  preDdlMigrationHistoryDigest: string;
  preDdlSchemaInventoryDigest: string;
  preDdlDatabaseCompatibilityDigest: string;
}

export interface PreviousAppProvenanceBinding {
  schemaVersion: 2 | 3;
  provenanceKind: string;
  recordDigest: string;
  previousSha: string;
  previousImageId: string;
  previousImagePin?: string;
  previousContainerId: string;
  previousHealth: "healthy";
  previousRuntimeConfigDigest: string;
}

export function capturePreviousAppProvenance(input: {
  container: unknown;
  databaseReport: unknown;
  targetSha: string;
  imagePin?: string | null;
}): PreviousAppProvenanceRecord;

export function previousAppProvenanceBinding(record: PreviousAppProvenanceRecord): PreviousAppProvenanceBinding;
export function validatePreviousAppProvenanceBinding(binding: unknown): boolean;
export function parsePreviousAppProvenance(text: string): PreviousAppProvenanceRecord;
export function serializePreviousAppProvenance(record: PreviousAppProvenanceRecord): string;
