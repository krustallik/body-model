export interface ReadOnlyQuery {
  (sql: string, values?: unknown[]): Promise<unknown[]>;
}

export interface CompatibilityColumn {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  ordinalPosition?: number;
}

export interface CompatibilityExpected {
  schemaVersion: 1;
  logicalProductionDbIdentityDigest: string;
  requiredRelations: Array<{ schema: string; table: string; columns: CompatibilityColumn[] }>;
  expectedSchemaDigest: string;
  migrationNames: string[];
  expectedMigrationHistoryDigest: string;
}

export interface MigrationHistoryRelation {
  schema: string;
  table: string;
}

export function normalizeColumns(columns: Array<Record<string, unknown>>): Array<{
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  ordinalPosition: number;
}>;

export function verifyReadOnlySchemaCompatibility(options: {
  withReadOnlyTransaction: <T>(work: (query: ReadOnlyQuery) => Promise<T>) => Promise<T>;
  resolveLogicalDatabaseIdentity: (query: ReadOnlyQuery) => Promise<{ identityDigest: string; observationsDigest: string }>;
  expected: CompatibilityExpected;
  migrationHistoryRelation?: MigrationHistoryRelation;
}): Promise<{
  schemaCompatible: true;
  logicalProductionDbIdentityDigest: string;
  liveDbObservationsDigest: string;
  actualSchemaDigest: string;
  actualMigrationHistoryDigest: string;
  requiredRelationsChecked: number;
  migrationCount: number;
}>;

export function verifyProgramlessSessionRollbackCompatibility(options: {
  withReadOnlyTransaction: <T>(work: (query: ReadOnlyQuery) => Promise<T>) => Promise<T>;
  resolveLogicalDatabaseIdentity: (query: ReadOnlyQuery) => Promise<{ identityDigest: string; observationsDigest: string }>;
  expectedLogicalProductionDbIdentityDigest: string;
  repositoryPath: string;
  rollbackAppSha: string;
}): Promise<{
  schemaVersion: 1;
  purpose: "bodycast-programless-session-rollback-compatibility";
  rollbackAppSha: string;
  logicalProductionDbIdentityDigest: string;
  programlessSessionCount: number;
  rollbackAppSupportsProgramlessSessions: boolean;
  programlessSessionCompatible: true;
  rollbackAppCapabilityDigest: string;
  observedAt: string;
}>;
