CREATE TYPE "StrengthAccountingOperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'RETRYABLE');

ALTER TABLE "StrengthDiarySession"
  ADD COLUMN "accountingInputRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "effectiveAccountingAt" TIMESTAMPTZ(3),
  ADD COLUMN "accountingTimeZone" VARCHAR(80),
  ADD COLUMN "accountingTimeZoneProvenance" VARCHAR(40),
  ADD COLUMN "currentSnapshotRevision" INTEGER;

ALTER TABLE "StrengthDiarySession"
  ADD CONSTRAINT "StrengthDiarySession_accountingInputRevision_positive"
    CHECK ("accountingInputRevision" > 0);

CREATE TABLE "StrengthSessionAccountingSnapshot" (
  "id" SERIAL NOT NULL,
  "sessionId" INTEGER NOT NULL,
  "snapshotRevision" INTEGER NOT NULL,
  "accountingInputRevision" INTEGER NOT NULL,
  "inputFingerprint" VARCHAR(64) NOT NULL,
  "effectiveLocalDate" VARCHAR(10) NOT NULL,
  "timeZone" VARCHAR(80) NOT NULL,
  "timeZoneProvenance" VARCHAR(40) NOT NULL,
  "accountingMethodVersion" VARCHAR(80) NOT NULL,
  "massResolutionMethodVersion" VARCHAR(80) NOT NULL,
  "massResolutionIdentity" VARCHAR(160) NOT NULL,
  "payloadVersion" VARCHAR(80) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StrengthSessionAccountingSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StrengthSessionAccountingSnapshot_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "StrengthDiarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StrengthSessionAccountingSnapshot_session_revision_key"
    UNIQUE ("sessionId", "snapshotRevision"),
  CONSTRAINT "StrengthSessionAccountingSnapshot_positive_revisions"
    CHECK ("snapshotRevision" > 0 AND "accountingInputRevision" > 0),
  CONSTRAINT "StrengthSessionAccountingSnapshot_fingerprint_hex"
    CHECK ("inputFingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "StrengthSessionAccountingSnapshot_session_input_revision_idx"
  ON "StrengthSessionAccountingSnapshot"("sessionId", "accountingInputRevision");
CREATE INDEX "StrengthSessionAccountingSnapshot_session_fingerprint_idx"
  ON "StrengthSessionAccountingSnapshot"("sessionId", "inputFingerprint");

CREATE TABLE "StrengthSessionAccountingOperation" (
  "id" SERIAL NOT NULL,
  "sessionId" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "requestDigest" VARCHAR(64) NOT NULL,
  "status" "StrengthAccountingOperationStatus" NOT NULL DEFAULT 'PENDING',
  "resultSnapshotRevision" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "StrengthSessionAccountingOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StrengthSessionAccountingOperation_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "StrengthDiarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StrengthSessionAccountingOperation_session_key_key"
    UNIQUE ("sessionId", "idempotencyKey"),
  CONSTRAINT "StrengthSessionAccountingOperation_digest_hex"
    CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "StrengthSessionAccountingOperation_completed_has_result"
    CHECK (("status" = 'COMPLETED') = ("resultSnapshotRevision" IS NOT NULL))
);

CREATE INDEX "StrengthSessionAccountingOperation_session_status_created_idx"
  ON "StrengthSessionAccountingOperation"("sessionId", "status", "createdAt");

-- Deferred composite FKs allow a single transaction to insert a snapshot and
-- then publish its session-scoped current pointer and operation result.
ALTER TABLE "StrengthDiarySession"
  ADD CONSTRAINT "StrengthDiarySession_current_snapshot_fkey"
    FOREIGN KEY ("id", "currentSnapshotRevision")
    REFERENCES "StrengthSessionAccountingSnapshot"("sessionId", "snapshotRevision")
    ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "StrengthSessionAccountingOperation"
  ADD CONSTRAINT "StrengthSessionAccountingOperation_result_snapshot_fkey"
    FOREIGN KEY ("sessionId", "resultSnapshotRevision")
    REFERENCES "StrengthSessionAccountingSnapshot"("sessionId", "snapshotRevision")
    ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
