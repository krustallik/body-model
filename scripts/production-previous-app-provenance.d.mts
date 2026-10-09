export interface PreviousAppProvenanceRecord {
  schemaVersion: number;
  targetSha: string;
  provenanceKind: string;
  previousSha: string;
  previousImageId: string;
  previousContainerId: string;
  previousHealth: string;
  previousRuntimeConfigDigest: string;
  preDdlDatabaseIdentityDigest: string;
  preDdlMigrationHistoryDigest: string;
  preDdlSchemaInventoryDigest: string;
  preDdlDatabaseCompatibilityDigest: string;
}

export function capturePreviousAppProvenance(input: {
  container: unknown;
  databaseReport: unknown;
  targetSha: string;
}): PreviousAppProvenanceRecord;

export function serializePreviousAppProvenance(record: PreviousAppProvenanceRecord): string;
