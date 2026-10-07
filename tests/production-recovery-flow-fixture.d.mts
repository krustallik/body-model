export interface RecoveryFlowBoundary {
  logicalDatabaseIdentityDigest: string;
  expectedSchemaDigest: string;
  expectedMigrationHistoryDigest: string;
  authorityState: { state: string; generation: number; recordDigest: string };
}

export interface RecoveryFlowFixtureOptions {
  logicalDatabaseIdentityDigest?: string | null;
  restoredSchemaDigest?: string | null;
  migrationHistoryDigest?: string | null;
  afterRestoreBegins?: (boundary: { logicalDatabaseIdentityDigest: string; authorityState: { state: string } }) => void | Promise<void>;
  afterRestoreVerified?: (boundary: RecoveryFlowBoundary) => void | Promise<void>;
}

export function runProductionRecoveryFlowFixture(options?: RecoveryFlowFixtureOptions): Promise<void>;
