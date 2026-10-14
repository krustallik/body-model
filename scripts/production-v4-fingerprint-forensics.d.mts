export interface ForensicTableDigest {
  name: string;
  digest: string;
}

export interface ForensicSequenceDigest {
  name: string;
  digest: string;
  legacyDigest: string;
}

export interface ForensicReport {
  schemaVersion: number;
  captureMethod: string;
  identity: {
    serverVersion: string;
    database: string;
    transactionReadOnly: string;
  };
  tables: ForensicTableDigest[];
  sequences: ForensicSequenceDigest[];
  logicalDataFingerprint: string;
  v4ReplayInputFingerprintV2: string;
  v4ReplayInputFingerprintV3: string;
  replayInputFingerprintVersions: {
    signedBaseline: string;
    rawParity: string;
  };
}

export function captureForensicReport(mode: string, target: string): Promise<ForensicReport>;
export function safeCliErrorMessage(error: unknown): string;
