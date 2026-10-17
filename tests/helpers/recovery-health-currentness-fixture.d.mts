export const OLD_APP_SHA: string;
export const DATABASE_DIGEST: string;
export const IMAGE_DIGEST: string;
export const SOURCE_DIGEST: string;
export const ADAPTER: Readonly<Record<string, unknown>>;

export interface RecoveryFenceRequest {
  purpose: string;
  profileId: number;
  operationType: string;
  operationId: string;
  recoveryCaseId: string;
  journalGeneration: number;
  journalRecordDigest: string;
  logicalProductionDbIdentityDigest: string;
  releaseSha: string;
  imageDigest: string;
  unifiedLifecycleFenceNamespace: number;
  fenceSnapshotProtocol: "read-committed-post-lock-v1";
  execute: (evidence: Record<string, unknown>) => Promise<unknown>;
}

export function currentness(expected: RecoveryFenceRequest, overrides?: Record<string, unknown>): Record<string, unknown>;

export interface RecoveryHealthCurrentnessFixture {
  broker: { dispatch(request: unknown): Promise<Record<string, unknown>> };
  request: Record<string, unknown>;
  fenceCalls: RecoveryFenceRequest[];
  effectCount(): number;
  finalizeCount(): number;
  finalizedRecordReads(): number;
  preparationCalls(): number;
  conformanceCalls(): number;
  committed(): boolean;
  record: {
    recoveryCaseId: string;
    transition: string;
    generation: number;
    recordDigest: string;
    operationEvidenceId: string;
  };
  intent: { operationType: string; operationId: string; operationInputDigest: string };
}

export interface RecoveryHealthCurrentnessFixtureOptions {
  databaseDigest?: string;
  operationType?: string;
  overrides?: {
    currentness?: Record<string, unknown> | ((expected: RecoveryFenceRequest, call: number) => Record<string, unknown>);
    withRecoveryCurrentnessFence?: (
      expected: RecoveryFenceRequest,
      buildCurrentness: typeof currentness,
    ) => Promise<unknown>;
  };
  receipt?: Record<string, unknown> | null;
  finalized?: boolean;
  receiptedTransition?: boolean;
  preparationOverrides?: Record<string, unknown>;
  adapterConformance?: Record<string, unknown> | null;
  finalizedRecordReader?: boolean;
}

export function makeRecoveryCase(options?: RecoveryHealthCurrentnessFixtureOptions): RecoveryHealthCurrentnessFixture;
